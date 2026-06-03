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
exports.loadAllofExtension = exports.safeDisconnect = exports.instance = void 0;
const vscode = __importStar(require("vscode"));
const DebugConfiguration_1 = require("./api/configuration/DebugConfiguration");
const actions_1 = require("./commands/actions");
const compare_1 = require("./commands/compare");
const connection_1 = require("./commands/connection");
const open_1 = require("./commands/open");
const password_1 = require("./commands/password");
const Configuration_1 = require("./config/Configuration");
const server_1 = require("./debug/server");
const git_1 = require("./filesystems/local/git");
const QSysFs_1 = require("./filesystems/qsys/QSysFs");
const Instance_1 = __importDefault(require("./Instance"));
const Terminal_1 = require("./ui/Terminal");
const disconnectBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 12);
disconnectBarItem.command = {
    command: `code-for-ibmi.disconnect`,
    title: `Disconnect from system`
};
disconnectBarItem.tooltip = `Disconnect from system.`;
disconnectBarItem.text = `$(debug-disconnect)`;
const connectedBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10);
connectedBarItem.command = {
    command: `code-for-ibmi.showAdditionalSettings`,
    title: `Show connection settings`
};
async function safeDisconnect() {
    let doDisconnect = true;
    for (const document of vscode.workspace.textDocuments) {
        // This code will check that sources are saved before closing
        if (!document.isClosed && [`member`, `streamfile`, `object`].includes(document.uri.scheme)) {
            if (document.isDirty) {
                if (doDisconnect) {
                    if (await vscode.window.showTextDocument(document).then(() => vscode.window.showErrorMessage(`Cannot disconnect while files have not been saved.`, 'Disconnect anyway'))) {
                        break;
                    }
                    else {
                        doDisconnect = false;
                    }
                }
            }
        }
    }
    if (doDisconnect) {
        await exports.instance.disconnect();
    }
    return doDisconnect;
}
exports.safeDisconnect = safeDisconnect;
async function loadAllofExtension(context) {
    // No connection when the extension is first activated
    vscode.commands.executeCommand(`setContext`, `code-for-ibmi:connected`, false);
    exports.instance = new Instance_1.default(context);
    context.subscriptions.push(connectedBarItem, disconnectBarItem, ...(0, connection_1.registerConnectionCommands)(context, exports.instance), (0, Configuration_1.onCodeForIBMiConfigurationChange)("connectionSettings", updateConnectedBar), ...(0, open_1.registerOpenCommands)(exports.instance), ...(0, compare_1.registerCompareCommands)(), ...(0, actions_1.registerActionsCommands)(exports.instance), ...Terminal_1.Terminal.registerTerminalCommands(context), ...(0, password_1.registerPasswordCommands)(context, exports.instance), vscode.commands.registerCommand("code-for-ibmi.updateConnectedBar", updateConnectedBar));
    exports.instance.subscribe(context, 'connected', 'Load status bars', onConnected);
    exports.instance.subscribe(context, 'disconnected', 'Unload status bars', onDisconnected);
    context.subscriptions.push(vscode.workspace.registerFileSystemProvider(`member`, new QSysFs_1.QSysFS(context), {
        isCaseSensitive: false
    }));
    // Register git events based on workspace folders
    if (vscode.workspace.workspaceFolders) {
        (0, git_1.setupGitEventHandler)(context);
    }
}
exports.loadAllofExtension = loadAllofExtension;
async function updateConnectedBar() {
    const connection = exports.instance.getConnection();
    if (connection) {
        const config = connection.getConfig();
        const remoteConnectionConfig = connection.getConfigFile(`settings`);
        const serverConfigOk = remoteConnectionConfig.getState() === `ok`;
        let serverConfig;
        if (serverConfigOk) {
            serverConfig = await remoteConnectionConfig.get();
        }
        const systemReadOnly = serverConfig?.codefori?.readOnlyMode || false;
        connectedBarItem.text = `$(${systemReadOnly ? "shield" : (config.readOnlyMode ? "lock" : "settings-gear")}) ${config.name}${config.currentProfile ? ` (${config.currentProfile})` : ''}`;
        const terminalMenuItem = systemReadOnly ? `` : `[$(terminal) Terminals](command:code-for-ibmi.launchTerminalPicker)`;
        const actionsMenuItem = systemReadOnly ? `` : `[$(file-binary) Actions](command:code-for-ibmi.environment.actions.focus)`;
        const debugRunning = await (0, server_1.isDebugEngineRunning)();
        const connectedBarItemTooltips = systemReadOnly ? [`[System-wide read only](https://codefori.github.io/docs/settings/system/)`] : [];
        connectedBarItemTooltips.push(`[$(settings-gear) Settings](command:code-for-ibmi.showAdditionalSettings)`, terminalMenuItem, actionsMenuItem, (0, server_1.debugPTFInstalled)(connection) ?
            `[$(${debugRunning ? "bug" : "debug"}) Debugger ${((await (0, DebugConfiguration_1.getDebugServiceDetails)(connection)).version)} (${debugRunning ? "on" : "off"})](command:ibmiDebugBrowser.focus)`
            :
                `[$(debug) No debug PTF](https://codefori.github.io/docs/developing/debug/#required-ptfs)`);
        connectedBarItem.tooltip = new vscode.MarkdownString(connectedBarItemTooltips.join(`\n\n---\n\n`), true);
        connectedBarItem.tooltip.isTrusted = true;
        vscode.commands.executeCommand(`setContext`, `code-for-ibmi:isReadonly`, config?.readOnlyMode || systemReadOnly);
        vscode.commands.executeCommand(`setContext`, `code-for-ibmi:isSystemReadonly`, systemReadOnly);
    }
}
async function onConnected() {
    [
        connectedBarItem,
        disconnectBarItem,
    ].forEach(barItem => barItem.show());
    updateConnectedBar();
}
async function onDisconnected() {
    // Close the tabs with no dirty editors
    vscode.window.tabGroups.all
        .filter(group => !group.tabs.some(tab => tab.isDirty))
        .forEach(group => {
        group.tabs.forEach(tab => {
            if (tab.input instanceof vscode.TabInputText) {
                const uri = tab.input.uri;
                if ([`member`, `streamfile`, `object`].includes(uri.scheme)) {
                    vscode.window.tabGroups.close(tab);
                }
            }
        });
    });
    // Hide the bar items
    [
        disconnectBarItem,
        connectedBarItem,
    ].forEach(barItem => barItem.hide());
}
//# sourceMappingURL=instantiate.js.map