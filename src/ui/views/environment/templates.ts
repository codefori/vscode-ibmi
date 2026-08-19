import path from "path";
import vscode, { l10n } from "vscode";
import { SharedTemplateTools } from "../../../api/sharedTemplates";
import { instance } from "../../../instantiate";
import { SharedTemplate } from "../../../typings";
import { VscodeTools } from "../../Tools";
import { EnvironmentItem } from "./environmentItem";

export namespace Templates {
  export function validateName(name: string, names: string[]) {
    if (!name) {
      return l10n.t("Name cannot be empty");
    }
    else if (VscodeTools.includesCaseInsensitive(names, name)) {
      return l10n.t("This name is already used by another shared template");
    }
  }

  export function validatePrefix(prefix: string) {
    if (!prefix) {
      return l10n.t("Prefix cannot be empty");
    }
    else if (/\s/.test(prefix)) {
      return l10n.t("Prefix cannot contain spaces");
    }
  }
}

export class TemplatesNode extends EnvironmentItem {
  private children: TemplateItem[] = [];

  constructor() {
    super(l10n.t("Shared Templates"), { icon: "repo", state: vscode.TreeItemCollapsibleState.Collapsed });
    this.contextValue = "templatesNode";
  }

  async getChildren() {
    const connection = instance.getConnection();
    this.children = connection ? (await SharedTemplateTools.getTemplates(connection, { forceReload: true })).map(template => new TemplateItem(this, template)) : [];
    return this.children;
  }

  forceRefresh() {
    this.children = [];
    this.refresh();
  }
}

export class TemplateItem extends EnvironmentItem {
  static readonly context = `templateItem`;

  constructor(parent: TemplatesNode, readonly template: SharedTemplate) {
    super(template.name, { parent, icon: "symbol-snippet" });
    this.contextValue = TemplateItem.context;
    this.description = template.prefix;
    this.tooltip = template.description ? `${template.description}\nprefix: ${template.prefix}` : `prefix: ${template.prefix}`;
    this.command = {
      title: l10n.t("Insert shared template"),
      command: "code-for-ibmi.environment.template.insert",
      arguments: [this]
    };
  }
}

/**
 * Inserts a shared template's body at the current cursor(s), using VS Code's
 * own snippet engine, so any $1/${1:default} tabstops in the body are
 * navigable exactly like a native user snippet.
 */
export function insertTemplate(template: SharedTemplate) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage(l10n.t("No active editor to insert the shared template into."));
    return;
  }
  return editor.insertSnippet(new vscode.SnippetString(SharedTemplateTools.getBody(template)));
}

/** Opens the raw shared snippet index file, the same way VS Code's own "Configure User Snippets" does for local snippets. */
export function openIndex() {
  return vscode.commands.executeCommand("code-for-ibmi.openEditable", SharedTemplateTools.getIndexFile());
}

/**
 * Dynamically loads shared templates from the IFS and offers them as native
 * snippet completions (typed prefix -> Tab to expand, with real tabstop
 * navigation), scoped to the current file's extension.
 */
export class SharedTemplateCompletionItemProvider implements vscode.CompletionItemProvider {
  async provideCompletionItems(document: vscode.TextDocument) {
    const connection = instance.getConnection();
    if (!connection) {
      return;
    }

    const extension = path.extname(document.uri.path).substring(1).toLocaleLowerCase();
    const templates = await SharedTemplateTools.getTemplates(connection);

    return templates
      .filter(template => !template.extensions?.length || template.extensions.some(ext => ext.toLocaleUpperCase() === `GLOBAL` || ext.toLocaleLowerCase() === extension))
      .map(template => {
        const item = new vscode.CompletionItem(template.prefix, vscode.CompletionItemKind.Snippet);
        item.detail = template.name;
        item.documentation = new vscode.MarkdownString(template.description);
        item.insertText = new vscode.SnippetString(SharedTemplateTools.getBody(template));
        return item;
      });
  }
}
