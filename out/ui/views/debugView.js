"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initializeDebugBrowser = void 0;
const vscode_1 = __importDefault(require("vscode"));
const DebugConfiguration_1 = require("../../api/configuration/DebugConfiguration");
const certificates_1 = require("../../debug/certificates");
const server_1 = require("../../debug/server");
const instantiate_1 = require("../../instantiate");
const Tools_1 = require("../Tools");
const types_1 = require("../types");
const title = "IBM i debugger";
function initializeDebugBrowser(context) {
    const debugBrowser = new DebugBrowser();
    const debugTreeViewer = vscode_1.default.window.createTreeView(`ibmiDebugBrowser`, {
        treeDataProvider: debugBrowser,
        showCollapseAll: true
    });
    const updateDebugBrowser = async () => {
        const connection = instantiate_1.instance.getConnection();
        if (connection) {
            debugTreeViewer.title = `${title} ${(await (0, DebugConfiguration_1.getDebugServiceDetails)(connection)).version}`;
            debugTreeViewer.description = await (0, server_1.isDebugEngineRunning)() ? vscode_1.default.l10n.t(`Online`) : vscode_1.default.l10n.t(`Offline`);
        }
        else {
            debugTreeViewer.title = title;
            debugTreeViewer.description = "";
        }
        debugBrowser.refresh();
    };
    instantiate_1.instance.subscribe(context, "connected", "Update Debug Browser", updateDebugBrowser);
    instantiate_1.instance.subscribe(context, "disconnected", "Update Debug Browser", updateDebugBrowser);
    context.subscriptions.push(debugTreeViewer, vscode_1.default.commands.registerCommand("code-for-ibmi.debug.refresh", updateDebugBrowser), vscode_1.default.commands.registerCommand("code-for-ibmi.debug.refresh.item", (item) => debugBrowser.refresh(item)), vscode_1.default.commands.registerCommand("code-for-ibmi.debug.job.start", (item) => Tools_1.VscodeTools.withContext(`code-for-ibmi:debugWorking`, () => item.start())), vscode_1.default.commands.registerCommand("code-for-ibmi.debug.job.stop", (item) => Tools_1.VscodeTools.withContext(`code-for-ibmi:debugWorking`, () => item.stop())), vscode_1.default.commands.registerCommand("code-for-ibmi.debug.job.restart", async (item) => Tools_1.VscodeTools.withContext(`code-for-ibmi:debugWorking`, async () => await item.stop() && item.start())));
}
exports.initializeDebugBrowser = initializeDebugBrowser;
class DebugBrowser {
    _emitter = new vscode_1.default.EventEmitter();
    onDidChangeTreeData = this._emitter.event;
    refresh(item) {
        this._emitter.fire(item);
    }
    getTreeItem(element) {
        return element;
    }
    async getChildren(item) {
        return Tools_1.VscodeTools.withContext(`code-for-ibmi:debugWorking`, async () => item?.getChildren?.() || this.getRootItems());
    }
    async getRootItems() {
        const connection = instantiate_1.instance.getConnection();
        if (connection) {
            const debugConfig = await new DebugConfiguration_1.DebugConfiguration(connection).load();
            const certificates = {
                remoteCertificate: await (0, certificates_1.remoteCertificatesExists)(debugConfig),
                remoteCertificatePath: debugConfig.getRemoteServiceCertificatePath()
            };
            if (certificates.remoteCertificate) {
                try {
                    await (0, certificates_1.checkClientCertificate)(connection, debugConfig);
                }
                catch (error) {
                    certificates.localCertificateIssue = String(error);
                }
            }
            return Promise.all([
                (0, server_1.getDebugServerJob)().then(debugJob => new DebugJobItem("server", vscode_1.default.l10n.t(`Debug Server`), {
                    startFunction: server_1.startServer,
                    stopFunction: server_1.stopServer,
                    debugJob
                })),
                (0, server_1.getDebugServiceJob)().then(debugJob => new DebugJobItem("service", vscode_1.default.l10n.t(`Debug Service`), {
                    startFunction: () => (0, server_1.startService)(connection),
                    stopFunction: () => (0, server_1.stopService)(connection),
                    debugJob,
                    debugConfig,
                    certificates
                }))
            ]);
        }
        else {
            return [];
        }
    }
    async resolveTreeItem(item, element, token) {
        const connection = instantiate_1.instance.getConnection();
        if (connection && element.tooltip === undefined && element instanceof DebugJobItem && element.parameters.debugJob) {
            element.tooltip = new vscode_1.default.MarkdownString(`${vscode_1.default.l10n.t("Listening on port(s)")} ${element.parameters.debugJob.ports.join(", ")}\n\n`);
            const activeJob = await (0, server_1.readActiveJob)(connection, element.parameters.debugJob);
            if (activeJob) {
                const jobToMarkDown = (job) => typeof job === "string" ? job : Object.entries(job).filter(([key, value]) => value !== null).map(([key, value]) => `- ${vscode_1.default.l10n.t(key)}: ${value}`).join("\n");
                element.tooltip.appendMarkdown(jobToMarkDown(activeJob));
                if (element.type === "service") {
                    element.tooltip.appendMarkdown("\n\n");
                    const jvmJob = await (0, server_1.readJVMInfo)(connection, element.parameters.debugJob);
                    if (jvmJob) {
                        element.tooltip.appendMarkdown(jobToMarkDown(jvmJob));
                    }
                }
            }
            return element;
        }
    }
}
class DebugItem extends types_1.BrowserItem {
    async refresh() {
        vscode_1.default.commands.executeCommand("code-for-ibmi.debug.refresh.item", this);
    }
}
class DebugJobItem extends DebugItem {
    type;
    parameters;
    problem;
    constructor(type, label, parameters) {
        let problem;
        let cantRun = false;
        const running = !cantRun && parameters.debugJob !== undefined;
        if (parameters.certificates && parameters.debugConfig) {
            if (!parameters.certificates.remoteCertificate) {
                cantRun = true;
                problem = {
                    context: "noremote",
                    label: vscode_1.default.l10n.t(`Remote certificate not found`),
                    detail: vscode_1.default.l10n.t(`{0} not found under {1}`, DebugConfiguration_1.SERVICE_CERTIFICATE, parameters.certificates.remoteCertificatePath)
                };
            }
            else if (parameters.certificates.localCertificateIssue) {
                problem = {
                    context: "localissue",
                    label: parameters.certificates.localCertificateIssue
                };
            }
        }
        super(label, {
            state: problem ? vscode_1.default.TreeItemCollapsibleState.Expanded : vscode_1.default.TreeItemCollapsibleState.None,
            icon: problem ? "warning" : (running ? "pass" : "error"),
            color: problem ? cantRun ? "testing.iconFailed" : "testing.iconQueued" : (running ? "testing.iconPassed" : "testing.iconFailed")
        });
        this.type = type;
        this.parameters = parameters;
        this.contextValue = `debugJob_${type}${cantRun ? '' : `_${running ? "on" : "off"}`}`;
        this.problem = problem;
        if (running) {
            this.description = this.parameters.debugJob.name;
        }
        else {
            this.description = vscode_1.default.l10n.t(`Offline`);
            this.tooltip = "";
        }
    }
    getChildren() {
        if (this.problem) {
            return [new CertificateIssueItem(this.problem)];
        }
    }
    async start() {
        const title = this.type === "server" ? vscode_1.default.l10n.t("Starting debug server...") : vscode_1.default.l10n.t("Starting debug service...");
        return vscode_1.default.window.withProgress({ title, location: vscode_1.default.ProgressLocation.Window }, this.parameters.startFunction);
    }
    async stop() {
        const title = this.type === "server" ? vscode_1.default.l10n.t("Stopping debug server...") : vscode_1.default.l10n.t("Stopping debug service...");
        return vscode_1.default.window.withProgress({ title, location: vscode_1.default.ProgressLocation.Window }, this.parameters.stopFunction);
    }
}
class CertificateIssueItem extends DebugItem {
    constructor(issue) {
        super(issue.label);
        this.description = issue.detail;
        this.tooltip = issue.detail || '';
        this.contextValue = `certificateIssue_${issue.context}`;
    }
}
//# sourceMappingURL=debugView.js.map