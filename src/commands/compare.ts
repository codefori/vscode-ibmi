import { ExtensionContext, Uri, commands, window } from "vscode";

export function connectCompareCommands(context: ExtensionContext) {
  let selectedForCompare: Uri;

  context.subscriptions.push(
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
          commands.executeCommand(`diff`, selectedForCompare, uri);
        } else {
          window.showErrorMessage(`No compare to path provided.`);
        }
      } else {
        window.showInformationMessage(`Nothing selected to compare.`);
      }
    }),
  );
}