import { readFileSync } from "fs";
import vscode from "vscode";
import { CustomUI, Field, Page, Section } from "../../api/CustomUI";
import IBMiContent from "../../api/IBMiContent";
import { Tools } from "../../api/Tools";
import { isManaged } from "../../api/debug";
import { getLocalCertPath, getRemoteCertificateDirectory, localClientCertExists, readRemoteCertificate, remoteServerCertificateExists } from "../../api/debug/certificates";
import { DebugJob, getDebugServerJob, getDebugServiceJob, startServer, startService, stopServer, stopService } from "../../api/debug/server";
import { instance } from "../../instantiate";
import { t } from "../../locale";

type DebuggerPage = {
  buttons?: string
}


export async function openDebugStatusPanel() {
  const content = instance.getContent();
  const config = instance.getConfig()
  const connection = instance.getConnection();
  if (content && config && connection) {
    const debbuggerInfo = await vscode.window.withProgress({ title: t("loading.debugger.info"), location: vscode.ProgressLocation.Notification }, async () => {
      const serverJob = await getDebugServerJob();
      const activeServerJob = serverJob ? await readActiveJob(content, serverJob) : undefined;
      const serviceJob = await getDebugServiceJob();
      const activeServiceJob = serviceJob ? await readActiveJob(content, serviceJob) : undefined;
      const activeServiceJava = serviceJob ? await readJVMInfo(content, serviceJob) : undefined;
      const remoteCertificateExists = await remoteServerCertificateExists(connection);

      let localCertificate = undefined;
      let remoteCertificate = undefined;
      let localError = undefined;
      let remoteError = undefined;
      if (config.debugIsSecure) {
        try {
          remoteCertificate = await readRemoteCertificate(connection);
        }
        catch (error: any) {
          remoteError = String(error);
        }

        try {
          if (await localClientCertExists(connection)) {
            localCertificate = readFileSync(getLocalCertPath(connection)).toString("utf-8");
          }
        }
        catch (error: any) {
          localError = String(error);
        }
      }

      return {
        server: serverJob ? { job: serverJob, activeJob: activeServerJob } : undefined,
        service: serviceJob ? { job: serviceJob, activeJob: activeServiceJob, java: activeServiceJava } : undefined,
        certificate: { remoteExists: remoteCertificateExists, local: localCertificate, localError, remote: remoteCertificate, remoteError }
      };
    });

    const debugManaged = isManaged();

    const summary = new Section()
      //Debug Server summary
      .addParagraph(/* html */`
      <h4>${t("debug.server")} ${debbuggerInfo.server ? "✅" : "❌"}</h4>
      <ul>
        <li>${t("status")}: ${debbuggerInfo.server ? t("online") : t("offline")}</li>
        ${debbuggerInfo.server ? /* html */ `
        <li>${t("job")}: ${debbuggerInfo.server.job.name}</li>
        <li>${t("listening.on.port")}: ${debbuggerInfo.server.job.port}</li>`
          : ""
        }
    </ul>`);
    addStartStopButtons("server", summary, debbuggerInfo.server !== undefined);

    //Debug Service summary
    summary.addHorizontalRule()
      .addParagraph(/* html */`
    <h4>${t("debug.service")} ${debbuggerInfo.service ? "✅" : "❌"}</h4>
    <ul>
    <li>${t("status")}: ${debbuggerInfo.service ? t("online") : t("offline")} </li>
        ${debbuggerInfo.service ? /* html */ `
        <li>${t("job")}: ${debbuggerInfo.service.job.name}</li>
        <li>${t("listening.on.port")}: ${debbuggerInfo.service.job.port}</li>
        `
          : ""
        }        
    </ul>`);
    addStartStopButtons("service", summary, debbuggerInfo.service !== undefined);

    //Certificates summary
    const certificatesMatch = certificateMatchStatus(debbuggerInfo.certificate);
    summary.addHorizontalRule()
      .addParagraph(/* html */`
      <h4>${t("debug.service.certificate")} ${config.debugIsSecure ? certificatesMatch : (debbuggerInfo.certificate.remoteExists ? "✅" : "❌")}</h4>      
      <ul>
        <li>${t("service.certificate.exists")}: ${debbuggerInfo.certificate.remoteExists ? "✅" : t("not.found.in", getRemoteCertificateDirectory(connection))}</li>
        ${config.debugIsSecure ? /* html */`
        <li>${t("local.certificate")}: ${debbuggerInfo.certificate.localError ? debbuggerInfo.certificate.localError : "✅"}</li>
        <li>${t("certificates.match")}: ${debbuggerInfo.certificate.remoteError ? "❓" : certificatesMatch}</li>
        `
          : ""
        }
      </ul>`)
      .addButtons(
        !debbuggerInfo.certificate.remoteExists ? { id: `service.generateCertificate`, label: t("generate.certificate") } : undefined,
        debbuggerInfo.certificate.remoteExists && config.debugIsSecure && !certificatesMatch ? { id: `service.downloadCertificate`, label: t("download.certificate") } : undefined
      );

    const tabs = [{
      label: t("overview"), fields: summary.fields
    }];

    //Debug server details
    if (debbuggerInfo.server?.activeJob) {
      tabs.push({
        label: t("debug.server"),
        fields: getActiveJobFields(t("active.job"), debbuggerInfo.server?.activeJob)
      });
    }

    //Debug service details
    if (debbuggerInfo.service?.activeJob) {
      tabs.push({
        label: t("debug.service"),
        fields: [
          ...getActiveJobFields(t("active.job"), debbuggerInfo.service?.activeJob),
          ...(debbuggerInfo.service.java ? getActiveJobFields(t("jvm.info"), debbuggerInfo.service.java) : [])
        ]
      });
    }

    new CustomUI()
      .addComplexTabs(tabs)
      .loadPage<DebuggerPage>(t('debugger.status'), handleAction);
  }
}

function addStartStopButtons(target: "server" | "service", section: Section, running: boolean) {
  section.addButtons(
    running ? undefined : { id: `${target}.start`, label: t("start") },
    running ? { id: `${target}.restart`, label: t("restart") } : undefined,
    running ? { id: `${target}.stop`, label: t("stop") } : undefined
  );
}

async function readActiveJob(content: IBMiContent, job: DebugJob) {
  try {
    return (await content.runSQL(
      `select job_name_short, job_user, job_number, subsystem_library_name || '/' || subsystem as subsystem, authorization_name, job_status, memory_pool from table(qsys2.active_job_info(job_name_filter => '${job.name.substring(job.name.lastIndexOf('/') + 1)}')) where job_name = '${job.name}' fetch first row only`
    )).at(0);
  } catch (error) {
    return String(error);
  }
}

async function readJVMInfo(content: IBMiContent, job: DebugJob) {
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

function getActiveJobFields(label: string, jobRow: Tools.DB2Row | string): Field[] {
  return new Section().addParagraph(/*html*/ `<h4>${label}</h4>
    <ul>${typeof jobRow === "string" ?
      jobRow
      :
      Object.entries(jobRow).filter(([key, value]) => value !== null).map(([key, value]) => /*html*/ `<li>${t(key)}: ${value}</li>`).join("")
    }</ul>`
  ).fields;
}

function certificateMatchStatus(certificate: { local?: string, remote?: string }) {
  return certificate.local && (certificate.local === certificate.remote) ? "✅" : "❌";
}

function handleAction(page: Page<DebuggerPage>) {
  const actionParts = page.data?.buttons?.split('.');
  const target = actionParts?.at(0);
  const action = actionParts?.at(1);
  console.log(target, action);
  if (action) {
    let result;
    if (target === "server") {
      result = handleServerAction(action);
    }
    else if (target === "service") {
      result = handleServiceAction(action);
    }

    result?.then(reload => {
      if (reload) {
        page.panel.dispose();
        openDebugStatusPanel();
      }
    });
  }
}

async function handleServerAction(action: string): Promise<boolean> {
  switch (action) {
    case "start":
      return startServer();
    case "restart":
      return await stopServer() && startServer();
    case "stop":
      return stopServer();
  }

  return false;
}

async function handleServiceAction(action: string): Promise<boolean> {
  const connection = instance.getConnection();
  if (connection) {
    const start = () => vscode.window.withProgress({ title: t('start.debug.service.task'), location: vscode.ProgressLocation.Notification }, () => startService(connection));
    const stop = () => vscode.window.withProgress({ title: t('stop.debug.service.task'), location: vscode.ProgressLocation.Notification }, () => stopService(connection));
    switch (action) {
      case "start":
        return start();
      case "restart":
        return await stop() && start();
      case "stop":
        return stop();
      case "generateCertificate":
      case "downloadCertificate":
    }
  }

  return false;
}