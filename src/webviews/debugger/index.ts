import { readFileSync } from "fs";
import vscode from "vscode";
import { Button, CustomUI, Field, Page, Section } from "../../api/CustomUI";
import { Tools } from "../../api/Tools";
import { isManaged } from "../../api/debug";
import { getLocalCertPath, getRemoteCertificateDirectory, localClientCertExists, readRemoteCertificate, remoteServerCertificateExists, setup } from "../../api/debug/certificates";
import { getDebugServerJob, getDebugServiceDetails, getDebugServiceJob, getServiceConfigurationFile, readActiveJob, readJVMInfo, startServer, startService, stopServer, stopService } from "../../api/debug/server";
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
    const debuggerDetails =await getDebugServiceDetails();
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
        <li>${t("listening.on.port")}: ${debbuggerInfo.server.job.ports[0]}</li>`
          : ""
        }
    </ul>`)
      .addButtons(...getStartStopButtons("server", debbuggerInfo.server !== undefined))

      //Debug Service summary
      .addHorizontalRule()
      .addParagraph(/* html */`
        <h4>${t("debug.service")} ${debbuggerInfo.service ? "✅" : "❌"}</h4>
        <ul>
        <li>${t("status")}: ${debbuggerInfo.service ? t("online") : t("offline")} </li>
            ${debbuggerInfo.service ? /* html */ `
            <li>${t("job")}: ${debbuggerInfo.service.job.name}</li>
            <li>${t("listening.on.ports")}: ${debbuggerInfo.service.job.ports.join(", ")}</li>
            `
          : ""
        }        
        </ul>`)

      .addButtons(
        ...(debbuggerInfo.certificate.remoteExists ? getStartStopButtons("service", debbuggerInfo.service !== undefined) : []),
        { id: "service.openConfig", label: t("open.service.configuration") }
      );

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
        debbuggerInfo.certificate.remoteExists && config.debugIsSecure && !certificatesMatch && debbuggerInfo.service?.job ? { id: `service.downloadCertificate`, label: t("download.certificate") } : undefined
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
      .loadPage<DebuggerPage>(t('debugger.status', debuggerDetails.version), handleAction);
  }
}

function getStartStopButtons(target: "server" | "service", running: boolean): (Button | undefined)[] {
  return [
    running ? undefined : { id: `${target}.start`, label: t("start") },
    running ? { id: `${target}.restart`, label: t("restart") } : undefined,
    running ? { id: `${target}.stop`, label: t("stop") } : undefined
  ];
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
        try {
          await setup(connection);
          return true;
        }
        catch (error: any) {
          vscode.window.showErrorMessage(error);
          return false;
        }
      case "downloadCertificate":
        return await vscode.commands.executeCommand(`code-for-ibmi.debug.setup.local`);
      case "openConfig":
        vscode.commands.executeCommand("code-for-ibmi.openEditable", getServiceConfigurationFile());
        return false;
    }
  }

  return false;
}