import { commands, window, Uri, l10n, Disposable } from "vscode";
import Instance from "../Instance";

let selectedForCompare: Uri;

const VSCODE_DIFF_COMMAND = `vscode.diff`;

export function registerCompareCommands(instance: Instance): Disposable[] {
  return [
    commands.registerCommand(`code-for-ibmi.selectForCompare`, async (node) => {
      if (node) {
        selectedForCompare = node.resourceUri;
        window.showInformationMessage(`Selected ${node.path} for compare.`);
      }
    }),
    commands.registerCommand(`code-for-ibmi.compareWithSelected`, async (node) => {
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
    commands.registerCommand(`code-for-ibmi.compareWithActiveFile`, async (node) => {
      let selectedFile;
      if (node) {
        if (node.scheme === `streamfile` || node.constructor.name === `IFSFileItem` || node.constructor.name === `ObjectBrowserItem`) {
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
  ]
}

async function compareCurrentFile(node: any, scheme: `streamfile` | `file` | `member`) {
  let currentFile: Uri | undefined;
  // If we are comparing with an already targeted node
  if (node) {
    if (node.resourceUri) {
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
    let compareWith = await window.showInputBox({
      prompt: l10n.t(`Enter the path to compare selected with`),
      title: l10n.t(`Compare with`),
      value: currentFile.path
    });

    if (compareWith) {
      if (scheme == 'member' && !compareWith.startsWith('/')) {
        compareWith = `/${compareWith}`;
      }
      let uri = Uri.parse(`${scheme}:${compareWith}`);
      commands.executeCommand(VSCODE_DIFF_COMMAND, currentFile, uri);
    }
  } else {
    window.showInformationMessage(l10n.t(`No file is open or selected`));
  }
}
