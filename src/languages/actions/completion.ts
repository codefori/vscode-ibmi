import vscode from "vscode";
import { t } from "../../locale";

type Item = {
  name: string
  description: string
}

const ITEMS = [
  "BASENAME",
  "BRANCH",
  "BRANCHLIB",
  "BUILDLIB",
  "CURLIB",
  "EXT",
  "EXTL",
  "FILEDIR",
  "FULLPATH",
  "HOST",
  "LIBLC",
  "LIBLS",
  "LIBRARY",
  "LOCALPATH",
  "NAME",
  "NAMEL",
  "PARENT",
  "RELATIVEPATH",
  "USERNAME",
  "WORKDIR",
];

export class LocalActionCompletionItemProvider implements vscode.CompletionItemProvider {
  provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken, context: vscode.CompletionContext) {
    //Only provide items if the cursor is on a "command" line
    if (/^\s*"command"\s*:/.test(document.lineAt(position.line).text)) {
      return ITEMS.map(item => ({
        label: item,
        detail: t(`actions.${item}`).replaceAll(/<code>|<\/code>|&amp;/g, ""),
        insertText: context.triggerCharacter ? undefined : `&${item}`,
        kind: vscode.CompletionItemKind.Variable
      } as vscode.CompletionItem));
    }
    else{
      return [];
    }
  }
}