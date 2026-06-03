"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.HelpView = void 0;
const adm_zip_1 = __importDefault(require("adm-zip"));
const path_1 = __importStar(require("path"));
const vscode_1 = __importStar(require("vscode"));
const DebugConfiguration_1 = require("../../api/configuration/DebugConfiguration");
const instantiate_1 = require("../../instantiate");
class HelpView {
    _onDidChangeTreeData = new vscode_1.default.EventEmitter();
    onDidChangeTreeData = this._onDidChangeTreeData.event;
    constructor(context) {
        vscode_1.default.commands.registerCommand("code-for-ibmi.openNewIssue", openNewIssue);
        vscode_1.default.commands.registerCommand("code-for-ibmi.downloadLogs", downloadLogs);
        instantiate_1.instance.subscribe(context, `connected`, 'Refresh Help View', () => this.refresh());
        instantiate_1.instance.subscribe(context, `disconnected`, 'Refresh Help View', () => this.refresh());
    }
    refresh(element) {
        this._onDidChangeTreeData.fire(element);
    }
    getTreeItem(element) {
        return element;
    }
    async getChildren() {
        const children = [
            new HelpOpenUrlItem(`book`, vscode_1.default.l10n.t(`Get Started & Documentation`), `https://codefori.github.io/docs/#/`),
            new HelpOpenUrlItem(`output`, vscode_1.default.l10n.t(`Open official Forum`), `https://github.com/codefori/vscode-ibmi/discussions`),
            new HelpOpenUrlItem(`eye`, vscode_1.default.l10n.t(`Review Issues`), `https://github.com/codefori/vscode-ibmi/issues/`),
            new HelpIssueItem()
        ];
        const connection = instantiate_1.instance.getConnection();
        if (connection) {
            children.push(new HelpLogItem());
        }
        return children;
    }
}
exports.HelpView = HelpView;
class HelpItem extends vscode_1.default.TreeItem {
    text;
    constructor(icon, text) {
        super(text, vscode_1.default.TreeItemCollapsibleState.None);
        this.text = text;
        this.contextValue = `helpItem`;
        this.iconPath = new vscode_1.default.ThemeIcon(icon);
        this.tooltip = ``;
    }
}
class HelpOpenUrlItem extends HelpItem {
    constructor(icon, text, url) {
        super(icon, text);
        this.command = {
            command: `vscode.open`,
            title: text,
            arguments: [vscode_1.default.Uri.parse(url)]
        };
    }
}
class HelpIssueItem extends HelpItem {
    constructor() {
        super(`bug`, vscode_1.default.l10n.t(`Report an Issue`));
        this.command = {
            command: "code-for-ibmi.openNewIssue",
            title: this.text
        };
    }
}
class HelpLogItem extends HelpItem {
    constructor() {
        super(`archive`, vscode_1.default.l10n.t(`Download Logs`));
        this.command = {
            command: "code-for-ibmi.downloadLogs",
            title: this.text
        };
    }
}
async function openNewIssue() {
    const code4ibmi = vscode_1.default.extensions.getExtension("halcyontechltd.code-for-ibmi");
    const issue = [
        `<!-- 👉🏻 Issue text goes here. -->`,
        ``,
        `<hr />`,
        ``,
        `<!-- ⚠️ **REMOVE THIS LINE AND ANY SENSITIVE INFORMATION BELOW!** ⚠️ -->`,
        ``,
        '|Context|Version|',
        '|-|-|',
        `|Code for IBM i version|${code4ibmi?.packageJSON.version}|`,
        `|${vscode_1.default.env.appName} version|${vscode_1.default.version}|`,
        `|Operating System|${process.platform}_${process.arch}|`,
        ``,
        getExtensions(true),
        ``,
        `<hr />`,
        ``,
        await getRemoteSection(),
    ].join(`\n`);
    let issueUrl = encodeURIComponent(issue);
    if (issueUrl.length > 8130) {
        //Empirically tested: issueUrl must not exceed 8130 characters
        if (await vscode_1.default.window.showWarningMessage("Issue data is too long. It will be truncated.", "Copy full data to clipboard")) {
            await vscode_1.default.env.clipboard.writeText(issue);
        }
        issueUrl = issueUrl.substring(0, 8130);
    }
    const target = (await vscode_1.default.window.showQuickPick([
        { label: "Code for IBM i", target: 'vscode-ibmi' },
        { label: "Db2 for IBM i", target: 'vscode-db2i' },
        { label: "RPGLE language tools", target: 'vscode-rpgle' },
        { label: "IBM i Debugger", target: 'vscode-ibmi-debug-issues' },
    ], { title: vscode_1.l10n.t("Please pick the extension to report the issue on"), placeHolder: vscode_1.l10n.t("Report an issue on...") }))?.target;
    if (target) {
        vscode_1.default.commands.executeCommand(`vscode.open`, `https://github.com/codefori/${target}/issues/new?body=${issueUrl}`);
    }
}
async function downloadLogs() {
    const connection = instantiate_1.instance.getConnection();
    const logs = [];
    if (connection) {
        const content = connection.getContent();
        await vscode_1.default.window.withProgress({
            location: vscode_1.default.ProgressLocation.Notification,
            title: vscode_1.default.l10n.t(`Gathering logs...`),
        }, async () => {
            const codeForIBMiLog = instantiate_1.instance.getOutputContent();
            if (codeForIBMiLog !== undefined) {
                logs.push({
                    label: vscode_1.default.l10n.t(`Code for IBM i Log`),
                    detail: `${connection?.currentUser}@${connection?.currentHost}`,
                    picked: true,
                    fileName: 'CodeForIBMi.txt',
                    fileContent: Buffer.from(codeForIBMiLog, 'utf8')
                });
            }
            const debugConfig = await new DebugConfiguration_1.DebugConfiguration(connection).load();
            try {
                const debugServiceLogPath = `${debugConfig.getRemoteServiceWorkDir()}/DebugService_log.txt`;
                const debugServiceLog = (await content.downloadStreamfileRaw(debugServiceLogPath));
                if (debugServiceLog) {
                    logs.push({
                        label: vscode_1.default.l10n.t(`Debug Service Log`),
                        detail: debugServiceLogPath,
                        picked: true,
                        fileName: 'DebugService.txt',
                        fileContent: debugServiceLog
                    });
                }
            }
            catch (err) { }
            try {
                const debugNavigatorLogPath = debugConfig.getNavigatorLogFile();
                const debugNavigatorLog = (await content.downloadStreamfileRaw(debugNavigatorLogPath));
                if (debugNavigatorLog) {
                    logs.push({
                        label: vscode_1.default.l10n.t(`Debug Service Navigator Log`),
                        detail: debugNavigatorLogPath,
                        picked: true,
                        fileName: 'startDebugServiceNavigator.log',
                        fileContent: debugNavigatorLog
                    });
                }
            }
            catch (err) { }
            try {
                const debugServiceEclipseInstancePath = `${debugConfig.getRemoteServiceWorkDir()}/startDebugService_workspace/.metadata/.log`;
                const debugServiceEclipseInstanceLog = (await content.downloadStreamfileRaw(debugServiceEclipseInstancePath));
                if (debugServiceEclipseInstanceLog) {
                    logs.push({
                        label: vscode_1.default.l10n.t(`Debug Service Eclipse Instance Log`),
                        detail: debugServiceEclipseInstancePath,
                        picked: true,
                        fileName: 'DebugServiceEclipseInstance.txt',
                        fileContent: debugServiceEclipseInstanceLog
                    });
                }
            }
            catch (err) { }
        });
        if (logs.length > 0) {
            const selectedLogs = await vscode_1.default.window.showQuickPick(logs, {
                title: vscode_1.default.l10n.t(`Select the logs you would like to download`),
                canPickMany: true,
                matchOnDetail: true
            });
            if (selectedLogs && selectedLogs.length > 0) {
                const downloadTo = await vscode_1.default.window.showOpenDialog({
                    title: vscode_1.default.l10n.t(`Download To`),
                    canSelectFolders: true,
                    canSelectFiles: false,
                    canSelectMany: false,
                });
                if (downloadTo) {
                    const today = new Date();
                    const year = today.getFullYear();
                    const month = (today.getMonth() + 1).toString().padStart(2, '0');
                    const day = today.getDate().toString().padStart(2, '0');
                    const hours = today.getHours().toString().padStart(2, '0');
                    const minutes = today.getMinutes().toString().padStart(2, '0');
                    const seconds = today.getSeconds().toString().padStart(2, '0');
                    const zipFile = `CodeForIBMi_${year}${month}${day}_${hours}${minutes}${seconds}.zip`;
                    const downloadLocation = path_1.default.join(downloadTo[0].fsPath, zipFile);
                    try {
                        const zip = new adm_zip_1.default();
                        for (const log of selectedLogs) {
                            zip.addFile(log.fileName, log.fileContent);
                        }
                        const result = await zip.writeZipPromise(downloadLocation, { overwrite: false });
                        if (result) {
                            const result = await vscode_1.default.window.showInformationMessage(vscode_1.default.l10n.t(`Successfully downloaded logs to {0}`, zipFile), vscode_1.default.l10n.t(`Open`));
                            if (result && result === vscode_1.default.l10n.t(`Open`)) {
                                vscode_1.default.commands.executeCommand('revealFileInOS', vscode_1.default.Uri.file(downloadLocation));
                            }
                        }
                        else {
                            await vscode_1.default.window.showErrorMessage(vscode_1.default.l10n.t(`Failed to downloaded logs to {0}`, zipFile));
                        }
                    }
                    catch (error) {
                        await vscode_1.default.window.showErrorMessage(vscode_1.default.l10n.t(`Failed to download logs to {0}. {1}`, zipFile, error));
                    }
                }
            }
        }
        else {
            await vscode_1.default.window.showErrorMessage(vscode_1.default.l10n.t(`No logs to download`));
        }
    }
    else {
        await vscode_1.default.window.showErrorMessage(vscode_1.default.l10n.t(`Please connect to an IBM i`));
    }
}
function getExtensions(active) {
    return createSection(`${active ? 'Active' : 'Disabled'} extensions`, `\`\`\``, ...vscode_1.default.extensions.all
        .filter(extension => extension.isActive === active)
        .map(extension => extension.packageJSON)
        .filter(p => p.name !== "code-for-ibmi")
        .map(p => `${p.displayName} (${p.name}): ${p.version}`)
        .sort(), `\`\`\``);
}
async function getRemoteSection() {
    const connection = instantiate_1.instance.getConnection();
    if (connection) {
        const config = connection.getConfig();
        return await vscode_1.default.window.withProgress({
            location: vscode_1.default.ProgressLocation.Notification,
            title: `Gathering issue details...`,
        }, async (progress) => {
            let osVersion = {
                OS: "n/a",
                TR: "n/a"
            };
            try {
                const [osVersionRow] = await connection.runSQL(`SELECT PTF_GROUP_TARGET_RELEASE as OS, PTF_GROUP_LEVEL AS TR ` +
                    `FROM QSYS2.GROUP_PTF_INFO ` +
                    `WHERE PTF_GROUP_DESCRIPTION = 'TECHNOLOGY REFRESH' AND PTF_GROUP_STATUS = 'INSTALLED' ` +
                    `ORDER BY PTF_GROUP_TARGET_RELEASE, PTF_GROUP_LEVEL DESC ` +
                    `LIMIT 1`);
                Object.assign(osVersion, osVersionRow);
            }
            catch (error) {
                console.log(`Couldn't run QSYS2.GROUP_PTF_INFO: ${error}`);
                try {
                    const [osVersionRow] = await connection.runSQL(`Select Substring(DATA_AREA_VALUE, 0, 7) as OS ` +
                        `From TABLE(QSYS2.DATA_AREA_INFO(` +
                        `DATA_AREA_NAME => 'QSS1MRI',` +
                        `DATA_AREA_LIBRARY => 'QUSRSYS'))` +
                        `Fetch first row only`);
                    Object.assign(osVersion, osVersionRow);
                }
                catch (anotherError) {
                    console.log(`Couldn't run QSYS2.DATA_AREA_INFO and read QUSRSYS/QSS1MRI: ${error}`);
                }
            }
            const ccsids = connection.getCcsids();
            return [
                createSection(`Remote system`, '|Setting|Value|', '|-|-|', `|IBM i OS|${osVersion?.OS || '?'}|`, `|Tech Refresh|${osVersion?.TR || '?'}|`, `|CCSID Origin|${ccsids.qccsid}|`, `|Runtime CCSID|${ccsids.runtimeCcsid || '?'}|`, `|Default CCSID|${ccsids.userDefaultCCSID || '?'}|`, `|SSHD CCSID|${ccsids.sshdCcsid || '?'}|`, `|cqsh|${connection.canUseCqsh}|`, `|SQL|${connection.enableSQL ? 'Enabled' : 'Disabled'}`, `|Source dates|${config.enableSourceDates ? 'Enabled' : 'Disabled'}`, '', `### Enabled features`, '', ...getRemoteFeatures(connection)),
                ``,
                createSection(`Shell env`, `\`\`\`bash`, ...await getEnv(connection), `\`\`\``),
                ``,
                createSection(`Variants`, `\`\`\`json`, JSON.stringify(connection?.variantChars || {}, null, 2), `\`\`\``),
            ].join("\n");
        });
    }
    else {
        return "**_Not connected_** 🔌";
    }
}
function getRemoteFeatures(connection) {
    const features = new Map;
    Object.values(connection.remoteFeatures).forEach(feature => {
        if (feature) {
            const featurePath = (0, path_1.parse)(feature);
            let featureDir = features.get(featurePath.dir);
            if (!featureDir) {
                featureDir = [];
                features.set(featurePath.dir, featureDir);
            }
            featureDir.push(featurePath.base);
            featureDir.sort();
        }
    });
    const maxLine = Array.from(features.values()).map(e => e.length).sort((len1, len2) => len1 - len2).reverse()[0];
    const dirs = Array.from(features.keys());
    const rows = [];
    for (let i = 0; i < maxLine; i++) {
        rows.push(`|${dirs.map(dir => features.get(dir)[i] || '').join('|')}|`);
    }
    return [
        `|${dirs.join('|')}|`,
        `|${dirs.map(d => '-').join('|')}|`,
        ...rows
    ];
}
async function getEnv(connection) {
    const result = await connection.runCommand({ command: "env", environment: 'pase' });
    if (result?.code === 0 && result.stdout) {
        return result.stdout.split("\n")
            .map(e => e.trim())
            .sort();
    }
    else {
        return [];
    }
}
function createSection(summary, ...details) {
    return [
        '',
        '<details>',
        `<summary>${summary}</summary>`,
        '',
        ...details,
        `</details>`,
        ''
    ].join("\n");
}
//# sourceMappingURL=helpView.js.map