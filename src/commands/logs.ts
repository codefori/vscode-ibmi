import { commands, Disposable, ExtensionContext, window, workspace } from "vscode";
import Instance from "../Instance";

export function registerLoggingCommands(context: ExtensionContext, instance: Instance): Disposable[] {
  return [
    commands.registerCommand(`code-for-ibmi.logs.show`, async () => {
      const logger = instance.getLogger();
      
      const content = logger.getLogs();

      if (content.length === 0) {
        window.showInformationMessage(`No logs available.`);
        return;
      }

      workspace.openTextDocument({ content: JSON.stringify(content, null, 2), language: `json` }).then(doc => {
        window.showTextDocument(doc);
      })
    })
  ]
}