import vscode, { l10n } from "vscode";
import { Action, ActionType } from "../../../typings";
import { ContextItem } from "./contextItem";

export namespace Actions {
  export function validateName(name: string, names: string[]) {
    if (!name) {
      return l10n.t('Name cannot be empty');
    }
    else if (names.includes(name.toLocaleUpperCase())) {
      return l10n.t("This name is already used by another action");
    }
  }
}

export class ActionsNode extends ContextItem {
  private readonly foundActions: ActionItem[] = [];
  private revealIndex = -1;

  private readonly children;

  constructor(actions: Action[], localActions: Map<vscode.WorkspaceFolder, Action[]>) {
    super(l10n.t("Actions"), { state: vscode.TreeItemCollapsibleState.Collapsed });
    this.contextValue = "actionsNode";
    this.children = [
      new ActionTypeNode(this, l10n.t("Member"), 'member', actions),
      new ActionTypeNode(this, l10n.t("Object"), 'object', actions),
      new ActionTypeNode(this, l10n.t("Streamfile"), 'streamfile', actions),
      ...Array.from(localActions).map((([workspace, localActions]) => new ActionTypeNode(this, workspace.name, 'file', localActions, workspace)))
    ]
  }

  getChildren() {
    return this.children;
  }

  getAllActionItems() {
    return this.children.flatMap(child => child.actionItems);
  }

  async searchActions() {
    const nameOrCommand = (await vscode.window.showInputBox({ title: l10n.t("Search action"), placeHolder: l10n.t("name or command...") }))?.toLocaleLowerCase();
    if (nameOrCommand) {
      await this.clearSearch();
      const found = this.foundActions.push(...this.getAllActionItems().filter(action => [action.action.name, action.action.command].some(text => text.toLocaleLowerCase().includes(nameOrCommand)))) > 0;
      await vscode.commands.executeCommand(`setContext`, `code-for-ibmi:hasActionSearched`, found);
      if (found) {
        this.foundActions.forEach(node => node.setContext(true));
        this.refresh();
        this.goToNextSearchMatch();
      }
    }
  }

  goToNextSearchMatch() {
    this.revealIndex += (this.revealIndex + 1) < this.foundActions.length ? 1 : -this.revealIndex;
    const actionNode = this.foundActions[this.revealIndex];
    actionNode.reveal({ focus: true });
  }

  async clearSearch() {
    this.getAllActionItems().forEach(node => node.setContext(false));
    this.revealIndex = -1;
    this.foundActions.splice(0, this.foundActions.length);
    await vscode.commands.executeCommand(`setContext`, `code-for-ibmi:hasActionSearched`, false);
    await this.refresh();
  }
}

export class ActionTypeNode extends ContextItem {
  readonly actionItems: ActionItem[];
  constructor(parent: ContextItem, label: string, readonly type: ActionType, actions: Action[], readonly workspace?: vscode.WorkspaceFolder) {
    super(label, { parent, state: vscode.TreeItemCollapsibleState.Collapsed });
    this.contextValue = `actionTypeNode_${type}`;
    this.description = workspace ? l10n.t("workspace actions") : undefined;
    this.actionItems = actions.filter(action => action.type === type).map(action => new ActionItem(this, action, workspace));
  }

  getChildren() {
    return this.actionItems;
  }
}

export class ActionItem extends ContextItem {
  static matchedColor = "charts.yellow";
  static contextValue = `actionItem`;

  constructor(parent: ContextItem, readonly action: Action, readonly workspace?: vscode.WorkspaceFolder) {
    super(action.name, { parent });
    this.setContext();
    this.command = {
      title: "Edit action",
      command: "code-for-ibmi.context.action.edit",
      arguments: [this]
    }
  }

  setContext(matched?: boolean) {
    this.contextValue = `${ActionItem.contextValue}${this.workspace ? "Local" : "Remote"}${matched ? '_matched' : ''}`;
    this.iconPath = new vscode.ThemeIcon("github-action", matched ? new vscode.ThemeColor(ActionItem.matchedColor) : undefined);
    this.resourceUri = vscode.Uri.from({ scheme: ActionItem.contextValue, authority: this.action.name, query: matched ? "matched" : "" });
    this.description = matched ? l10n.t("search match") : undefined;
    this.tooltip = this.action.command;
  }
}