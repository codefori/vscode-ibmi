import { commands, l10n, window } from "vscode";
import IBMi from "../api/IBMi";
import { getDebugServiceDetails } from "../api/configuration/DebugConfiguration";
import { instance } from "../instantiate";
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

export async function getDebugEngineJobs(): Promise<DebugJobs> {
  const rows = await instance.getConnection()?.runSQL([
    "select 'SERVER' as TYPE, JOB_NAME from table(qsys2.job_info(job_status_filter => '*ACTIVE', job_type_filter => '*BATCH', job_name_filter => 'QB5ROUTER'))",
    "Union",
    "select 'SERVICE' as TYPE, JOB_NAME from table(qsys2.job_info(job_status_filter => '*ACTIVE', job_type_filter => '*BATCH', job_name_filter => 'QDBGSRV'))"
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