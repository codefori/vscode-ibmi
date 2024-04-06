import vscode from "vscode";
import { DebugJob, getDebugServerJob, getDebugServiceDetails, getDebugServiceJob, isDebugEngineRunning, startServer, startService, stopServer, stopService } from "../api/debug/server";
import { instance } from "../instantiate";
import { t } from "../locale";
import { BrowserItem } from "../typings";

const title = "IBM i debugger";

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
      debugTreeViewer.description = await isDebugEngineRunning() ? t("online") : t("offline");
    }
    else {
      debugTreeViewer.title = title;
      debugTreeViewer.description = "";
    }

    debugBrowser.refresh();
  }

  instance.onEvent("connected", updateDebugBrowser);
  instance.onEvent("disconnected", updateDebugBrowser);

  context.subscriptions.push(
    debugTreeViewer,
    vscode.commands.registerCommand("code-for-ibmi.debug.refresh", updateDebugBrowser),
    vscode.commands.registerCommand("code-for-ibmi.debug.refresh.item", (item: DebugItem) => debugBrowser.refresh(item)),
    vscode.commands.registerCommand("code-for-ibmi.debug.job.start", (item: DebugJobItem) => item.start()),
    vscode.commands.registerCommand("code-for-ibmi.debug.job.stop", (item: DebugJobItem) => item.stop()),
    vscode.commands.registerCommand("code-for-ibmi.debug.job.restart", async (item: DebugJobItem) => await item.start() && item.stop()),
  );
}

class DebugBrowser implements vscode.TreeDataProvider<DebugItem> {
  private readonly _emitter: vscode.EventEmitter<DebugItem | undefined | null | void> = new vscode.EventEmitter();
  readonly onDidChangeTreeData: vscode.Event<DebugItem | undefined | null | void> = this._emitter.event;

  refresh(item?: DebugItem) {
    this._emitter.fire(item);
  }

  getTreeItem(element: DebugItem) {
    return element;
  }

  async getChildren(): Promise<DebugItem[]> {
    const connection = instance.getConnection();
    if (connection) {
      return [
        new DebugJobItem("server",
          t("debug.server"),
          startServer,
          stopServer,
          await getDebugServerJob()
        ),
        new DebugJobItem("service",
          t("debug.service"),
          () => startService(connection),
          () => stopService(connection),
          await getDebugServiceJob()
        )
      ];
    }
    else {
      return [];
    }
  }
}

class DebugItem extends BrowserItem {
  refresh() {
    vscode.commands.executeCommand("code-for-ibmi.debug.refresh.item", this);
  }
}

class DebugJobItem extends DebugItem {
  constructor(readonly type: "server" | "service", label: string, readonly startFunction: () => Promise<boolean>, readonly stopFunction: () => Promise<boolean>, readonly debugJob?: DebugJob) {
    const running = debugJob !== undefined;
    super(label, {
      state: vscode.TreeItemCollapsibleState.None,
      icon: running ? "pass" : "error",
      color: running ? "testing.iconPassed" : "testing.iconFailed"
    });
    this.contextValue = `debugJob_${type}_${running ? "on" : "off"}`;
    if (running) {
      this.description = debugJob.name;
      this.tooltip = `${t(`listening.on.port${debugJob?.ports.length === 1 ? '' : 's'}`)} ${debugJob?.ports.join(", ")}`;
    }
    else {
      this.description = t("offline");
    }
  }

  async start() {
    return vscode.window.withProgress({ title: t(`start.debug.${this.type}.task`), location: vscode.ProgressLocation.Window }, this.startFunction);
  }

  async stop() {
    return vscode.window.withProgress({ title: t(`stop.debug.${this.type}.task`), location: vscode.ProgressLocation.Window }, this.stopFunction);
  }
}