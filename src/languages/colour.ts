import { ExtensionContext, Range, window, workspace, WorkspaceEdit } from "vscode";
import { instance } from "../instantiate";
import { t } from "../locale";

const NEW_LINE_NUMBERS = [10, 13];

export function initialiseColourChecker(context: ExtensionContext) {
  context.subscriptions.push(
    workspace.onDidOpenTextDocument(async (document) => {
      if (document.uri.scheme === `member` && !document.isClosed) {
        const content = document.getText();
        let doWork = hasInvalidCharacters(content);

        if (doWork) {
          const shouldFix = await askUserToStart();

          if (shouldFix) {
            const fixedContent = replaceInvalidCharacters(content);
            const edit = new WorkspaceEdit();
            edit.replace(document.uri, new Range(0, 0, document.lineCount, 0), fixedContent);
            workspace.applyEdit(edit);
          }
        }
      }
    })
  )
}

export function hasInvalidCharacters(content: string) {
  for (let i = 0; i < content.length; i++) {
    if (shouldReplaceCharCode(content.charCodeAt(i))) {
      return true;
    }
  }
  return false;
}

function shouldReplaceCharCode(charCode: number) {
  if ((charCode < 32 && !NEW_LINE_NUMBERS.includes(charCode)) || (charCode >= 128 && charCode <= 157)) {
    return true;
  }
  return false;
}

async function askUserToStart() {
  const config = instance.getConfig()

  if (config?.autoFixInvalidCharacters) {
    return true;
  }

  const always = t(`Always`);
  const no = t(`No`);
  
  const chosen = await window.showInformationMessage(
    t(`seuColours.warning`), 
    t(`Yes`), always, no);

  if (chosen === no) {
    return false;
  }

  if (chosen === always && config) {
    config.autoFixInvalidCharacters = true;
    await instance.setConfig(config);
  }

  return true;
}

export function replaceInvalidCharacters(content: string) {
  const chars = content.split(``);

  // return content.replace(/[\x00-\x1F]/g, ``); // This almost works, but we want to keep line feed / carriage return
  for (let i = 0; i < content.length; i++) {
    if (shouldReplaceCharCode(content.charCodeAt(i))) {
      chars[i] = ` `;
    }
  }

  return chars.join(``);
}