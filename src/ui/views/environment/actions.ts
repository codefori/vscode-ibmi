import { parse } from "path";
import { stringify } from "querystring";
import vscode, { l10n } from "vscode";
import { ActionTools, ServerAction } from "../../../api/actions";
import { parseFSOptions } from "../../../filesystems/qsys/QSysFs";
import { instance } from "../../../instantiate";
import { Action, ActionType } from "../../../typings";
import { saveToServer, ServerSaveUI } from "../../serverConfigFiles";
import { VscodeTools } from "../../Tools";
import { EnvironmentItem } from "./environmentItem";

type ActionContext = {
  canRun?: boolean
  matched?: boolean
}

/**
 * Where an action is stored: a workspace's .vscode/actions.json, /etc/vscode/actions.json (`server`) or the connection settings (neither)
 */
export type ActionLocation = {
  workspace?: vscode.WorkspaceFolder
  server?: boolean
};

type SaveActionOptions = { newName?: string, oldType?: ActionType, delete?: boolean, force?: boolean };

export namespace Actions {
  export function validateName(name: string, names: string[]) {
    if (!name) {
      return l10n.t('Name cannot be empty');
    }
    else if (VscodeTools.includesCaseInsensitive(names, name)) {
      return l10n.t("This name is already used by another action");
    }
  }

  export async function getActions(location: ActionLocation): Promise<Action[]> {
    return location.server ? await ActionTools.getServerActions() : await ActionTools.getActions(location.workspace);
  }

  /**
   * @returns a copy of `action` holding only what is stored in an actions file
   */
  export function toStoredAction(action: Action): Action {
    const { loadedHash, ...stored } = action as ServerAction;
    return structuredClone(stored);
  }

  /**
   * Saves an action where it is stored; if it is a server action that was changed on the server by someone else in the meantime,
   * the user decides whether to overwrite those changes.
   * @returns `true` if the action was saved
   * @throws any error other than a conflict with the changes made on the server
   */
  export async function save(action: Action, location: ActionLocation, options: SaveActionOptions = {}, ui: ServerSaveUI = {}): Promise<boolean> {
    if (!location.server) {
      await ActionTools.updateAction(action, location.workspace, options);
      return true;
    }

    return saveToServer({
      title: l10n.t("Saving server action {0}", action.name),
      filePath: instance.getConnection()?.getConfigFile(`actions`).getPaths().server || ``,
      conflictDetail: l10n.t("Reload the server actions to get the latest changes, or overwrite them with yours."),
      write: (force, onProgress) => ActionTools.updateServerAction(action, { ...options, force: options.force || force, onProgress })
    }, ui);
  }
}

export class ActionsNode extends EnvironmentItem {
  private readonly foundActions: ActionItem[] = [];
  private revealIndex = -1;

  private children: ActionTypeNode[] = [];

  constructor() {
    super(l10n.t("Actions"), { icon: "code-oss", state: vscode.TreeItemCollapsibleState.Collapsed });
    this.contextValue = "actionsNode";
  }

  async getChildren() {
    if (!this.children.length) {
      await vscode.commands.executeCommand(`setContext`, `code-for-ibmi:hasActionSearched`, false);
      const actions = (await ActionTools.getActions()).sort(sortActions);
      const serverActions = (await ActionTools.getServerActions()).sort(sortActions);
      const localActions = new Map<vscode.WorkspaceFolder, Action[]>();
      for (const workspace of vscode.workspace.workspaceFolders || []) {
        const workspaceActions = (await ActionTools.getActions(workspace));
        if (workspaceActions.length) {
          localActions.set(workspace, workspaceActions.sort(sortActions));
        }
      }

      this.children = [
        new ActionTypeNode(this, l10n.t("Member"), 'file-code', 'member', actions, undefined, serverActions),
        new ActionTypeNode(this, l10n.t("Object"), 'database', 'object', actions, undefined, serverActions),
        new ActionTypeNode(this, l10n.t("Streamfile"), 'file-text', 'streamfile', actions, undefined, serverActions),
        ...Array.from(localActions).map((([workspace, localActions]) => new ActionTypeNode(this, workspace.name, 'folder', 'file', localActions, workspace)))
      ];

      if (vscode.window.activeTextEditor) {
        await this.activeEditorChanged(vscode.window.activeTextEditor)
      }
    }
    return this.children;
  }

  private async getAllActionItems() {
    return (await this.getChildren()).flatMap(child => child.actionItems);
  }

  async searchActions() {
    const nameOrCommand = (await vscode.window.showInputBox({ title: l10n.t("Search action"), placeHolder: l10n.t("Name or command...") }))?.toLocaleLowerCase();
    if (nameOrCommand) {
      await this.clearSearch();
      const found = this.foundActions.push(...(await this.getAllActionItems()).filter(action => [action.action.name, action.action.command].some(text => text.toLocaleLowerCase().includes(nameOrCommand)))) > 0;
      await vscode.commands.executeCommand(`setContext`, `code-for-ibmi:hasActionSearched`, found);
      if (found) {
        this.foundActions.forEach(node => node.setContext({ matched: true }));
        this.refresh();
        this.goToNextSearchMatch();
      }
    }
  }

  async activeEditorChanged(editor?: vscode.TextEditor) {
    const uri = editor?.document.uri;
    let activeEditorContext = undefined;
    if (uri) {
      const connection = instance.getConnection();
      activeEditorContext = {
        scheme: uri.scheme,
        extension: parse(uri.path).ext.substring(1).toLocaleUpperCase(),
        protected: parseFSOptions(uri).readonly || connection?.getConfig()?.readOnlyMode || connection?.getContent().isProtectedPath(uri.path),
        workspace: vscode.workspace.getWorkspaceFolder(uri)
      };
    }

    const canRunOnEditor = (actionItem: ActionItem) => activeEditorContext !== undefined &&
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
    await vscode.commands.executeCommand(`setContext`, `code-for-ibmi:hasActionSearched`, false);
    await this.refresh();
  }
}

export class ActionTypeNode extends EnvironmentItem {
  readonly actionItems: ActionItem[];
  constructor(parent: EnvironmentItem, label: string, icon: string, readonly type: ActionType, actions: Action[], readonly workspace?: vscode.WorkspaceFolder, serverActions: ServerAction[] = []) {
    super(label, { parent, icon, state: vscode.TreeItemCollapsibleState.Collapsed });
    this.contextValue = `actionTypeNode_${type}`;
    this.actionItems = [
      ...actions.filter(action => action.type === type).map(action => new ActionItem(this, action, workspace)),
      ...serverActions.filter(action => action.type === type).map(action => new ActionItem(this, action, undefined, true))
    ];
  }

  getChildren() {
    return this.actionItems;
  }
}

export class ActionItem extends EnvironmentItem {
  static matchedColor = "charts.yellow";
  static canRunColor = "charts.blue";
  static matchedCanRunColor = "charts.green";
  static contextValue = `actionItem`;

  private context: ActionContext = {}

  constructor(parent: ActionTypeNode, readonly action: Action, readonly workspace?: vscode.WorkspaceFolder, readonly server = false) {
    super(action.name, { parent });
    this.setContext();
    this.command = {
      title: "Edit action",
      command: "code-for-ibmi.environment.action.edit",
      arguments: [this]
    }
  }

  get location(): ActionLocation {
    return { workspace: this.workspace, server: this.server };
  }

  setContext(context?: ActionContext) {
    if (context?.canRun !== undefined) {
      this.context.canRun = context.canRun;
    }
    if (context?.matched !== undefined) {
      this.context.matched = context.matched;
    }

    this.iconPath = new vscode.ThemeIcon(this.server ? "vm" : "github-action", this.context.matched ? new vscode.ThemeColor(ActionItem.matchedColor) : undefined);
    this.description = this.context.matched ? l10n.t("search match") : undefined;
    this.tooltip = `${this.server ? `${l10n.t("Server action")}\n` : ``}${this.action.command}\nExtensions: ${this.action.extensions?.join(`, `)}`;
    this.resourceUri = vscode.Uri.from({
      scheme: ActionItem.contextValue,
      authority: this.action.name,
      query: stringify({ matched: this.context.matched || undefined, canRun: this.context.canRun || undefined, server: this.server || undefined })
    });
    this.contextValue = `${ActionItem.contextValue}${this.context.canRun ? "_canrun" : ""}${this.context.matched ? '_matched' : ''}${this.server ? '_server' : ''}`;
  }
}

function sortActions(a1: Action, a2: Action) {
  return a1.name.localeCompare(a2.name);
}