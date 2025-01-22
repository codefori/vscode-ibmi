import { commands, Disposable, ExtensionContext, window } from "vscode";
import Instance from "../Instance";
import { ConnectionData } from "../typings";
import { safeDisconnect } from "../instantiate";
import { setStoredPassword } from "../config/passwords";

export function registerConnectionCommands(context: ExtensionContext, instance: Instance): Disposable[] {

  return [
    commands.registerCommand(`code-for-ibmi.connectDirect`,
      async (connectionData: ConnectionData, reloadSettings = false, savePassword = false): Promise<boolean> => {
        const existingConnection = instance.getConnection();

        if (existingConnection) {
          return false;
        }

        if (savePassword && connectionData.password) {
          await setStoredPassword(context, connectionData.name, connectionData.password);
        }

        return (await instance.connect({data: connectionData, reloadServerSettings: reloadSettings})).success;
      }
    ),
    commands.registerCommand(`code-for-ibmi.disconnect`, async (silent?: boolean) => {
      if (instance.getConnection()) {
        await safeDisconnect();
      } else if (!silent) {
        window.showErrorMessage(`Not currently connected to any system.`);
      }
    }),
  ]
}