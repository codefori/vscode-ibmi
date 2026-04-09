import { Socket } from "net";
import path from "path";
import { commands, l10n, window } from "vscode";
import IBMi from "../api/IBMi";
import { Tools } from "../api/Tools";
import { DebugConfiguration, getDebugServiceDetails, getJavaHome } from "../api/configuration/DebugConfiguration";
import { instance } from "../instantiate";
import { CustomUI } from "../webviews/CustomUI";
export type DebugJobs = {
  server?: string
  service?: string
}

export const MIN_DEBUG_VERSION = 3;

export function debugPTFInstalled(connection: IBMi) {
  return connection.debugPTFInstalled()
}

export async function isDebugSupported(connection: IBMi) {
  return debugPTFInstalled(connection) && (await getDebugServiceDetails(connection)).semanticVersion().major >= MIN_DEBUG_VERSION;
}

export async function startService(connection: IBMi) {
  // Check if debug engine jobs are already running
  const existingJobs = await getDebugEngineJobs();
  if (existingJobs.service) {
    window.showInformationMessage(l10n.t(`Debug service is already started.`));
    refreshDebugSensitiveItems();
    return true;
  }

  const checkAuthority = async (user?: string) => {
    if (user && !await connection.getContent().checkObject({ library: "QSYS", name: user, type: "*USRPRF" }, ["*USE"])) {
      throw new Error(`You don't have *USE authority on user profile ${user}`);
    }
    if (user !== "QDBGSRV" && !(await connection.getContent().checkUserSpecialAuthorities(["*ALLOBJ", "*SECADM"], user)).valid) {
      throw new Error(`User ${user || connection.currentUser} doesn't have *ALLOBJ special authority`);
    }
  };

  try {
    const debugServiceJavaVersion = (await getDebugServiceDetails(connection)).java;
    // const debugConfig = await new DebugConfiguration(connection).load();
    const javaHome = getJavaHome(connection, debugServiceJavaVersion)

    const submitOptions = await window.showInputBox({
      title: l10n.t(`Debug Service submit options`),
      prompt: l10n.t(`Valid parameters for SBMJOB`),
      value: `JOBQ(QSYS/QUSRNOMAX) JOBD(QSYS/QSYSJOBD) OUTQ(QUSRSYS/QDBGSRV) USER(QDBGSRV)`
    });

    if (submitOptions) {
      const submitUser = /USER\(([^)]+)\)/.exec(submitOptions)?.[1]?.toLocaleUpperCase();
      if (submitUser && submitUser !== "*CURRENT") {
        await checkAuthority(submitUser);
      }
      else {
        await checkAuthority();
      }

      let debugConfig: DebugConfiguration;
      let debugConfigLoaded = false;
      const config = connection.getConfig();
      try {
        debugConfig = await new DebugConfiguration(connection).load();
        config.debugPort = debugConfig.getRemoteServiceSecuredPort();
        config.debugSepPort = debugConfig.getRemoteServiceSepDaemonPort();
        IBMi.connectionManager.update(config);
        debugConfigLoaded = true;
      } catch (error) {
        throw new Error(`Could not load debug service configuration: ${error}`);
      } finally {
        IBMi.GlobalStorage.setServerSettingsCacheSpecific(connection.currentConnectionName, { debugConfigLoaded });
      }

      // Attempt to make log directory
      await connection.sendCommand({ command: `mkdir -p ${debugConfig.getRemoteServiceWorkspace()}` });

      // Change owner to QDBGSRV
      if (submitUser && submitUser !== "QDBGSRV") {
        await connection.sendCommand({ command: `chown ${submitUser} ${debugConfig.getRemoteServiceWorkspace()}` });
      }

      // Change the permissions to 777
      await connection.sendCommand({ command: `chmod 777 ${debugConfig.getRemoteServiceWorkspace()}` });

      // Clear the log file before starting the service
      await connection.sendCommand({ command: `rm -f ${debugConfig.getNavigatorLogFile()}` });

      const navigatorLogFile = debugConfig.getNavigatorLogFile();
      const command = `QSYS/SBMJOB JOB(QDBGSRV) SYSLIBL(*SYSVAL) CURLIB(*USRPRF) INLLIBL(*JOBD) ${submitOptions} CMD(QSH CMD('touch ${navigatorLogFile};attr ${navigatorLogFile} CCSID=1208;export JAVA_HOME=${javaHome};${debugConfig.getRemoteServiceBin()}/startDebugService.sh > ${navigatorLogFile} 2>&1'))`
      const submitResult = await connection.runCommand({ command, noLibList: true });
      
      // Note: The submit command will always return success (code 0)
      // We need to read the log file to check for actual errors
      const submitMessage = Tools.parseMessages(submitResult.stderr || submitResult.stdout).findId("CPC1221")?.text;
      if (!submitMessage) {
        throw new Error(`Failed to submit Debug Service job: ${submitResult.stderr || submitResult.stdout}`);
      }

      const [job] = /([^\/\s]+)\/([^\/]+)\/([^\/\s]+)/.exec(submitMessage) || [];
      if (!job) {
        throw new Error(`Could not parse job name from submit message: ${submitMessage}`);
      }

      // Read and parse the log file to check for errors (based on Java DebugServiceManager.readLogger)
      const logFilePath = debugConfig.getNavigatorLogFile();
      const startTime = Date.now();
      const timeout = 95000; // 95 seconds timeout like Java implementation
      let numLines = 0;
      let debugLine = false;

      // Wait for content (first 7 lines is Java information)
      // Need to wait for the lines after start and any Debugger lines to see if there are errors
      while ((numLines < 8) || debugLine) {
        if ((Date.now() - startTime) > timeout) {
          // Timeout - read remaining lines and throw error
          try {
            const logContent = await connection.getContent().downloadStreamfileRaw(logFilePath);
            const lines = logContent.toString('utf-8').split('\n');
            throw new Error(`Reading Debug Service logger for starting timed out. Last lines:\n${lines.slice(-10).join('\n')}`);
          } catch (error) {
            throw new Error(`Reading Debug Service logger for starting timed out: ${error}`);
          }
        }

        // Read the log file
        try {
          const logContent = await connection.getContent().downloadStreamfileRaw(logFilePath);
          const lines = logContent.toString('utf-8').split('\n');
          numLines = lines.length;

          // Check if there are any non-[Debugger] lines after line 7
          debugLine = false;
          for (let i = 7; i < lines.length; i++) {
            const line = lines[i];
            // If we find a non-empty line that doesn't start with [Debugger], we have content to process
            if (line.trim() && !line.startsWith('[Debugger]')) {
              debugLine = true;
              break;
            }
          }
        } catch (error) {
          // Log file might not exist yet, wait and retry
          await new Promise(resolve => setTimeout(resolve, 1000));
          continue;
        }

        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      // Now read again and find out what is after the first 7 lines and [Debugger] output
      const logContent = await connection.getContent().downloadStreamfileRaw(logFilePath);
      const lines = logContent.toString('utf-8').split('\n');
      const errors: string[] = [];
      const successes: string[] = [];

      for (let i = 7; i < lines.length; i++) {
        const line = lines[i];
        if (!line.startsWith('[Debugger]')) {
          // Check for success messages (EQARD1007I and EQARD1053I indicate success)
          if (line.includes('EQARD1007I') || line.includes('EQARD1053I')) {
            successes.push(line);
          } else if (line.trim()) {
            // Any other non-empty line is considered an error
            errors.push(line);
          }
        }
      }

      if (errors.length > 0) {
        const errorMessage = [...successes, ...errors].join('\n');
        throw new Error(`Debug Service failed to start:\n${errorMessage}`);
      }

      // Success - now wait for the debug service to be fully operational
      let tries = 0;
      let debugServiceJob: string | undefined;
      const debugPort = Number(debugConfig.getRemoteServiceSecuredPort());
      const checkJob = async (done: (started: boolean) => void) => {
        if (tries++ < 40) {
          if (debugServiceJob) {
            if ((await getDebugEngineJobs()).service) {
              //Debug service job running Java is still alive
              if (await checkPort(connection, debugPort)) {
                window.showInformationMessage(l10n.t(`Debug service started.`));
                refreshDebugSensitiveItems();
                done(true);
              }
              else {
                //Job is alive but ports are not opened yet
                setTimeout(() => checkJob(done), 1000);
              }
            }
            else {
              //Debug service job died
              window.showErrorMessage(`Debug Service job ${debugServiceJob} failed.`, 'Open logs')
                .then(() => commands.executeCommand('code-for-ibmi.browse', { path: logFilePath }));
              done(false);
            }
          }
          else {
            const jobDetail = await readActiveJob(connection, job);
            if (jobDetail && typeof jobDetail === "object" && !["HLD", "MSGW", "END"].includes(String(jobDetail.JOB_STATUS))) {
              debugServiceJob = (await getDebugEngineJobs()).service;
              setTimeout(() => checkJob(done), 1000);
            } else {
              let reason;
              if (typeof jobDetail === "object") {
                reason = `job is in ${String(jobDetail.JOB_STATUS)} status`;
              }
              else if (jobDetail) {
                reason = jobDetail;
              }
              else {
                reason = "job has ended";
              }
              window.showErrorMessage(`Debug Service starter job ${job} failed: ${reason}.`, 'Open output').then(() => openQPRINT(connection, job));
              done(false);
            }
          }
        }
        else {
          done(false);
        }
      };

      return await new Promise<boolean>(checkJob);
    }
  }
  catch (error) {
    window.showErrorMessage(String(error));
  }
  return false;
}

export async function stopService(connection: IBMi) {
  const debugConfig = await new DebugConfiguration(connection).load();
  const endResult = await connection.sendCommand({
    command: `${path.posix.join(debugConfig.getRemoteServiceBin(), `stopDebugService.sh`)}`
  });

  if (!endResult.code) {
    window.showInformationMessage(l10n.t(`Debug service stopped.`));
    refreshDebugSensitiveItems();
    return true;
  } else {
    window.showErrorMessage(l10n.t(`Failed to stop debug service: {0}`, endResult.stdout || endResult.stderr));
    return false;
  }
}

export async function getDebugEngineJobs(): Promise<DebugJobs> {
  const rows = await instance.getConnection()?.runSQL([
    "select 'SERVER' as TYPE, JOB_NAME from table(QSYS2.ACTIVE_JOB_INFO(JOB_NAME_FILTER => 'QB5ROUTER'))",
    "Union",
    "select 'SERVICE' as TYPE, JOB_NAME from table(QSYS2.ACTIVE_JOB_INFO(JOB_NAME_FILTER => 'QP0ZSP*')) where JOB_USER = 'QDBGSRV'"
  ].join(" "));

  return {
    server: rows?.find(row => row.TYPE === 'SERVER')?.JOB_NAME as string,
    service: rows?.find(row => row.TYPE === 'SERVICE')?.JOB_NAME as string
  }
}

export async function isDebugEngineRunning() {
  const debugJobs = await getDebugEngineJobs();
  return Boolean(debugJobs.server) && Boolean(debugJobs.service);
}

/**
 * Gets a list of debug jobs stuck at MSGW in QSYSWRK
 */
export async function getStuckJobs(connection: IBMi): Promise<string[]> {
  const sql = [
    `SELECT JOB_NAME`,
    `FROM TABLE(QSYS2.ACTIVE_JOB_INFO(SUBSYSTEM_LIST_FILTER => 'QSYSWRK', CURRENT_USER_LIST_FILTER => '${connection.currentUser.toUpperCase()}')) X`,
    `where JOB_STATUS = 'MSGW'`,
  ].join(` `);

  const jobs = await connection.runSQL(sql);
  return jobs.map(row => String(row.JOB_NAME));
}

export function endJobs(jobIds: string[], connection: IBMi) {
  const promises = jobIds.map(id => connection.sendCommand({
    command: `system "ENDJOB JOB(${id}) OPTION(*IMMED)"`
  }));

  return Promise.all(promises);
}

export async function startServer() {
  const result = await instance.getConnection()?.runCommand({ command: "QSYS/STRDBGSVR", noLibList: true });
  if (result) {
    if (result.code) {
      window.showErrorMessage(l10n.t(`Failed to start debug server: {0}`, result.stderr));
      return false;
    }
    else {
      refreshDebugSensitiveItems();
      window.showInformationMessage(l10n.t(`Debug server started.`));
    }
  }
  return true;
}

export async function stopServer() {
  const result = await instance.getConnection()?.runCommand({ command: "QSYS/ENDDBGSVR", noLibList: true });
  if (result) {
    if (result.code) {
      window.showErrorMessage(l10n.t(`Failed to stop debug server: {0}`, result.stderr));
      return false;
    }
    else {
      refreshDebugSensitiveItems();
      window.showInformationMessage(l10n.t(`Debug server stopped.`));
    }
  }
  return true;
}

export function refreshDebugSensitiveItems() {
  commands.executeCommand("code-for-ibmi.updateConnectedBar");
  commands.executeCommand("code-for-ibmi.debug.refresh");
}

export async function readActiveJob(connection: IBMi, job: string) {
  try {
    return (await connection.runSQL(
      `select job_name_short "Job name", job_user "Job user", job_number "Job number", subsystem_library_name concat '/' concat subsystem as "Subsystem",  authorization_name "Current user", job_status "Job status", memory_pool "Memory pool" from table(qsys2.active_job_info(job_name_filter => '${job.substring(job.lastIndexOf('/') + 1)}')) where job_name = '${job}' fetch first row only`
    )).at(0);
  } catch (error) {
    return String(error);
  }
}

export async function readJVMInfo(connection: IBMi, job: string) {
  try {
    return (await connection.runSQL(`
      select START_TIME "Start time", JAVA_HOME "Java Home", USER_DIRECTORY "User directory", CURRENT_HEAP_SIZE "Current memory", MAX_HEAP_SIZE "Maximum allowed memory"
      from QSYS2.JVM_INFO
      where job_name = '${job}'
      fetch first row only`)).at(0);
  } catch (error) {
    return String(error);
  }
}

async function openQPRINT(connection: IBMi, job: string) {
  const lines = (await connection.runSQL(`select SPOOLED_DATA from table (systools.spooled_file_data(job_name => '${job}', spooled_file_name => 'QPRINT')) order by ORDINAL_POSITION`))
    .map(row => String(row.SPOOLED_DATA));

  if (lines.length) {
    new CustomUI()
      .addParagraph(`<pre><code>${lines.join("<br/>")}</code></pre>`)
      .setOptions({ fullWidth: true })
      .loadPage(`${job} QPRINT`);
  }
  else {
    window.showWarningMessage(`No QPRINT spooled file found for job ${job}!`);
  }
}

async function checkPort(connection: IBMi, port: number) {
  return await new Promise<boolean>((resolve) => {
    const socket = new Socket();
    socket.connect(port, connection.currentHost, () => {
      socket.destroy();
      resolve(true);
    })
    socket.on('error', () => resolve(false));
  });
}