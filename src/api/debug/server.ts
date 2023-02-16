import path from "path";

import IBMi from "../IBMi";
import IBMiContent from "../IBMiContent";
import * as certificates from "./certificates";

const directory = `/QIBM/ProdData/IBMiDebugService/bin/`;

export async function startup(connection: IBMi) {
  const host = connection.currentHost;

  const result = await connection.sendCommand({
    command: `DEBUG_SERVICE_KEYSTORE_PASSWORD=${host} ${path.posix.join(directory, `encryptKeystorePassword.sh`)} | /usr/bin/tail -n 1`
  });

  const password = result.stdout;

  const keystorePath = certificates.getKeystorePath();

  connection.sendCommand({
    command: `DEBUG_SERVICE_KEYSTORE_PASSWORD="${password}" DEBUG_SERVICE_KEYSTORE_FILE="${keystorePath}" /QOpenSys/usr/bin/nohup "${path.posix.join(directory, `startDebugService.sh`)}"`
  });

  return;
}

export async function isRunning(localPort: string, content: IBMiContent) {
  const rows = await content.runSQL(`select job_name, authorization_name from qsys2.netstat_job_info j where local_port = ${localPort} group by job_name, authorization_name`);

  return rows.length > 0;
}

export async function end(connection: IBMi) {
  const endResult = await connection.sendCommand({
    command: `${path.posix.join(directory, `stopDebugService.sh`)}`
  });

  if (endResult.code && endResult.code >= 0) {
    return false; // Did not end. Maybe it wasn't running?
  } else {
    return true; // Ended ok perhaps?
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