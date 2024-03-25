import path from "path";
import { commands, window } from "vscode";

import { instance } from "../../instantiate";
import { t } from "../../locale";
import IBMi from "../IBMi";
import IBMiContent from "../IBMiContent";
import { Tools } from "../Tools";
import * as certificates from "./certificates";

const serverDirectory = `/QIBM/ProdData/IBMiDebugService/bin/`;
const MY_JAVA_HOME = `MY_JAVA_HOME="/QOpenSys/QIBM/ProdData/JavaVM/jdk80/64bit"`;

export type DebugJob = {
  name: string
  port: number
}

export async function startService(connection: IBMi) {
  const host = connection.currentHost;

  const encryptResult = await connection.sendCommand({
    command: `${path.posix.join(serverDirectory, `encryptKeystorePassword.sh`)} | /usr/bin/tail -n 1`,
    env: {
      DEBUG_SERVICE_KEYSTORE_PASSWORD: host,
      MY_JAVA_HOME: "/QOpenSys/QIBM/ProdData/JavaVM/jdk80/64bit"
    }
  });

  if ((encryptResult.code || 0) >= 1) {
    // Usually means it failed.
    // Nice error text comes through as stdout.
    // Real error comes through in stderr.

    throw new Error(encryptResult.stdout || encryptResult.stderr);
  }

  const password = encryptResult.stdout;

  const keystorePath = certificates.getRemoteServerCertificatePath(connection);

  let didNotStart = false;
  connection.sendCommand({
    command: `${MY_JAVA_HOME} DEBUG_SERVICE_KEYSTORE_PASSWORD="${password}" DEBUG_SERVICE_KEYSTORE_FILE="${keystorePath}" /QOpenSys/usr/bin/nohup "${path.posix.join(serverDirectory, `startDebugService.sh`)}"`
  }).then(startResult => {
    if (startResult.code) {
      window.showErrorMessage(t("start.debug.service.failed", startResult.stdout || startResult.stderr));
      didNotStart = true;
    }
  });

  let tries = 0;
  while (!didNotStart && tries < 20) {
    if (await getDebugServiceJob()) {
      window.showInformationMessage(t("start.debug.service.succeeded"));
      commands.executeCommand("code-for-ibmi.updateConnectedBar");
      return true;
    }
    else {
      await Tools.sleep(500);
      tries++;
    }
  }

  return false;
}

export async function stopService(connection: IBMi) {
  const endResult = await connection.sendCommand({
    command: `${MY_JAVA_HOME} ${path.posix.join(serverDirectory, `stopDebugService.sh`)}`
  });

  if (!endResult.code) {
    window.showInformationMessage(t("stop.debug.service.succeeded"));
    commands.executeCommand("code-for-ibmi.updateConnectedBar");
    return true;
  } else {
    window.showErrorMessage(t("stop.debug.service.failed", endResult.stdout || endResult.stderr));
    return false;
  }
}

export async function getDebugServiceJob() {
  const content = instance.getContent();
  if (content) {
    return rowToDebugJob(
      (await content.runSQL(`select job_name, local_port from qsys2.netstat_job_info j where local_port = ${content.ibmi.config?.debugPort || 8005} fetch first row only`)).at(0)
    );
  }
}

export async function getDebugServerJob() {
  const content = instance.getContent();
  if (content) {
    return rowToDebugJob(
      (await content.runSQL(`select job_name, local_port from qsys2.netstat_job_info where cast(local_port_name as VarChar(14) CCSID 37) = 'is-debug-ile' fetch first row only`)).at(0)
    );
  }
}

function rowToDebugJob(row?: Tools.DB2Row): DebugJob | undefined {
  return row?.JOB_NAME ? { name: String(row.JOB_NAME), port: Number(row.LOCAL_PORT) } : undefined;
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
      window.showErrorMessage(t("strdbgsvr.failed"), result.stderr);
      return false;
    }
    else {
      commands.executeCommand("code-for-ibmi.updateConnectedBar");
      window.showInformationMessage(t("strdbgsvr.succeeded"));
    }
  }
  return true;
}

export async function stopServer() {
  const result = await instance.getConnection()?.runCommand({ command: "ENDDBGSVR", noLibList: true });
  if (result) {
    if (result.code) {
      window.showErrorMessage(t("enddbgsvr.failed"), result.stderr);
      return false;
    }
    else {
      commands.executeCommand("code-for-ibmi.updateConnectedBar");
      window.showInformationMessage(t("enddbgsvr.succeeded"));
    }
  }
  return true;
}