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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ActionItem = exports.ActionTypeNode = exports.ActionsNode = exports.Actions = void 0;
const path_1 = require("path");
const querystring_1 = require("querystring");
const vscode_1 = __importStar(require("vscode"));
const actions_1 = require("../../../api/actions");
const QSysFs_1 = require("../../../filesystems/qsys/QSysFs");
const instantiate_1 = require("../../../instantiate");
const Tools_1 = require("../../Tools");
const environmentItem_1 = require("./environmentItem");
var Actions;
(function (Actions) {
    function validateName(name, names) {
        if (!name) {
            return vscode_1.l10n.t('Name cannot be empty');
        }
        else if (Tools_1.VscodeTools.includesCaseInsensitive(names, name)) {
            return vscode_1.l10n.t("This name is already used by another action");
        }
    }
    Actions.validateName = validateName;
})(Actions = exports.Actions || (exports.Actions = {}));
class ActionsNode extends environmentItem_1.EnvironmentItem {
    foundActions = [];
    revealIndex = -1;
    children = [];
    constructor() {
        super(vscode_1.l10n.t("Actions"), { icon: "code-oss", state: vscode_1.default.TreeItemCollapsibleState.Collapsed });
        this.contextValue = "actionsNode";
    }
    async getChildren() {
        if (!this.children.length) {
            await vscode_1.default.commands.executeCommand(`setContext`, `code-for-ibmi:hasActionSearched`, false);
            const actions = (await (0, actions_1.getActions)()).sort(sortActions);
            const localActions = new Map();
            for (const workspace of vscode_1.default.workspace.workspaceFolders || []) {
                const workspaceActions = (await (0, actions_1.getActions)(workspace));
                if (workspaceActions.length) {
                    localActions.set(workspace, workspaceActions.sort(sortActions));
                }
            }
            this.children.push(new ActionTypeNode(this, vscode_1.l10n.t("Member"), 'file-code', 'member', actions), new ActionTypeNode(this, vscode_1.l10n.t("Object"), 'database', 'object', actions), new ActionTypeNode(this, vscode_1.l10n.t("Streamfile"), 'file-text', 'streamfile', actions), ...Array.from(localActions).map((([workspace, localActions]) => new ActionTypeNode(this, workspace.name, 'folder', 'file', localActions, workspace))));
            if (vscode_1.default.window.activeTextEditor) {
                await this.activeEditorChanged(vscode_1.default.window.activeTextEditor);
            }
        }
        return this.children;
    }
    async getAllActionItems() {
        return (await this.getChildren()).flatMap(child => child.actionItems);
    }
    async searchActions() {
        const nameOrCommand = (await vscode_1.default.window.showInputBox({ title: vscode_1.l10n.t("Search action"), placeHolder: vscode_1.l10n.t("Name or command...") }))?.toLocaleLowerCase();
        if (nameOrCommand) {
            await this.clearSearch();
            const found = this.foundActions.push(...(await this.getAllActionItems()).filter(action => [action.action.name, action.action.command].some(text => text.toLocaleLowerCase().includes(nameOrCommand)))) > 0;
            await vscode_1.default.commands.executeCommand(`setContext`, `code-for-ibmi:hasActionSearched`, found);
            if (found) {
                this.foundActions.forEach(node => node.setContext({ matched: true }));
                this.refresh();
                this.goToNextSearchMatch();
            }
        }
    }
    async activeEditorChanged(editor) {
        const uri = editor?.document.uri;
        let activeEditorContext = undefined;
        if (uri) {
            const connection = instantiate_1.instance.getConnection();
            activeEditorContext = {
                scheme: uri.scheme,
                extension: (0, path_1.parse)(uri.path).ext.substring(1).toLocaleUpperCase(),
                protected: (0, QSysFs_1.parseFSOptions)(uri).readonly || connection?.getConfig()?.readOnlyMode || connection?.getContent().isProtectedPath(uri.path),
                workspace: vscode_1.default.workspace.getWorkspaceFolder(uri)
            };
        }
        const canRunOnEditor = (actionItem) => activeEditorContext !== undefined &&
            activeEditorContext.scheme === actionItem.action.type &&
            activeEditorContext.workspace === actionItem.workspace &&
            (actionItem.action.runOnProtected || !activeEditorContext.protected) &&
            (!actionItem.action.extensions?.length || actionItem.action.extensions.includes('GLOBAL') || actionItem.action.extensions.includes(activeEditorContext.extension));
        (await this.getAllActionItems()).forEach(item => item.setContext({ canRun: canRunOnEditor(item) }));
        this.refresh();
    }
    forceRefresh() {
        this.children.splice(0, this.children.length);
        this.refresh();
    }
    goToNextSearchMatch() {
        this.revealIndex += (this.revealIndex + 1) < this.foundActions.length ? 1 : -this.revealIndex;
        const actionNode = this.foundActions[this.revealIndex];
        actionNode.reveal({ focus: true });
    }
    async clearSearch() {
        (await this.getAllActionItems()).forEach(node => node.setContext({ matched: false }));
        this.revealIndex = -1;
        this.foundActions.splice(0, this.foundActions.length);
        await vscode_1.default.commands.executeCommand(`setContext`, `code-for-ibmi:hasActionSearched`, false);
        await this.refresh();
    }
}
exports.ActionsNode = ActionsNode;
class ActionTypeNode extends environmentItem_1.EnvironmentItem {
    type;
    workspace;
    actionItems;
    constructor(parent, label, icon, type, actions, workspace) {
        super(label, { parent, icon, state: vscode_1.default.TreeItemCollapsibleState.Collapsed });
        this.type = type;
        this.workspace = workspace;
        this.contextValue = `actionTypeNode_${type}`;
        this.actionItems = actions.filter(action => action.type === type).map(action => new ActionItem(this, action, workspace));
    }
    getChildren() {
        return this.actionItems;
    }
}
exports.ActionTypeNode = ActionTypeNode;
class ActionItem extends environmentItem_1.EnvironmentItem {
    action;
    workspace;
    static matchedColor = "charts.yellow";
    static canRunColor = "charts.blue";
    static matchedCanRunColor = "charts.green";
    static context = `actionItem`;
    context = {};
    constructor(parent, action, workspace) {
        super(action.name, { parent });
        this.action = action;
        this.workspace = workspace;
        this.setContext();
        this.command = {
            title: "Edit action",
            command: "code-for-ibmi.environment.action.edit",
            arguments: [this]
        };
    }
    setContext(context) {
        if (context?.canRun !== undefined) {
            this.context.canRun = context.canRun;
        }
        if (context?.matched !== undefined) {
            this.context.matched = context.matched;
        }
        this.iconPath = new vscode_1.default.ThemeIcon("github-action", this.context.matched ? new vscode_1.default.ThemeColor(ActionItem.matchedColor) : undefined);
        this.description = this.context.matched ? vscode_1.l10n.t("search match") : undefined;
        this.tooltip = this.action.command;
        this.resourceUri = vscode_1.default.Uri.from({
            scheme: ActionItem.context,
            authority: this.action.name,
            query: (0, querystring_1.stringify)({ matched: this.context.matched || undefined, canRun: this.context.canRun || undefined })
        });
        this.contextValue = `${ActionItem.context}${this.context.canRun ? "_canrun" : ""}${this.context.matched ? '_matched' : ''}`;
    }
}
exports.ActionItem = ActionItem;
function sortActions(a1, a2) {
    return a1.name.localeCompare(a2.name);
}
//# sourceMappingURL=actions.js.map