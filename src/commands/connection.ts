import { commands, Disposable, ExtensionContext } from "vscode";
import { ConnectionManager } from "../api/Configuration";
import IBMi from "../api/IBMi";
import Instance from "../api/Instance";
import { ConnectionData } from "../typings";

export function registerConnectionCommands(context: ExtensionContext, instance: Instance): Disposable[] {
  const connection = instance.getConnection()!;

  return [
    commands.registerCommand(`code-for-ibmi.connectDirect`,
      async (connectionData: ConnectionData, reloadSettings = false, savePassword = false): Promise<boolean> => {
        const existingConnection = instance.getConnection();

        if (existingConnection) {
          return false;
        }

        if (savePassword && connectionData.password) {
          await ConnectionManager.setStoredPassword(context, connectionData.name, connectionData.password);
        }

        return (await new IBMi().connect(connectionData, undefined, reloadSettings)).success;
      }
    ),
  ]
}