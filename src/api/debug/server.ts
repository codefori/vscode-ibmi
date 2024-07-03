import path from "path";
import { commands, window } from "vscode";
import { instance } from "../../instantiate";
import { t } from "../../locale";
import { CustomUI } from "../CustomUI";
import IBMi from "../IBMi";
import { Tools } from "../Tools";
import { DebugConfiguration, getDebugServiceDetails } from "./config";

export type DebugJob = {
  name: string
  ports: number[]
}

export function debugPTFInstalled() {
  return instance.getConnection()?.remoteFeatures[`startDebugService.sh`] !== undefined;
}

export async function isSEPSupported() {
  return (await getDebugServiceDetails()).semanticVersion().major > 1;
}

export async function startService(connection: IBMi) {
  const checkAuthority = async (user?: string) => {
    if (!(await connection.checkUserSpecialAuthorities(["*ALLOBJ"], user)).valid) {
      throw new Error(`User ${user || connection.currentUser} doesn't have *ALLOBJ special authority`);
    }
  };

  try {
    await checkAuthority();
    const debugConfig = await new DebugConfiguration().load();

    const submitOptions = await window.showInputBox({
      title: t("debug.service.submit.options"),
      prompt: t("debug.service.submit.options.prompt"),
      value: `JOBQ(QSYS/QUSRNOMAX) JOBD(QSYS/QSYSJOBD) USER(*CURRENT)`
    });

    if (submitOptions) {
      const submitUser = /USER\(([^)]+)\)/.exec(submitOptions)?.[1]?.toLocaleUpperCase();
      if (submitUser && submitUser !== "*CURRENT") {
        await checkAuthority(submitUser);
      }
      const command = `SBMJOB CMD(STRQSH CMD('${connection.remoteFeatures[`bash`]} -c /QIBM/ProdData/IBMiDebugService/bin/startDebugService.sh')) JOB(DBGSVCE) ${submitOptions}`
      const submitResult = await connection.runCommand({ command, cwd: debugConfig.getRemoteServiceWorkDir(), noLibList: true });
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
                    window.showInformationMessage(t("start.debug.service.succeeded"));
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
  const debugConfig = await new DebugConfiguration().load();
  const endResult = await connection.sendCommand({
    command: `${path.posix.join(debugConfig.getRemoteServiceBin(), `stopDebugService.sh`)}`
  });

  if (!endResult.code) {
    window.showInformationMessage(t("stop.debug.service.succeeded"));
    refreshDebugSensitiveItems();
    return true;
  } else {
    window.showErrorMessage(t("stop.debug.service.failed", endResult.stdout || endResult.stderr));
    return false;
  }
}

export async function getDebugServiceJob() {
  const connection = instance.getConnection();
  if (connection) {
    const rows = await connection.runSQL(`select job_name, local_port from qsys2.netstat_job_info j where job_name = (select job_name from qsys2.netstat_job_info j where local_port = ${connection.config?.debugPort || 8005} and remote_address = '0.0.0.0' fetch first row only) and remote_address = '0.0.0.0'`);
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
      window.showErrorMessage(t("strdbgsvr.failed", result.stderr));
      return false;
    }
    else {
      refreshDebugSensitiveItems();
      window.showInformationMessage(t("strdbgsvr.succeeded"));
    }
  }
  return true;
}

export async function stopServer() {
  const result = await instance.getConnection()?.runCommand({ command: "ENDDBGSVR", noLibList: true });
  if (result) {
    if (result.code) {
      window.showErrorMessage(t("enddbgsvr.failed", result.stderr));
      return false;
    }
    else {
      refreshDebugSensitiveItems();
      window.showInformationMessage(t("enddbgsvr.succeeded"));
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
      `select job_name_short, job_user, job_number, subsystem_library_name concat '/' concat subsystem as subsystem, authorization_name, job_status, memory_pool from table(qsys2.active_job_info(job_name_filter => '${job.name.substring(job.name.lastIndexOf('/') + 1)}')) where job_name = '${job.name}' fetch first row only`
    )).at(0);
  } catch (error) {
    return String(error);
  }
}

export async function readJVMInfo(connection: IBMi, job: DebugJob) {
  try {
    return (await connection.runSQL(`
      select START_TIME, JAVA_HOME, USER_DIRECTORY, CURRENT_HEAP_SIZE, MAX_HEAP_SIZE
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
  else{
    window.showWarningMessage(`No QPRINT spooled file found for job ${job}!`);
  }
}