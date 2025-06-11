import path from "path";
import { commands, l10n, window } from "vscode";
import IBMi from "../api/IBMi";
import { Tools } from "../api/Tools";
import { DebugConfiguration, getDebugServiceDetails, getJavaHome } from "../api/configuration/DebugConfiguration";
import { instance } from "../instantiate";
import { CustomUI } from "../webviews/CustomUI";
export type DebugJob = {
  name: string
  ports: number[]
}

export const MIN_DEBUG_VERSION = 3;

export function debugPTFInstalled(connection: IBMi) {
  return connection.debugPTFInstalled()
}

export async function isDebugSupported(connection: IBMi) {
  return debugPTFInstalled(connection) && (await getDebugServiceDetails(connection)).semanticVersion().major >= MIN_DEBUG_VERSION;
}

export async function startService(connection: IBMi) {
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

      const debugConfig = await new DebugConfiguration(connection).load();

      // Attempt to make log directory
      await connection.sendCommand({ command: `mkdir -p ${debugConfig.getRemoteServiceWorkspace()}` });

      // Change owner to QDBGSRV
      if (submitUser && submitUser !== "QDBGSRV") {
        await connection.sendCommand({ command: `chown ${submitUser} ${debugConfig.getRemoteServiceWorkspace()}` });
      }

      // Change the permissions to 777
      await connection.sendCommand({ command: `chmod 777 ${debugConfig.getRemoteServiceWorkspace()}` });

      const command = `QSYS/SBMJOB JOB(QDBGSRV) ${submitOptions} CMD(QSH CMD('export JAVA_HOME=${javaHome};${debugConfig.getRemoteServiceBin()}/startDebugService.sh > ${debugConfig.getNavigatorLogFile()} 2>&1'))`
      const submitResult = await connection.runCommand({ command, noLibList: true });
      if (submitResult.code === 0) {
        const submitMessage = Tools.parseMessages(submitResult.stderr || submitResult.stdout).findId("CPC1221")?.text;
        if (submitMessage) {
          const [job] = /([^\/\s]+)\/([^\/]+)\/([^\/\s]+)/.exec(submitMessage) || [];
          if (job) {
            let tries = 0;
            const checkJob = async (done: (started: boolean) => void) => {
              if (tries++ < 30) {
                const jobDetail = await readActiveJob(connection, { name: job, ports: [] });
                if (jobDetail && typeof jobDetail === "object" && !["HLD", "MSGW", "END"].includes(String(jobDetail.JOB_STATUS))) {
                  if (await getDebugServiceJob()) {
                    window.showInformationMessage(l10n.t(`Debug service started.`));
                    refreshDebugSensitiveItems();
                    done(true);
                  }
                  else {
                    setTimeout(() => checkJob(done), 1000);
                  }
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
                  window.showErrorMessage(`Debug Service job ${job} failed: ${reason}.`, 'Open output').then(() => openQPRINT(connection, job));
                  done(false);
                }
              }
              else {
                done(false);
              }
            };

            return await new Promise<boolean>(checkJob);
          }
        }
      }
      throw new Error(`Failed to submit Debug Service job: ${submitResult.stderr || submitResult.stdout}`)
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

export async function getDebugServiceJob() {
  const connection = instance.getConnection();
  if (connection) {
    const rows = await connection.runSQL(`select job_name, local_port from qsys2.netstat_job_info j where job_name = (select job_name from qsys2.netstat_job_info j where local_port = ${connection.getConfig().debugPort || 8005} and remote_address = '0.0.0.0' fetch first row only) and remote_address = '0.0.0.0'`);
    if (rows && rows.length) {
      return {
        name: String(rows[0].JOB_NAME),
        ports: rows.map(row => Number(row.LOCAL_PORT)).sort()
      } as DebugJob;
    }
  }
}

export async function getDebugServerJob() {
  const connection = instance.getConnection();
  if (connection) {
    const [row] = await connection.runSQL(`select job_name, local_port from qsys2.netstat_job_info where cast(local_port_name as VarChar(14) CCSID 37) = 'is-debug-ile' fetch first row only`);
    if (row) {
      return {
        name: String(row.JOB_NAME),
        ports: [Number(row.LOCAL_PORT)]
      } as DebugJob;
    }
  }
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

export async function isDebugEngineRunning() {
  return (await Promise.all([getDebugServerJob(), getDebugServiceJob()])).every(Boolean);
}

export async function startServer() {
  const result = await instance.getConnection()?.runCommand({ command: "STRDBGSVR", noLibList: true });
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
  const result = await instance.getConnection()?.runCommand({ command: "ENDDBGSVR", noLibList: true });
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

export async function readActiveJob(connection: IBMi, job: DebugJob) {
  try {
    return (await connection.runSQL(
      `select job_name_short "Job name", job_user "Job user", job_number "Job number", subsystem_library_name concat '/' concat subsystem as "Subsystem",  authorization_name "Current user", job_status "Job status", memory_pool "Memory pool" from table(qsys2.active_job_info(job_name_filter => '${job.name.substring(job.name.lastIndexOf('/') + 1)}')) where job_name = '${job.name}' fetch first row only`
    )).at(0);
  } catch (error) {
    return String(error);
  }
}

export async function readJVMInfo(connection: IBMi, job: DebugJob) {
  try {
    return (await connection.runSQL(`
      select START_TIME "Start time", JAVA_HOME "Java Home", USER_DIRECTORY "User directory", CURRENT_HEAP_SIZE "Current memory", MAX_HEAP_SIZE "Maximum allowed memory"
      from QSYS2.JVM_INFO
      where job_name = '${job.name}'
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