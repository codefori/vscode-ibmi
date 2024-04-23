import path from "path";
import { commands, window } from "vscode";
import { instance } from "../../instantiate";
import { t } from "../../locale";
import IBMi from "../IBMi";
import IBMiContent from "../IBMiContent";
import { DebugConfiguration } from "./config";

const detailFile = `package.json`;

const JavaPaths: { [version: string]: string } = {
  "8": `/QOpenSys/QIBM/ProdData/JavaVM/jdk80/64bit`,
  "11": `/QOpenSys/QIBM/ProdData/JavaVM/jdk11/64bit`
}

interface DebugServiceDetails {
  version: string
  java: string
  semanticVersion: () => {
    major: number
    minor: number
    patch: number
  }
}


export type DebugJob = {
  name: string
  ports: number[]
}

let debugServiceDetails: DebugServiceDetails | undefined;
export function resetDebugServiceDetails() {
  debugServiceDetails = undefined;
}

export async function getDebugServiceDetails(): Promise<DebugServiceDetails> {
  const content = instance.getContent()!;
  if (debugServiceDetails) {
    return debugServiceDetails;
  }

  debugServiceDetails = {
    version: `1.0.0`,
    java: `8`,
    semanticVersion: () => ({
      major: 1,
      minor: 0,
      patch: 0
    })
  };

  const detailFilePath = path.posix.join((await new DebugConfiguration().load()).getRemoteServiceRoot(), detailFile);
  const detailExists = await content.testStreamFile(detailFilePath, "r");
  if (detailExists) {
    try {
      const fileContents = (await content.downloadStreamfileRaw(detailFilePath)).toString("utf-8");
      const parsed = JSON.parse(fileContents);
      debugServiceDetails = {
        ...parsed as DebugServiceDetails,
        semanticVersion: () => {
          const parts = (parsed.version ? String(parsed.version).split('.') : []).map(Number);
          return {
            major: parts[0],
            minor: parts[1],
            patch: parts[2]
          };
        }
      }
    } catch (e) {
      // Something very very bad has happened
      window.showErrorMessage(t('detail.reading.error', detailFilePath, e));
      console.log(e);
    }
  }

  return debugServiceDetails;
}

export function debugPTFInstalled() {
  return instance.getConnection()?.remoteFeatures[`startDebugService.sh`] !== undefined;
}

export async function isSEPSupported() {
  return (await getDebugServiceDetails()).semanticVersion().major > 1;
}

export async function startService(connection: IBMi) {
  try {
    await connection.checkUserSpecialAuthorities(["*ALLOBJ"]);
    const debugConfig = await new DebugConfiguration().load();

    const env = {
      MY_JAVA_HOME: JavaPaths[(await getDebugServiceDetails()).java]
    };

    let didNotStart = false;
    connection.sendCommand({
      command: `/QOpenSys/usr/bin/nohup "${path.posix.join(debugConfig.getRemoteServiceBin(), `startDebugService.sh`)}"`,
      env,
      directory: debugConfig.getRemoteServiceWorkDir()
    }).then(startResult => {
      if (startResult.code) {
        window.showErrorMessage(t("start.debug.service.failed", startResult.stdout || startResult.stderr));
        didNotStart = true;
      }
    });

    return await new Promise<boolean>(async (done) => {
      let tries = 0;
      const intervalId = setInterval(async () => {
        if (!didNotStart && tries++ < 15) {
          if (await getDebugServiceJob()) {
            clearInterval(intervalId);
            window.showInformationMessage(t("start.debug.service.succeeded"));
            refreshDebugSensitiveItems();
            done(true);
          }
        } else {
          clearInterval(intervalId);
          done(false);
        }
      }, 1000);
    });
  }
  catch (error) {
    window.showErrorMessage(String(error));
    return false;
  }
}

export async function stopService(connection: IBMi) {
  const debugConfig = await new DebugConfiguration().load();
  const endResult = await connection.sendCommand({
    command: `${path.posix.join(debugConfig.getRemoteServiceBin(), `stopDebugService.sh`)}`,
    env: {
      MY_JAVA_HOME: JavaPaths[(await getDebugServiceDetails()).java]
    }
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
  const content = instance.getContent();
  if (content) {
    const rows = await content.runSQL(`select distinct job_name, local_port from qsys2.netstat_job_info j where job_name = (select job_name from qsys2.netstat_job_info j where local_port = ${content.ibmi.config?.debugPort || 8005} and remote_address = '0.0.0.0' fetch first row only)`);
    if (rows && rows.length) {
      return {
        name: String(rows[0].JOB_NAME),
        ports: rows.map(row => Number(row.LOCAL_PORT)).sort()
      } as DebugJob;
    }
  }
}

export async function getDebugServerJob() {
  const content = instance.getContent();
  if (content) {
    const [row] = await content.runSQL(`select job_name, local_port from qsys2.netstat_job_info where cast(local_port_name as VarChar(14) CCSID 37) = 'is-debug-ile' fetch first row only`);
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
export async function getStuckJobs(userProfile: string, content: IBMiContent): Promise<string[]> {
  const sql = [
    `SELECT JOB_NAME`,
    `FROM TABLE(QSYS2.ACTIVE_JOB_INFO(SUBSYSTEM_LIST_FILTER => 'QSYSWRK', CURRENT_USER_LIST_FILTER => '${userProfile.toUpperCase()}')) X`,
    `where JOB_STATUS = 'MSGW'`,
  ].join(` `);

  const jobs = await content.runSQL(sql);
  return jobs.map(row => String(row.JOB_NAME));
}

export function endJobs(jobIds: string[], connection: IBMi) {
  const promises = jobIds.map(id => connection.sendCommand({
    command: `system "ENDJOB JOB(${id}) OPTION(*IMMED)"`
  }));

  return Promise.all(promises);
}

export async function isDebugEngineRunning() {
  return Boolean(await getDebugServerJob()) && Boolean(await getDebugServiceJob());
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

export async function readActiveJob(content: IBMiContent, job: DebugJob) {
  try {
    return (await content.runSQL(
      `select job_name_short, job_user, job_number, subsystem_library_name || '/' || subsystem as subsystem, authorization_name, job_status, memory_pool from table(qsys2.active_job_info(job_name_filter => '${job.name.substring(job.name.lastIndexOf('/') + 1)}')) where job_name = '${job.name}' fetch first row only`
    )).at(0);
  } catch (error) {
    return String(error);
  }
}

export async function readJVMInfo(content: IBMiContent, job: DebugJob) {
  try {
    return (await content.runSQL(`
      select START_TIME, JAVA_HOME, USER_DIRECTORY, CURRENT_HEAP_SIZE, MAX_HEAP_SIZE
      from QSYS2.JVM_INFO
      where job_name = '${job.name}'
      fetch first row only`)).at(0);
  } catch (error) {
    return String(error);
  }
}