"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initializeConnectionBrowser = void 0;
const vscode_1 = __importDefault(require("vscode"));
const IBMi_1 = __importDefault(require("../../api/IBMi"));
const passwords_1 = require("../../config/passwords");
const instantiate_1 = require("../../instantiate");
const login_1 = require("../../webviews/login");
function initializeConnectionBrowser(context) {
    const connectionBrowser = new ConnectionBrowser(context);
    const connectionTreeViewer = vscode_1.default.window.createTreeView(`connectionBrowser`, {
        treeDataProvider: connectionBrowser,
        showCollapseAll: false,
        canSelectMany: true
    });
    context.subscriptions.push(connectionTreeViewer, vscode_1.default.commands.registerCommand(`code-for-ibmi.connect`, () => {
        if (!connectionBrowser.attemptingConnection) {
            login_1.Login.show(context);
        }
    }), vscode_1.default.commands.registerCommand(`code-for-ibmi.connectToPrevious`, async () => {
        const lastConnection = IBMi_1.default.GlobalStorage.getLastConnections()?.[0];
        if (lastConnection) {
            return await vscode_1.default.commands.executeCommand(`code-for-ibmi.connectTo`, lastConnection.name);
        }
        return false;
    }), vscode_1.default.commands.registerCommand(`code-for-ibmi.connectTo`, async (name, reloadServerSettings) => {
        let connected = false;
        if (!connectionBrowser.attemptingConnection) {
            connectionBrowser.attemptingConnection = true;
            if (!name) {
                const lastConnections = IBMi_1.default.GlobalStorage.getLastConnections() || [];
                if (lastConnections && lastConnections.length) {
                    name = (await vscode_1.default.window.showQuickPick([{ kind: vscode_1.default.QuickPickItemKind.Separator, label: vscode_1.default.l10n.t(`Last connection`) },
                        ...lastConnections.map(lc => ({ label: lc.name, description: vscode_1.default.l10n.t(`Last used: {0}`, new Date(lc.timestamp).toLocaleString()) }))], { title: vscode_1.default.l10n.t(`Last IBM i connections`) }))?.label;
                }
            }
            switch (typeof name) {
                case `string`: // Name of connection object
                    connected = await login_1.Login.LoginToPrevious(name, context, reloadServerSettings);
                    break;
                case `object`: // A Server object
                    connected = await login_1.Login.LoginToPrevious(name.name, context, reloadServerSettings);
                    break;
                default:
                    vscode_1.default.window.showErrorMessage(vscode_1.default.l10n.t(`Use the Server Browser to select which system to connect to.`));
                    break;
            }
            connectionBrowser.attemptingConnection = false;
            return connected;
        }
    }), vscode_1.default.commands.registerCommand(`code-for-ibmi.connectToAndReload`, async (server) => {
        if (!connectionBrowser.attemptingConnection && server) {
            const reloadServerSettings = true;
            return vscode_1.default.commands.executeCommand(`code-for-ibmi.connectTo`, server.name, reloadServerSettings);
        }
        return false;
    }), vscode_1.default.commands.registerCommand(`code-for-ibmi.refreshConnections`, () => {
        connectionBrowser.refresh();
    }), vscode_1.default.commands.registerCommand(`code-for-ibmi.renameConnection`, async (server) => {
        if (!connectionBrowser.attemptingConnection && server) {
            const existingConnections = await IBMi_1.default.connectionManager.getAll();
            const newName = await vscode_1.default.window.showInputBox({
                prompt: vscode_1.default.l10n.t(`Rename connection "{0}"`, server.name),
                value: server.name,
                validateInput: newName => {
                    if (newName === server.name) {
                        return vscode_1.default.l10n.t(`New connection name must be different from its current name`);
                    }
                    else if (existingConnections.findIndex(item => item.name === newName) !== -1) {
                        return vscode_1.default.l10n.t(`Connection "{0}" already exists.`, newName);
                    }
                }
            });
            if (newName) {
                try {
                    // First rename the connection details
                    let { index, data } = (await IBMi_1.default.connectionManager.getByName(server.name));
                    if (index === -1)
                        throw (vscode_1.default.l10n.t(`No connection named "{0}" was found`, server.name));
                    data.name = newName;
                    await IBMi_1.default.connectionManager.updateByIndex(index, data);
                    // Then rename the connection settings
                    const connectionSettings = IBMi_1.default.connectionManager.get(`connectionSettings`) || [];
                    index = connectionSettings.findIndex(connection => connection.name === server.name);
                    if (index === -1)
                        throw (vscode_1.default.l10n.t(`No parameters for connection "{0}" was found`, server.name));
                    connectionSettings[index].name = newName;
                    // Then get the cached connection settings
                    const cachedConnectionSettings = IBMi_1.default.GlobalStorage.getServerSettingsCache(server.name);
                    // Then get the password key
                    const secret = await (0, passwords_1.getStoredPassword)(context, server.name);
                    // No errors - update the settings.
                    await IBMi_1.default.connectionManager.set(`connectionSettings`, connectionSettings);
                    if (cachedConnectionSettings) {
                        IBMi_1.default.GlobalStorage.setServerSettingsCache(newName, cachedConnectionSettings);
                        IBMi_1.default.GlobalStorage.deleteServerSettingsCache(server.name);
                    }
                    if (secret) {
                        await (0, passwords_1.setStoredPassword)(context, newName, secret);
                        await (0, passwords_1.deleteStoredPassword)(context, server.name);
                    }
                    connectionBrowser.refresh();
                }
                catch (e) {
                    vscode_1.default.window.showErrorMessage(vscode_1.default.l10n.t(`Error renaming connection "{0}"! {1}`, server.name, e.message || String(e)));
                }
            }
        }
    }), vscode_1.default.commands.registerCommand(`code-for-ibmi.sortConnections`, async () => {
        await IBMi_1.default.connectionManager.sort();
        connectionBrowser.refresh();
    }), vscode_1.default.commands.registerCommand(`code-for-ibmi.deleteConnection`, async (single, servers) => {
        const toBeDeleted = [];
        if (servers) {
            toBeDeleted.push(...servers);
        }
        else if (single) {
            toBeDeleted.push(single);
        }
        else {
            toBeDeleted.push(...connectionTreeViewer.selection);
        }
        if (!connectionBrowser.attemptingConnection && toBeDeleted.length) {
            const message = toBeDeleted.length === 1 ? vscode_1.default.l10n.t(`Are you sure you want to delete the connection "{0}"?`, toBeDeleted[0].name) : vscode_1.default.l10n.t("Are you sure you want to delete these {0} connections?", toBeDeleted.length);
            const detail = toBeDeleted.length === 1 ? undefined : toBeDeleted.map(server => `- ${server.name}`).join("\n");
            if (await vscode_1.default.window.showWarningMessage(message, { modal: true, detail }, vscode_1.default.l10n.t(`Yes`))) {
                for (const server of toBeDeleted) {
                    // First remove the connection details
                    await IBMi_1.default.connectionManager.deleteByName(server.name);
                    // Also remove the connection settings
                    const connectionSettings = IBMi_1.default.connectionManager.get(`connectionSettings`) || [];
                    const newConnectionSettings = connectionSettings.filter(connection => connection.name !== server.name);
                    await IBMi_1.default.connectionManager.set(`connectionSettings`, newConnectionSettings);
                    // Also remove the cached connection settings
                    IBMi_1.default.GlobalStorage.deleteServerSettingsCache(server.name);
                    // Then remove the password
                    await (0, passwords_1.deleteStoredPassword)(context, server.name);
                }
                connectionBrowser.refresh();
            }
        }
    }), vscode_1.default.commands.registerCommand(`code-for-ibmi.copyConnection`, async (server) => {
        const connectionSettings = IBMi_1.default.connectionManager.get(`connectionSettings`) || [];
        const connection = IBMi_1.default.connectionManager.getByName(server.name);
        const connectionSetting = connectionSettings.find(connection => server.name === connection.name);
        if (connection && connectionSetting) {
            let newConnectionName;
            let copyOperations;
            do {
                newConnectionName = await vscode_1.default.window.showInputBox({
                    prompt: vscode_1.default.l10n.t(`Copy connection "{0}"`, server.name),
                    placeHolder: vscode_1.default.l10n.t(`New connection name`),
                    value: newConnectionName,
                    validateInput: async (value) => await IBMi_1.default.connectionManager.getByName(value) ?
                        vscode_1.default.l10n.t(`Connection "{0}" already exists`, value) :
                        undefined
                });
                if (newConnectionName) {
                    copyOperations = (await vscode_1.default.window.showQuickPick([
                        { label: vscode_1.default.l10n.t(`Home directory`), picked: true, copy: (from, to) => to.homeDirectory = from.homeDirectory },
                        { label: vscode_1.default.l10n.t(`Library list`), picked: true, copy: (from, to) => { to.libraryList = from.libraryList; to.currentLibrary = from.currentLibrary; } },
                        { label: vscode_1.default.l10n.t(`Object filters`), picked: true, copy: (from, to) => to.objectFilters = from.objectFilters },
                        { label: vscode_1.default.l10n.t(`IFS shortcuts`), picked: true, copy: (from, to) => to.ifsShortcuts = from.ifsShortcuts },
                        { label: vscode_1.default.l10n.t(`Custom variables`), picked: true, copy: (from, to) => to.customVariables = from.customVariables },
                        { label: vscode_1.default.l10n.t(`Connection profiles`), picked: true, copy: (from, to) => to.connectionProfiles = from.connectionProfiles }
                    ], {
                        canPickMany: true,
                        title: vscode_1.default.l10n.t(`Select the settings to copy from "{0}" to "{1}"`, server.name, newConnectionName)
                    }))?.map(picked => picked.copy);
                }
            } while (newConnectionName && !copyOperations);
            if (newConnectionName && copyOperations) {
                const newConnection = Object.assign({}, connection.data);
                newConnection.name = newConnectionName;
                await IBMi_1.default.connectionManager.storeNew(newConnection);
                const newConnectionSetting = Object.assign({}, connectionSetting);
                newConnectionSetting.name = newConnectionName;
                newConnectionSetting.homeDirectory = '.';
                newConnectionSetting.currentLibrary = '';
                newConnectionSetting.libraryList = [];
                newConnectionSetting.objectFilters = [];
                newConnectionSetting.ifsShortcuts = [];
                newConnectionSetting.customVariables = [];
                newConnectionSetting.connectionProfiles = [];
                copyOperations.forEach(operation => operation(connectionSetting, newConnectionSetting));
                connectionSettings.push(newConnectionSetting);
                await IBMi_1.default.connectionManager.set(`connectionSettings`, connectionSettings);
                const password = await (0, passwords_1.getStoredPassword)(context, server.name);
                if (password) {
                    await (0, passwords_1.setStoredPassword)(context, newConnectionName, password);
                }
                connectionBrowser.refresh();
            }
        }
    }));
}
exports.initializeConnectionBrowser = initializeConnectionBrowser;
class ConnectionBrowser {
    attemptingConnection = false;
    _emitter = new vscode_1.default.EventEmitter();
    onDidChangeTreeData = this._emitter.event;
    constructor(context) {
        instantiate_1.instance.subscribe(context, 'disconnected', 'Refresh Connection Browser', () => this.refresh());
    }
    refresh() {
        this._emitter.fire(null);
    }
    getTreeItem(element) {
        return element;
    }
    async getChildren() {
        const lastConnection = IBMi_1.default.GlobalStorage.getLastConnections()?.[0];
        return IBMi_1.default.connectionManager.getAll()
            .map(connection => new ServerItem(connection, connection.name === lastConnection?.name));
    }
}
class ServerItem extends vscode_1.default.TreeItem {
    connection;
    constructor(connection, lastConnected) {
        super(connection.name, vscode_1.default.TreeItemCollapsibleState.None);
        this.connection = connection;
        const readOnly = (IBMi_1.default.connectionManager.get(`connectionSettings`) || [])
            .find(settings => connection.name === settings.name)
            ?.readOnlyMode;
        this.contextValue = `server`;
        this.description = `${connection.username}@${connection.host}`;
        this.tooltip = lastConnected ? vscode_1.default.l10n.t(` (previous connection)`) : "";
        this.iconPath = new vscode_1.default.ThemeIcon(readOnly ? `lock` : `remote`, lastConnected ? new vscode_1.default.ThemeColor("notificationsWarningIcon.foreground") : undefined);
        this.command = {
            command: `code-for-ibmi.connectTo`,
            title: vscode_1.default.l10n.t(`Connect`),
            arguments: [this]
        };
    }
    get name() {
        return this.connection.name;
    }
}
//# sourceMappingURL=ConnectionBrowser.js.map