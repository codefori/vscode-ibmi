import vscode, { l10n } from "vscode";

const ITEMS = {
  "BASENAME": vscode.l10n.t("Name of the file, including the extension"),
  "BRANCH": vscode.l10n.t("Current Git branch"),
  "BRANCHLIB": vscode.l10n.t("Branch library, based on the current branch"),
  "BUILDLIB": vscode.l10n.t("The same as <code>&amp;CURLIB</code>"),
  "CURLIB": vscode.l10n.t("Current library, changeable in Library List"),
  "EXT": vscode.l10n.t("File type"),
  "EXTL": vscode.l10n.t("Lowercase file type"),
  "FILEDIR": vscode.l10n.t("Directory of the file on the remote system"),
  "FULLPATH": vscode.l10n.t("Full path of the file on the remote system"),
  "HOST": vscode.l10n.t("Hostname or IP address from the current connection"),
  "LIBLC": vscode.l10n.t("Library list delimited by comma"),
  "LIBLS": vscode.l10n.t("Library list delimited by space"),
  "LIBRARY": vscode.l10n.t("Library name where the object lives (<code>&amp;LIBRARYL</code> for lowercase)"),
  "LOCALPATH": vscode.l10n.t("Local source file path"),
  "NAME": vscode.l10n.t("Name of the object (<code>&amp;NAMEL</code> for lowercase)"),
  "NAMEL": vscode.l10n.t("Lowercase name of the object"),
  "PARENT": vscode.l10n.t("Name of the parent directory or source file"),
  "RELATIVEPATH": vscode.l10n.t("Relative path of the streamfile from the working directory or workspace"),
  "USERNAME": vscode.l10n.t("Username for connection"),
  "WORKDIR": vscode.l10n.t("Current working directory, changeable in IFS Browser"),
};

export class LocalActionCompletionItemProvider implements vscode.CompletionItemProvider {
  provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken, context: vscode.CompletionContext) {
    const text = document.lineAt(position.line).text?.trim();
    //Only provide items if the cursor is on a "command" or "outputToFile" line
    if (/^\s*"(command|outputToFile)"\s*:/.test(text)) {
      return Object.entries(ITEMS).map(([variable, label]) => ({
        label: variable,
        detail: label.replaceAll(/<code>|<\/code>|&amp;/g, ""),
        insertText: context.triggerCharacter ? undefined : `&${variable}`,
        kind: vscode.CompletionItemKind.Variable
      } as vscode.CompletionItem));
    }
    else if (!text || text === "},") {
      const snippet = new vscode.CompletionItem("action");
      snippet.insertText = new vscode.SnippetString('{\n  "name": "$1",\n  "command": "$2",\n  "environment": "ile",\n  "extensions": [\n      "$3GLOBAL"\n    ]\n}');
      snippet.documentation = new vscode.MarkdownString(l10n.t("Code for IBM i action"));
      return [snippet];
    }

  }
}