import { commands, Disposable, ExtensionContext, window } from "vscode";
import { ConnectionResult } from "../api/IBMi";
import { setStoredPassword } from "../config/passwords";
import Instance from "../Instance";
import { safeDisconnect } from "../instantiate";
import { ConnectionData } from "../typings";

export function registerConnectionCommands(context: ExtensionContext, instance: Instance): Disposable[] {

  return [
    commands.registerCommand(`code-for-ibmi.connectDirect`,
      async (connectionData: ConnectionData, reloadSettings = false, savePassword = false): Promise<ConnectionResult | undefined> => {
        const existingConnection = instance.getConnection();

        if (existingConnection) {
          return;
        }

        if (savePassword && connectionData.password) {
          await setStoredPassword(context, connectionData.name, connectionData.password);
        }

        return (await instance.connect({ data: connectionData, reloadServerSettings: reloadSettings }));
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