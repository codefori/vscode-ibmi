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
      if (instance.getActiveConnection()) {
        await safeDisconnect();
      } else if (!silent) {
        window.showErrorMessage(`Not currently connected to any system.`);
      }
    }),

    commands.registerCommand(`code-for-ibmi.switchActiveConnection`, () => {
      const availableConnections = instance.getConnections();

      if (availableConnections.length === 0) {
        window.showErrorMessage(`No connections found.`);
        return;
      }

      if (availableConnections.length === 1) {
        window.showInformationMessage(`Only one connection found. Automatically connecting.`);
        return;
      }

      const connectionNames = availableConnections.map(c => c.currentConnectionName);

      window.showQuickPick(connectionNames, {placeHolder: `Select a connection to switch to`}).then(async (selectedConnection) => {
        if (selectedConnection) {
          instance.setActiveConnection(selectedConnection);
        }
      });
    })
  ]
}