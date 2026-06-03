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
exports.initializeEnvironmentView = void 0;
const querystring_1 = require("querystring");
const vscode_1 = __importStar(require("vscode"));
const actions_1 = require("../../../api/actions");
const getNewLibl_1 = require("../../../api/components/getNewLibl");
const connectionProfiles_1 = require("../../../api/connectionProfiles");
const IBMi_1 = __importDefault(require("../../../api/IBMi"));
const actionEditor_1 = require("../../../editors/actionEditor");
const connectionProfileEditor_1 = require("../../../editors/connectionProfileEditor");
const instantiate_1 = require("../../../instantiate");
const actions_2 = require("../../actions");
const actions_3 = require("./actions");
const connectionProfiles_2 = require("./connectionProfiles");
const customVariables_1 = require("./customVariables");
function initializeEnvironmentView(context) {
    const environmentView = new EnvironmentView();
    const environmentTreeViewer = vscode_1.default.window.createTreeView(`environmentView`, {
        treeDataProvider: environmentView,
        showCollapseAll: true
    });
    const updateUIContext = async (profileName) => {
        await vscode_1.default.commands.executeCommand(`setContext`, "code-for-ibmi:activeProfile", profileName);
        environmentTreeViewer.description = profileName ? vscode_1.l10n.t("Current profile: {0}", profileName) : vscode_1.l10n.t("No active profile");
        vscode_1.default.commands.executeCommand("code-for-ibmi.updateConnectedBar");
    };
    const localActionsWatcher = vscode_1.default.workspace.createFileSystemWatcher(`**/.vscode/actions.json`);
    localActionsWatcher.onDidCreate(() => environmentView.actionsNode?.forceRefresh());
    localActionsWatcher.onDidChange(() => environmentView.actionsNode?.forceRefresh());
    localActionsWatcher.onDidDelete(() => environmentView.actionsNode?.forceRefresh());
    context.subscriptions.push(environmentTreeViewer, localActionsWatcher, vscode_1.default.window.onDidChangeActiveTextEditor(async (editor) => environmentView.actionsNode?.activeEditorChanged(editor)), vscode_1.default.window.registerFileDecorationProvider({
        provideFileDecoration(uri, token) {
            if (uri.scheme.startsWith(connectionProfiles_2.ProfileItem.contextValue) && uri.query === "active") {
                return { color: new vscode_1.default.ThemeColor(connectionProfiles_2.ProfileItem.activeColor) };
            }
            else if (uri.scheme === actions_3.ActionItem.context) {
                const query = (0, querystring_1.parse)(uri.query);
                if (query.matched && query.canRun) {
                    return { color: new vscode_1.default.ThemeColor(actions_3.ActionItem.matchedCanRunColor) };
                }
                if (query.matched) {
                    return { color: new vscode_1.default.ThemeColor(actions_3.ActionItem.matchedColor) };
                }
                if (query.canRun) {
                    return { color: new vscode_1.default.ThemeColor(actions_3.ActionItem.canRunColor) };
                }
            }
        }
    }), vscode_1.default.commands.registerCommand("code-for-ibmi.environment.refresh", () => environmentView.refresh()), vscode_1.default.commands.registerCommand("code-for-ibmi.environment.refresh.item", (item) => environmentView.refresh(item)), vscode_1.default.commands.registerCommand("code-for-ibmi.environment.reveal", (item, options) => environmentTreeViewer.reveal(item, options)), vscode_1.default.commands.registerCommand("code-for-ibmi.environment.action.search", (node) => node.searchActions()), vscode_1.default.commands.registerCommand("code-for-ibmi.environment.action.search.next", (node) => node.goToNextSearchMatch()), vscode_1.default.commands.registerCommand("code-for-ibmi.environment.action.search.clear", (node) => node.clearSearch()), vscode_1.default.commands.registerCommand("code-for-ibmi.environment.action.create", async (node, from) => {
        const typeNode = "type" in node ? node : (await vscode_1.default.window.showQuickPick((await node.getChildren()).map(typeNode => ({ label: typeNode.label, description: typeNode.description ? typeNode.description : undefined, typeNode })), { title: vscode_1.l10n.t("Select an action type") }))?.typeNode;
        if (typeNode) {
            const existingNames = (await (0, actions_1.getActions)(typeNode.workspace)).map(act => act.name);
            const name = await vscode_1.default.window.showInputBox({
                title: from ? vscode_1.l10n.t("Copy action '{0}'", from.action.name) : vscode_1.l10n.t("New action"),
                placeHolder: vscode_1.l10n.t("Action name..."),
                value: from?.action.name,
                validateInput: name => actions_3.Actions.validateName(name, existingNames)
            });
            if (name) {
                const action = from ? { ...from.action, name } : {
                    name,
                    type: typeNode.type,
                    environment: "ile",
                    command: ''
                };
                await (0, actions_1.updateAction)(action, typeNode.workspace);
                environmentView.actionsNode?.forceRefresh();
                vscode_1.default.commands.executeCommand("code-for-ibmi.environment.action.edit", { action, workspace: typeNode.workspace });
            }
        }
    }), vscode_1.default.commands.registerCommand("code-for-ibmi.environment.action.rename", async (node) => {
        const action = node.action;
        if ((0, actionEditor_1.isActionEdited)(node.action)) {
            vscode_1.default.window.showWarningMessage(vscode_1.l10n.t("Action '{0}' is being edited. Please close its editor first.", action.name));
        }
        else {
            const existingNames = (await (0, actions_1.getActions)(node.workspace)).filter(act => act.name === action.name).map(act => act.name);
            const newName = await vscode_1.default.window.showInputBox({
                title: vscode_1.l10n.t("Rename action"),
                placeHolder: vscode_1.l10n.t("Action name..."),
                value: action.name,
                validateInput: newName => actions_3.Actions.validateName(newName, existingNames)
            });
            if (newName) {
                await (0, actions_1.updateAction)(action, node.workspace, { newName });
                environmentView.actionsNode?.forceRefresh();
            }
        }
    }), vscode_1.default.commands.registerCommand("code-for-ibmi.environment.action.edit", (node) => {
        (0, actionEditor_1.editAction)(node.action, async () => environmentView.actionsNode?.forceRefresh(), node.workspace);
    }), vscode_1.default.commands.registerCommand("code-for-ibmi.environment.action.copy", async (node) => {
        vscode_1.default.commands.executeCommand('code-for-ibmi.environment.action.create', node.parent, node);
    }), vscode_1.default.commands.registerCommand("code-for-ibmi.environment.action.delete", async (node) => {
        if ((0, actionEditor_1.isActionEdited)(node.action)) {
            vscode_1.default.window.showWarningMessage(vscode_1.l10n.t("Action '{0}' is being edited. Please close its editor first.", node.action.name));
        }
        else if (await vscode_1.default.window.showInformationMessage(vscode_1.l10n.t("Do you really want to delete action '{0}' ?", node.action.name), { modal: true }, vscode_1.l10n.t("Yes"))) {
            await (0, actions_1.updateAction)(node.action, node.workspace, { delete: true });
            environmentView.actionsNode?.forceRefresh();
        }
    }), vscode_1.default.commands.registerCommand("code-for-ibmi.environment.action.runOnEditor", (node) => {
        const uri = vscode_1.default.window.activeTextEditor?.document.uri;
        if (uri) {
            const editAction = () => vscode_1.default.commands.executeCommand("code-for-ibmi.environment.action.edit", node);
            const editActionLabel = vscode_1.l10n.t("Edit action");
            const action = node.action;
            if (action.type !== uri.scheme) {
                vscode_1.default.window.showErrorMessage(vscode_1.l10n.t("This action cannot run on a {0}.", uri.scheme), editActionLabel).then(edit => edit ? editAction() : '');
                return;
            }
            const workspace = vscode_1.default.workspace.getWorkspaceFolder(uri);
            if (workspace && node.workspace && node.workspace !== workspace) {
                vscode_1.default.window.showErrorMessage(vscode_1.l10n.t("This action belongs to workspace {0} and cannot be run on a file from workspace {1}", node.workspace.name, workspace.name));
                return;
            }
            const actionTarget = (0, actions_2.uriToActionTarget)(uri);
            if (action.extensions && !action.extensions.includes('GLOBAL') && !action.extensions.includes(actionTarget.extension) && !action.extensions.includes(actionTarget.fragment)) {
                vscode_1.default.window.showErrorMessage(vscode_1.l10n.t("This action cannot run on a file with the {0} extension.", actionTarget.extension), editActionLabel).then(edit => edit ? editAction() : '');
                return;
            }
            vscode_1.default.commands.executeCommand(`code-for-ibmi.runAction`, uri, undefined, action, undefined, workspace);
        }
    }), vscode_1.default.commands.registerCommand("code-for-ibmi.environment.actions.focus", () => environmentView.actionsNode?.reveal({ focus: true, expand: true })), vscode_1.default.commands.registerCommand("code-for-ibmi.environment.variable.declare", async (variablesNode, from) => {
        const existingNames = customVariables_1.CustomVariables.getAll().map(v => v.name);
        const name = (await vscode_1.default.window.showInputBox({
            title: vscode_1.l10n.t('Enter new Custom Variable name'),
            prompt: vscode_1.l10n.t("The name will automatically be uppercased"),
            placeHolder: vscode_1.l10n.t('New custom variable name...'),
            validateInput: name => customVariables_1.CustomVariables.validateName(name, existingNames)
        }));
        if (name) {
            const variable = { name, value: from?.value };
            if (from) {
                await customVariables_1.CustomVariables.update(variable);
                environmentView.refresh(variablesNode);
            }
            else {
                vscode_1.default.commands.executeCommand("code-for-ibmi.environment.variable.edit", variable, variablesNode);
            }
        }
    }), vscode_1.default.commands.registerCommand("code-for-ibmi.environment.variable.edit", async (variable, variablesNode) => {
        const value = await vscode_1.default.window.showInputBox({ title: vscode_1.l10n.t('Enter {0} value', variable.name), value: variable.value });
        if (value !== undefined) {
            variable.value = value;
            await customVariables_1.CustomVariables.update(variable);
            environmentView.refresh(variablesNode);
        }
    }), vscode_1.default.commands.registerCommand("code-for-ibmi.environment.variable.rename", async (variableItem) => {
        const variable = variableItem.customVariable;
        const existingNames = customVariables_1.CustomVariables.getAll().map(v => v.name).filter(name => name !== variable.name);
        const newName = (await vscode_1.default.window.showInputBox({
            title: vscode_1.l10n.t('Enter Custom Variable {0} new name', variable.name),
            prompt: vscode_1.l10n.t("The name will automatically be uppercased"),
            validateInput: name => customVariables_1.CustomVariables.validateName(name, existingNames)
        }));
        if (newName) {
            await customVariables_1.CustomVariables.update(variable, { newName });
            environmentView.refresh(variableItem.parent);
        }
    }), vscode_1.default.commands.registerCommand("code-for-ibmi.environment.variable.copy", async (variableItem) => {
        vscode_1.default.commands.executeCommand("code-for-ibmi.environment.variable.declare", variableItem.parent, variableItem.customVariable);
    }), vscode_1.default.commands.registerCommand("code-for-ibmi.environment.variable.delete", async (variableItem) => {
        const variable = variableItem.customVariable;
        if (await vscode_1.default.window.showInformationMessage(vscode_1.l10n.t("Do you really want to delete Custom Variable '{0}' ?", variable.name), { modal: true }, vscode_1.l10n.t("Yes"))) {
            await customVariables_1.CustomVariables.update(variable, { delete: true });
            environmentView.refresh(variableItem.parent);
        }
    }), vscode_1.default.commands.registerCommand("code-for-ibmi.environment.profile.create", async (node, from) => {
        const existingNames = (0, connectionProfiles_1.getConnectionProfiles)().map(profile => profile.name);
        const name = await vscode_1.default.window.showInputBox({
            title: vscode_1.l10n.t("Enter new profile name"),
            placeHolder: vscode_1.l10n.t("Profile name..."),
            value: from?.name,
            validateInput: name => actions_3.Actions.validateName(name, existingNames)
        });
        if (name) {
            const connection = instantiate_1.instance.getConnection();
            const homeDirectory = connection?.getConfig().homeDirectory || `/home/${connection?.currentUser || 'QPGMR'}`; //QPGMR case should not happen, but better be safe here
            const profile = from ? (0, connectionProfiles_1.cloneProfile)(from, name) : {
                name,
                homeDirectory,
                currentLibrary: 'QGPL',
                libraryList: ["QGPL", "QTEMP"],
                customVariables: [],
                ifsShortcuts: [homeDirectory],
                objectFilters: [],
            };
            await (0, connectionProfiles_1.updateConnectionProfile)(profile);
            environmentView.refresh(environmentView.profilesNode);
            if (!from) {
                vscode_1.default.commands.executeCommand("code-for-ibmi.environment.profile.edit", profile);
            }
            else {
                vscode_1.default.window.showInformationMessage(vscode_1.l10n.t("Created connection Profile '{0}'.", profile.name), vscode_1.l10n.t("Activate profile {0}", profile.name))
                    .then(doSwitch => {
                    if (doSwitch) {
                        vscode_1.default.commands.executeCommand("code-for-ibmi.environment.profile.activate", profile);
                    }
                });
            }
        }
    }), vscode_1.default.commands.registerCommand("code-for-ibmi.environment.profile.fromCurrent", async (profilesNode) => {
        const config = instantiate_1.instance.getConnection()?.getConfig();
        if (config) {
            const current = (0, connectionProfiles_1.cloneProfile)(config, "");
            vscode_1.default.commands.executeCommand("code-for-ibmi.environment.profile.create", undefined, current);
        }
    }), vscode_1.default.commands.registerCommand("code-for-ibmi.environment.profile.edit", async (profile) => {
        (0, connectionProfileEditor_1.editConnectionProfile)(profile, async () => environmentView.refresh(environmentView.profilesNode));
    }), vscode_1.default.commands.registerCommand("code-for-ibmi.environment.profile.rename", async (item) => {
        if ((0, connectionProfileEditor_1.isProfileEdited)(item.profile)) {
            vscode_1.default.window.showWarningMessage(vscode_1.l10n.t("Profile {0} is being edited. Please close its editor first.", item.profile.name));
        }
        else {
            const currentName = item.profile.name;
            const existingNames = (0, connectionProfiles_1.getConnectionProfiles)().map(profile => profile.name).filter(name => name !== currentName);
            const newName = await vscode_1.default.window.showInputBox({
                title: vscode_1.l10n.t('Enter Profile {0} new name', item.profile.name),
                placeHolder: vscode_1.l10n.t("Profile name..."),
                validateInput: name => connectionProfiles_2.ConnectionProfiles.validateName(name, existingNames)
            });
            if (newName) {
                await (0, connectionProfiles_1.updateConnectionProfile)(item.profile, { newName });
                const config = instantiate_1.instance.getConnection()?.getConfig();
                if (config?.currentProfile === currentName) {
                    config.currentProfile = newName;
                    await IBMi_1.default.connectionManager.update(config);
                    updateUIContext(newName);
                }
                environmentView.refresh(environmentView.profilesNode);
            }
        }
    }), vscode_1.default.commands.registerCommand("code-for-ibmi.environment.profile.copy", async (item) => {
        vscode_1.default.commands.executeCommand("code-for-ibmi.environment.profile.create", undefined, item.profile);
    }), vscode_1.default.commands.registerCommand("code-for-ibmi.environment.profile.delete", async (item) => {
        if ((0, connectionProfileEditor_1.isProfileEdited)(item.profile)) {
            vscode_1.default.window.showWarningMessage(vscode_1.l10n.t("Profile {0} is being edited. Please close its editor first.", item.profile.name));
        }
        else if (await vscode_1.default.window.showInformationMessage(vscode_1.l10n.t("Do you really want to delete profile '{0}' ?", item.profile.name), { modal: true }, vscode_1.l10n.t("Yes"))) {
            await (0, connectionProfiles_1.updateConnectionProfile)(item.profile, { delete: true });
            environmentView.refresh(environmentView.profilesNode);
        }
    }), vscode_1.default.commands.registerCommand("code-for-ibmi.environment.profile.activate", async (item) => {
        const connection = instantiate_1.instance.getConnection();
        const storage = instantiate_1.instance.getStorage();
        if (connection && storage) {
            const profile = "profile" in item ? item.profile : item;
            const config = connection.getConfig();
            const profileToBackup = config.currentProfile ? (0, connectionProfiles_1.getConnectionProfile)(config.currentProfile) : (0, connectionProfiles_1.getDefaultProfile)();
            if ((0, connectionProfileEditor_1.isProfileEdited)(profile)) {
                vscode_1.default.window.showWarningMessage(vscode_1.l10n.t("Profile {0} is being edited. Please close its editor before activating it.", profile.name));
                return;
            }
            else if (profileToBackup && (0, connectionProfileEditor_1.isProfileEdited)(profileToBackup)) {
                vscode_1.default.window.showWarningMessage(vscode_1.l10n.t("Profile {0} is being edited. Please close its editor before unloading it.", profileToBackup.name));
                return;
            }
            if (profileToBackup) {
                (0, connectionProfiles_1.assignProfile)(config, profileToBackup);
            }
            (0, connectionProfiles_1.assignProfile)(profile, config);
            config.currentProfile = profile.name || undefined;
            await IBMi_1.default.connectionManager.update(config);
            await Promise.all([
                vscode_1.default.commands.executeCommand(`code-for-ibmi.refreshLibraryListView`),
                vscode_1.default.commands.executeCommand(`code-for-ibmi.refreshIFSBrowser`),
                vscode_1.default.commands.executeCommand(`code-for-ibmi.refreshObjectBrowser`)
            ]);
            environmentView.refresh();
            if (profile.name && profile.setLibraryListCommand) {
                await vscode_1.default.commands.executeCommand("code-for-ibmi.environment.profile.runLiblistCommand", profile);
            }
            await updateUIContext(profile.name);
            vscode_1.default.window.showInformationMessage(config.currentProfile ? vscode_1.l10n.t(`Switched to profile "{0}".`, profile.name) : vscode_1.l10n.t("Active profile unloaded"));
        }
    }), vscode_1.default.commands.registerCommand("code-for-ibmi.environment.profile.runLiblistCommand", async (profileItem) => {
        const connection = instantiate_1.instance.getConnection();
        const storage = instantiate_1.instance.getStorage();
        if (connection && storage) {
            const config = connection.getConfig();
            const profile = profileItem && ("profile" in profileItem ? profileItem?.profile : profileItem) || (0, connectionProfiles_1.getConnectionProfile)(config.get);
            if (profile?.setLibraryListCommand) {
                const command = profile.setLibraryListCommand.startsWith(`?`) ?
                    await vscode_1.default.window.showInputBox({ title: vscode_1.l10n.t(`Run Library List Command`), value: profile.setLibraryListCommand.substring(1) }) :
                    profile.setLibraryListCommand;
                if (command) {
                    return await vscode_1.default.window.withProgress({ title: vscode_1.l10n.t("Running {0} profile's Library List Command...", profile.name), location: vscode_1.default.ProgressLocation.Notification }, async () => {
                        try {
                            const component = connection.getComponent(getNewLibl_1.GetNewLibl.ID);
                            const newSettings = await component?.getLibraryListFromCommand(connection, command);
                            if (newSettings) {
                                config.libraryList = newSettings.libraryList;
                                config.currentLibrary = newSettings.currentLibrary;
                                await IBMi_1.default.connectionManager.update(config);
                                await vscode_1.default.commands.executeCommand(`code-for-ibmi.refreshLibraryListView`);
                            }
                            else {
                                vscode_1.default.window.showWarningMessage(vscode_1.l10n.t(`Failed to get library list from command. Feature not installed; try to reload settings when connecting.`));
                            }
                        }
                        catch (e) {
                            vscode_1.default.window.showErrorMessage(vscode_1.l10n.t(`Failed to get library list from command: {0}`, e.message));
                        }
                    });
                }
            }
        }
    }), vscode_1.default.commands.registerCommand("code-for-ibmi.environment.profile.unload", async () => {
        vscode_1.default.commands.executeCommand("code-for-ibmi.environment.profile.activate", (0, connectionProfiles_1.getDefaultProfile)());
    }));
    instantiate_1.instance.subscribe(context, 'connected', 'Update environment view description', async () => {
        const config = instantiate_1.instance.getConnection()?.getConfig();
        const storage = instantiate_1.instance.getStorage();
        if (config && storage) {
            //Retrieve and clear old value for last used profile
            const deprecatedLastProfile = storage.getLastProfile();
            if (deprecatedLastProfile) {
                if (deprecatedLastProfile.toLocaleLowerCase() !== 'default') {
                    config.currentProfile = deprecatedLastProfile;
                    await IBMi_1.default.connectionManager.update(config);
                }
                await storage.clearDeprecatedLastProfile();
            }
            updateUIContext(config.currentProfile);
        }
    });
}
exports.initializeEnvironmentView = initializeEnvironmentView;
class EnvironmentView {
    emitter = new vscode_1.default.EventEmitter();
    onDidChangeTreeData = this.emitter.event;
    actionsNode = new actions_3.ActionsNode();
    profilesNode = new connectionProfiles_2.ProfilesNode();
    refresh(target) {
        this.emitter.fire(target);
    }
    getTreeItem(element) {
        return element;
    }
    getParent(element) {
        return element?.parent;
    }
    async getChildren(item) {
        if (item) {
            return item.getChildren?.();
        }
        else {
            return [
                this.actionsNode,
                new customVariables_1.CustomVariablesNode(),
                this.profilesNode
            ];
        }
    }
}
//# sourceMappingURL=environmentView.js.map