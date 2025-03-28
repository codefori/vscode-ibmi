import { Disposable, Uri, commands, l10n, window } from "vscode";
import { BrowserItem } from "../typings";

let selectedForCompare: Uri | undefined;

const VSCODE_DIFF_COMMAND = `vscode.diff`;

export function registerCompareCommands(): Disposable[] {
  return [
    commands.registerCommand(`code-for-ibmi.selectForCompare`, async (node: BrowserItem) => {
      if (node?.resourceUri) {
        selectedForCompare = node.resourceUri;
        window.showInformationMessage(`Selected ${selectedForCompare.path} for compare.`);
      }
    }),
    commands.registerCommand(`code-for-ibmi.compareWithSelected`, async (node: BrowserItem) => {
      if (selectedForCompare) {
        let uri;
        if (node) {
          uri = node.resourceUri;
        } else {
          const activeEditor = window.activeTextEditor;
          const value = (activeEditor ? activeEditor.document.uri : selectedForCompare)
            .with({ query: '' })
            .toString();
          const compareWith = await window.showInputBox({
            prompt: `Enter the path to compare selected with`,
            value,
            title: `Compare with`
          })

          if (compareWith)
            uri = Uri.parse(compareWith);
        }

        if (uri) {
          commands.executeCommand(VSCODE_DIFF_COMMAND, selectedForCompare, uri);
        } else {
          window.showErrorMessage(`No compare to path provided.`);
        }
      } else {
        window.showInformationMessage(`Nothing selected to compare.`);
      }
    }),

    commands.registerCommand(`code-for-ibmi.compareCurrentFileWithMember`, async (node) => {
      compareCurrentFile(node, `member`);
    }),
    commands.registerCommand(`code-for-ibmi.compareCurrentFileWithStreamFile`, async (node) => {
      compareCurrentFile(node, `streamfile`);
    }),
    commands.registerCommand(`code-for-ibmi.compareCurrentFileWithLocal`, async (node) => {
      compareCurrentFile(node, `file`);
    }),
    commands.registerCommand(`code-for-ibmi.compareWithActiveFile`, async (node: BrowserItem | Uri) => {
      let selectedFile;
      if (node) {
        if (node instanceof BrowserItem) {
          selectedFile = node.resourceUri;
        } else if (node.scheme === `file`) {
          selectedFile = node
        } else {
          window.showInformationMessage(l10n.t(`No file is open or selected`));
        }

        let activeFile;
        const editor = window.activeTextEditor;
        if (editor) {
          activeFile = editor.document.uri;
          if (activeFile) {
            commands.executeCommand(VSCODE_DIFF_COMMAND, activeFile, selectedFile);
          } else {
            window.showInformationMessage(l10n.t(`No file is open or selected`));
          }
        } else {
          window.showInformationMessage(l10n.t(`No file is open or selected`));
        }
      } else {
        window.showInformationMessage(l10n.t(`No file is open or selected`));
      }
    }),
    commands.registerCommand("code-for-ibmi.compareWithEachOther", async (node: BrowserItem, nodes: BrowserItem[]) => {
      const left = nodes.at(0)?.resourceUri;
      const right = nodes.at(1)?.resourceUri;
      if (left) {
        commands.executeCommand(VSCODE_DIFF_COMMAND, left, right);
      }
    }),
    //Same commands with shorter titles
    ...["compareWithSelected",
      "compareCurrentFileWithMember",
      "compareCurrentFileWithStreamFile",
      "compareCurrentFileWithLocal",
      "compareWithActiveFile"].map(command => commands.registerCommand(`code-for-ibmi.${command}.short`, node => commands.executeCommand(`code-for-ibmi.${command}`, node)))
  ]
}

async function compareCurrentFile(node: BrowserItem | Uri, scheme: `streamfile` | `file` | `member`) {
  let currentFile: Uri | undefined;
  // If we are comparing with an already targeted node
  if (node) {
    if (node instanceof BrowserItem) {
      currentFile = node.resourceUri;
    } else if (node.scheme === `file`) {
      currentFile = node
    }
  } else {
    // If we are comparing with the currently open file
    const editor = window.activeTextEditor;
    if (editor) {
      currentFile = editor.document.uri;
    }
  }

  if (currentFile) {
    let compareWith;
    if (scheme === "file") {
      compareWith = (await window.showOpenDialog({
        title: l10n.t(`Select the file to compare to`),
        canSelectMany: false,
      }))?.at(0);
    }
    else {
      compareWith = await window.showInputBox({
        prompt: l10n.t(`Enter the path to compare selected with`),
        title: l10n.t(`Compare with`),
        value: currentFile.path
      });
    }

    if (compareWith) {
      let uri;
      if (compareWith instanceof Uri) {
        uri = compareWith;
      }
      else {
        if (scheme == 'member' && !compareWith.startsWith('/')) {
          compareWith = `/${compareWith}`;
        }
        uri = Uri.parse(`${scheme}:${compareWith}`);
      }

      commands.executeCommand(VSCODE_DIFF_COMMAND, currentFile, uri);
    }
  } else {
    window.showInformationMessage(l10n.t(`No file is open or selected`));
  }
}
