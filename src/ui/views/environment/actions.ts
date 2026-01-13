import { parse } from "path";
import { stringify } from "querystring";
import vscode, { l10n } from "vscode";
import { getActions } from "../../../api/actions";
import { parseFSOptions } from "../../../filesystems/qsys/QSysFs";
import { instance } from "../../../instantiate";
import { Action, ActionType } from "../../../typings";
import { VscodeTools } from "../../Tools";
import { EnvironmentItem } from "./environmentItem";

type ActionContext = {
  canRun?: boolean
  matched?: boolean
}

export namespace Actions {
  export function validateName(name: string, names: string[]) {
    if (!name) {
      return l10n.t('Name cannot be empty');
    }
    else if (VscodeTools.includesCaseInsensitive(names, name)) {
      return l10n.t("This name is already used by another action");
    }
  }
}

export class ActionsNode extends EnvironmentItem {
  private readonly foundActions: ActionItem[] = [];
  private revealIndex = -1;

  private readonly children: ActionTypeNode[] = [];

  constructor() {
    super(l10n.t("Actions"), { icon: "code-oss", state: vscode.TreeItemCollapsibleState.Collapsed });
    this.contextValue = "actionsNode";
  }

  async getChildren() {
    if (!this.children.length) {
      await vscode.commands.executeCommand(`setContext`, `code-for-ibmi:hasActionSearched`, false);
      const actions = (await getActions()).sort(sortActions);
      const localActions = new Map<vscode.WorkspaceFolder, Action[]>();
      for (const workspace of vscode.workspace.workspaceFolders || []) {
        const workspaceActions = (await getActions(workspace));
        if (workspaceActions.length) {
          localActions.set(workspace, workspaceActions.sort(sortActions));
        }
      }

      this.children.push(
        new ActionTypeNode(this, l10n.t("Member"), 'file-code', 'member', actions),
        new ActionTypeNode(this, l10n.t("Object"), 'database', 'object', actions),
        new ActionTypeNode(this, l10n.t("Streamfile"), 'file-text', 'streamfile', actions),
        ...Array.from(localActions).map((([workspace, localActions]) => new ActionTypeNode(this, workspace.name, 'folder', 'file', localActions, workspace)))
      );

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
  constructor(parent: EnvironmentItem, label: string, icon: string, readonly type: ActionType, actions: Action[], readonly workspace?: vscode.WorkspaceFolder) {
    super(label, { parent, icon, state: vscode.TreeItemCollapsibleState.Collapsed });
    this.contextValue = `actionTypeNode_${type}`;
    this.actionItems = actions.filter(action => action.type === type).map(action => new ActionItem(this, action, workspace));
  }

  getChildren() {
    return this.actionItems;
  }
}

export class ActionItem extends EnvironmentItem {
  static matchedColor = "charts.yellow";
  static canRunColor = "charts.blue";
  static matchedCanRunColor = "charts.green";
  static context = `actionItem`;

  private context: ActionContext = {}

  constructor(parent: ActionTypeNode, readonly action: Action, readonly workspace?: vscode.WorkspaceFolder) {
    super(action.name, { parent });
    this.setContext();
    this.command = {
      title: "Edit action",
      command: "code-for-ibmi.environment.action.edit",
      arguments: [this]
    }
  }

  setContext(context?: ActionContext) {
    if (context?.canRun !== undefined) {
      this.context.canRun = context.canRun;
    }
    if (context?.matched !== undefined) {
      this.context.matched = context.matched;
    }

    this.iconPath = new vscode.ThemeIcon("github-action", this.context.matched ? new vscode.ThemeColor(ActionItem.matchedColor) : undefined);
    this.description = this.context.matched ? l10n.t("search match") : undefined;
    this.tooltip = this.action.command;
    this.resourceUri = vscode.Uri.from({
      scheme: ActionItem.context,
      authority: this.action.name,
      query: stringify({ matched: this.context.matched || undefined, canRun: this.context.canRun || undefined })
    });
    this.contextValue = `${ActionItem.context}${this.context.canRun ? "_canrun" : ""}${this.context.matched ? '_matched' : ''}`;
  }
}

function sortActions(a1: Action, a2: Action) {
  return a1.name.localeCompare(a2.name);
}