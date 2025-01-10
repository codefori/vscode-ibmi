import vscode from "vscode";
import { Tools } from "../api/Tools";
import { checkClientCertificate, debugKeyFileExists, remoteCertificatesExists, SERVICE_CERTIFICATE } from "../api/debug/certificates";
import { DebugConfiguration, getDebugServiceDetails } from "../api/debug/config";
import { DebugJob, getDebugServerJob, getDebugServiceJob, isDebugEngineRunning, readActiveJob, readJVMInfo, startServer, startService, stopServer, stopService } from "../api/debug/server";
import { instance } from "../instantiate";
import { BrowserItem } from "../typings";

const title = "IBM i debugger";
type Certificates = {
  remoteCertificate: boolean
  remoteCertificatePath?: string
  localCertificateIssue?: string
}

type DebugServiceIssue = {
  label: string
  detail?: string
  context: string
}

export function initializeDebugBrowser(context: vscode.ExtensionContext) {
  const debugBrowser = new DebugBrowser();
  const debugTreeViewer = vscode.window.createTreeView(
    `ibmiDebugBrowser`, {
    treeDataProvider: debugBrowser,
    showCollapseAll: true
  });

  const updateDebugBrowser = async () => {
    if (instance.getConnection()) {
      debugTreeViewer.title = `${title} ${(await getDebugServiceDetails()).version}`
      debugTreeViewer.description = await isDebugEngineRunning() ? vscode.l10n.t(`Online`) : vscode.l10n.t(`Offline`);
    }
    else {
      debugTreeViewer.title = title;
      debugTreeViewer.description = "";
    }

    debugBrowser.refresh();
  }

  instance.subscribe(context, "connected", "Update Debug Browser", updateDebugBrowser);
  instance.subscribe(context, "disconnected", "Update Debug Browser", updateDebugBrowser);

  context.subscriptions.push(
    debugTreeViewer,
    vscode.commands.registerCommand("code-for-ibmi.debug.refresh", updateDebugBrowser),
    vscode.commands.registerCommand("code-for-ibmi.debug.refresh.item", (item: DebugItem) => debugBrowser.refresh(item)),
    vscode.commands.registerCommand("code-for-ibmi.debug.job.start", (item: DebugJobItem) => Tools.withContext(`code-for-ibmi:debugWorking`, () => item.start())),
    vscode.commands.registerCommand("code-for-ibmi.debug.job.stop", (item: DebugJobItem) => Tools.withContext(`code-for-ibmi:debugWorking`, () => item.stop())),
    vscode.commands.registerCommand("code-for-ibmi.debug.job.restart", async (item: DebugJobItem) => Tools.withContext(`code-for-ibmi:debugWorking`, async () => await item.stop() && item.start())),
  );
}

class DebugBrowser implements vscode.TreeDataProvider<BrowserItem> {
  private readonly _emitter: vscode.EventEmitter<DebugItem | undefined | null | void> = new vscode.EventEmitter();
  readonly onDidChangeTreeData: vscode.Event<DebugItem | undefined | null | void> = this._emitter.event;

  refresh(item?: DebugItem) {
    this._emitter.fire(item);
  }

  getTreeItem(element: DebugItem) {
    return element;
  }

  async getChildren(item?: DebugItem) {
    return Tools.withContext(`code-for-ibmi:debugWorking`, async () => item?.getChildren?.() || this.getRootItems());
  }

  private async getRootItems() {
    const connection = instance.getConnection();
    if (connection) {
      const debugConfig = await new DebugConfiguration(connection).load();
      const keyFileExists = await debugKeyFileExists(connection, debugConfig);

      const certificates: Certificates = {
        remoteCertificate: await remoteCertificatesExists(debugConfig),
        remoteCertificatePath: debugConfig.getRemoteServiceCertificatePath()
      };

      if (certificates.remoteCertificate) {
        try {
          await checkClientCertificate(connection, debugConfig);
        }
        catch (error) {
          certificates.localCertificateIssue = String(error);
        }
      }

      return Promise.all([
        getDebugServerJob().then(debugJob =>
          new DebugJobItem("server",
            vscode.l10n.t(`Debug Server`),
            {
              startFunction: startServer,
              stopFunction: stopServer,
              debugJob
            })
        ),
        getDebugServiceJob().then(debugJob =>
          new DebugJobItem("service",
            vscode.l10n.t(`Debug Service`), {
            startFunction: () => startService(connection),
            stopFunction: () => stopService(connection),
            debugJob,
            debugConfig,
            certificates,
            keyFileExists
          })
        )
      ]);
    }
    else {
      return [];
    }
  }

  async resolveTreeItem(item: vscode.TreeItem, element: BrowserItem, token: vscode.CancellationToken) {
    const connection = instance.getConnection();
    if (connection && element.tooltip === undefined && element instanceof DebugJobItem && element.parameters.debugJob) {
      element.tooltip = new vscode.MarkdownString(`${vscode.l10n.t("Listening on port(s)")} ${element.parameters.debugJob.ports.join(", ")}\n\n`);
      const activeJob = await readActiveJob(connection, element.parameters.debugJob);
      if (activeJob) {
        const jobToMarkDown = (job: Tools.DB2Row | string) => typeof job === "string" ? job : Object.entries(job).filter(([key, value]) => value !== null).map(([key, value]) => `- ${vscode.l10n.t(key)}: ${value}`).join("\n");
        element.tooltip.appendMarkdown(jobToMarkDown(activeJob));
        if (element.type === "service") {
          element.tooltip.appendMarkdown("\n\n");
          const jvmJob = await readJVMInfo(connection, element.parameters.debugJob);
          if (jvmJob) {
            element.tooltip.appendMarkdown(jobToMarkDown(jvmJob));
          }
        }
      }

      return element;
    }
  }
}

class DebugItem extends BrowserItem {
  refresh() {
    vscode.commands.executeCommand("code-for-ibmi.debug.refresh.item", this);
  }
}

class DebugJobItem extends DebugItem {
  private problem: undefined | DebugServiceIssue;

  constructor(readonly type: "server" | "service", label: string, readonly parameters: {
    startFunction: () => Promise<boolean>,
    stopFunction: () => Promise<boolean>,
    debugJob?: DebugJob,
    certificates?: Certificates,
    debugConfig?: DebugConfiguration,
    keyFileExists?: boolean
  }) {
    let problem: undefined | DebugServiceIssue
    let cantRun = false;
    const running = !cantRun && parameters.debugJob !== undefined;
    if (parameters.certificates && parameters.debugConfig) {
      if (parameters.debugConfig && (!parameters.debugConfig.getCode4iDebug() || !parameters.keyFileExists)) {
        cantRun = true;
        problem = {
          context: "noremote",
          label: vscode.l10n.t(`Incomplete configuration`),
          detail: vscode.l10n.t(`Certificate needs to be regenerated`, SERVICE_CERTIFICATE, parameters.certificates.remoteCertificatePath!)
        }
      }
      else if (!parameters.certificates.remoteCertificate) {
        cantRun = true;
        problem = {
          context: "noremote",
          label: vscode.l10n.t(`Remote certificate not found`),
          detail: vscode.l10n.t(`{0} not found under {1}`, SERVICE_CERTIFICATE, parameters.certificates.remoteCertificatePath!)
        }
      }
      else if (parameters.certificates.localCertificateIssue) {
        problem = {
          context: "localissue",
          label: parameters.certificates.localCertificateIssue
        };
      }
    }

    super(label, {
      state: problem ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None,
      icon: problem ? "warning" : (running ? "pass" : "error"),
      color: problem ? cantRun ? "testing.iconFailed" : "testing.iconQueued" : (running ? "testing.iconPassed" : "testing.iconFailed")
    });
    this.contextValue = `debugJob_${type}${cantRun ? '' : `_${running ? "on" : "off"}`}`;
    this.problem = problem;

    if (running) {
      this.description = this.parameters.debugJob!.name;
    }
    else {
      this.description = vscode.l10n.t(`Offline`);
      this.tooltip = "";
    }
  }

  getChildren() {
    if (this.problem) {
      return [new CertificateIssueItem(this.problem)];
    }
  }

  async start() {
    const title = this.type === "server" ? vscode.l10n.t("Starting debug server...") : vscode.l10n.t("Starting debug service...");
    return vscode.window.withProgress({ title, location: vscode.ProgressLocation.Window }, this.parameters.startFunction);
  }

  async stop() {
    const title = this.type === "server" ? vscode.l10n.t("Stopping debug server...") : vscode.l10n.t("Stopping debug service...");
    return vscode.window.withProgress({ title, location: vscode.ProgressLocation.Window }, this.parameters.stopFunction);
  }
}

class CertificateIssueItem extends DebugItem {
  constructor(issue: DebugServiceIssue) {
    super(issue.label)
    this.description = issue.detail;
    this.tooltip = issue.detail || '';
    this.contextValue = `certificateIssue_${issue.context}`;
  }
}