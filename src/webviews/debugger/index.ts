import vscode from "vscode";
import { CustomUI, Field, Section } from "../../api/CustomUI";
import IBMiContent from "../../api/IBMiContent";
import { Tools } from "../../api/Tools";
import { getDebugServerJob, getDebugServiceJob } from "../../api/debug/server";
import { instance } from "../../instantiate";
import { t } from "../../locale";

export async function openDebugStatusPanel() {
  const content = instance.getContent();
  if (content) {
    const debbuggerInfo = await vscode.window.withProgress({ title: t("loading.debugger.info"), location: vscode.ProgressLocation.Notification }, async () => {
      const serverJob = await getDebugServerJob();
      const activeServerJob = serverJob ? await readActiveJob(content, serverJob.job) : undefined;
      const serviceJob = await getDebugServiceJob();
      const activeServiceJob = serviceJob ? await readActiveJob(content, serviceJob.job) : undefined;
      const activeServiceJava = serviceJob ? await readJVMInfo(content, serviceJob.job) : undefined;
      return {
        serverJob,
        activeServerJob,
        serviceJob,
        activeServiceJob,
        activeServiceJava
      };
    });

    const tabs = [{
      label: t("overview"), fields: new Section()
        .addParagraph(/* html */`
          <h4>${t("debug.server")} ${debbuggerInfo.serverJob ? "✅" : "❌"}</h4>
          <ul>
            <li>${t("status")}: ${debbuggerInfo.serverJob ? t("online") : t("offline")}</li>
            ${debbuggerInfo.serverJob ? /* html */ `
            <li>${t("job")}: ${debbuggerInfo.serverJob.job}</li>
            <li>${t("listening.on.port")}: ${debbuggerInfo.serverJob.port}</li>`
            :
            ""
          }
        </ul>`)
        .addParagraph(/* html */`
        <h4> ${t("debug.service")} ${debbuggerInfo.serviceJob ? "✅" : "❌"}</h4>
        <ul>
        <li>${t("status")}: ${debbuggerInfo.serviceJob ? t("online") : t("offline")} </li>
            ${debbuggerInfo.serviceJob ? /* html */ `
            <li>${t("job")}: ${debbuggerInfo.serviceJob.job}</li>
            <li>${t("listening.on.port")}: ${debbuggerInfo.serviceJob.port}</li>`
            :
            ""
          }
        </ul>`).fields
    }];

    if (debbuggerInfo.activeServerJob) {
      tabs.push({
        label: t("debug.server"),
        fields: getActiveJobFields(t("active.job"), debbuggerInfo.activeServerJob)
      });
    }

    if (debbuggerInfo.activeServiceJob) {
      tabs.push({
        label: t("debug.service"),
        fields: [
          ...getActiveJobFields(t("active.job"), debbuggerInfo.activeServiceJob),
          ...(debbuggerInfo.activeServiceJava ? getActiveJobFields(t("jvm.info"), debbuggerInfo.activeServiceJava) : [])
        ]
      });
    }

    new CustomUI().addComplexTabs(tabs).loadPage(t('debugger.status'));
  }
}

async function readActiveJob(content: IBMiContent, job: string) {
  try {
    return (await content.runSQL(
      `select job_name_short, job_user, job_number, subsystem_library_name || '/' || subsystem as subsystem, authorization_name, job_status, memory_pool from table(qsys2.active_job_info(job_name_filter => '${job.substring(job.lastIndexOf('/') + 1)}')) where job_name = '${job}' fetch first row only`
    )).at(0);
  } catch (error) {
    return String(error);
  }
}

async function readJVMInfo(content: IBMiContent, job: string) {
  try {
    return (await content.runSQL(`
      select START_TIME, JAVA_HOME, USER_DIRECTORY, CURRENT_HEAP_SIZE, MAX_HEAP_SIZE
      from QSYS2.JVM_INFO
      where job_name = '${job}'
      fetch first row only`)).at(0);
  } catch (error) {
    return String(error);
  }
}

function getActiveJobFields(label: string, jobRow: Tools.DB2Row | string): Field[] {
  return new Section().addParagraph(`<h4> ${label} </h4>
        <ul>
      ${Object.entries(jobRow).filter(([key, value]) => value !== null).map(([key, value]) => `<li>${t(key)}: ${value}</li>`).join("")}
        </ul>`).fields;
  ;
}

//JOB_NAME_SHORT, JOB_USER, JOB_NUMBER, SUBSYSTEM, SUBSYSTEM_LIBRARY_NAME, AUTHORIZATION_NAME, JOB_STATUS, MEMORY_POOL
//START_TIME, JAVA_HOME, USER_DIRECTORY, CURRENT_HEAP_SIZE, MAX_HEAP_SIZE