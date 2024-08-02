import { ExtensionContext, Range, window, workspace, WorkspaceEdit } from "vscode";
import { instance } from "../instantiate";

const NEW_LINE_NUMBERS = [10, 13];

export function initialiseColourChecker(context: ExtensionContext) {
  context.subscriptions.push(
    workspace.onDidOpenTextDocument(async (document) => {
      if (document.uri.scheme === `member` && !document.isClosed) {
        const content = document.getText();
        let hasInvalidCharacters = false;
        for (let i = 0; i < content.length; i++) {
          if (content.charCodeAt(i) < 32 && !NEW_LINE_NUMBERS.includes(content.charCodeAt(i))) {
            hasInvalidCharacters = true;
            break;
          }
        }

        if (hasInvalidCharacters) {
          const shouldFix = await shouldInitiateCleanup();

          if (shouldFix) {
            const fixedContent = replaceInvalidCharacters(content);
            const edit = new WorkspaceEdit();
            edit.replace(document.uri, new Range(0, 0, document.lineCount, 0), fixedContent);
          }
        }
      }
    })
  )
}

async function shouldInitiateCleanup() {
  const config = instance.getConfig()

  if (config?.autoFixInvalidCharacters) {
    return true;
  }
  
  const chosen = await window.showInformationMessage(`This member contains invalid characters. Would you like to clean it up?`, `Yes`, `Always`, `No`);

  if (chosen === `No`) {
    return false;
  }

  if (chosen === `Always` && config) {
    config.autoFixInvalidCharacters = true;
    await instance.setConfig(config);
  }

  return true;
}

function replaceInvalidCharacters(content: string) {
  const chars = content.split(``);

  // return content.replace(/[\x00-\x1F]/g, ``); // This almost works, but we want to keep line feed / carriage return
  for (let i = 0; i < content.length; i++) {
    if (content.charCodeAt(i) < 32 && !NEW_LINE_NUMBERS.includes(content.charCodeAt(i))) {
      chars[i] = ` `;
    }
  }

  return chars.join(``);
}