import { window, commands, ExtensionContext, QuickInputButton, ThemeIcon } from "vscode";
import { ConnectionManager } from "./api/Configuration";
import IBMi from "./api/IBMi";
import { ConnectionData } from "./typings";
import { instance, disconnect } from "./instantiate";

export async function LoginNew(context: ExtensionContext, data: ConnectionData) {
  window.showInformationMessage(`Connecting to ${data.host}.`);
  const toDoOnConnected: Function[] = [];
  if (!data.password && !data.privateKeyPath && await promptPassword(data)) {
    toDoOnConnected.push(() => ConnectionManager.setStoredPassword(context, data.name, data.password!));
  }

  if (data.password || data.privateKeyPath) {
    try {
      const connected = await new IBMi().connect(data, false, false, toDoOnConnected);
      if (connected.success) {
        window.showInformationMessage(`Connected to ${data.host}! Would you like to configure this connection?`, `Open configuration`).then(async (selectionA) => {
          if (selectionA === `Open configuration`) {
            commands.executeCommand(`code-for-ibmi.showAdditionalSettings`);

          } else {
            window.showInformationMessage(`Source dates are disabled by default. Enable them in the connection settings.`, `Open configuration`).then(async (selectionB) => {
              if (selectionB === `Open configuration`) {
                commands.executeCommand(`code-for-ibmi.showAdditionalSettings`, undefined, `Source Code`);
              }
            });
          }
        });
      } else {
        window.showErrorMessage(`Not connected to ${data.host}! ${connected.error.message || connected.error}`);
      }
    } catch (e) {
      window.showErrorMessage(`Error connecting to ${data.host}! ${e}`);
    }
  } 
}

export async function LoginToPrevious(name: string, context: ExtensionContext, reloadServerSettings?: boolean) {
  const existingConnection = instance.getConnection();
  if (existingConnection) {
    // If the user is already connected and trying to connect to a different system, disconnect them first
    if (name !== existingConnection.currentConnectionName) {
      window.showInformationMessage(`Disconnecting from ${existingConnection.currentHost}.`);
      if (!await disconnect()) return false;
    }
  }

  const connection = ConnectionManager.getByName(name);
  if (connection) {
    const toDoOnConnected: Function[] = [];
    const connectionConfig = connection.data;
    if (connectionConfig.privateKeyPath) {
      // If connecting with a private key, remove the password
      await ConnectionManager.deleteStoredPassword(context, connectionConfig.name);
    } else {
      // Assume connection with a password, but prompt if we don't have one        
      connectionConfig.password = await ConnectionManager.getStoredPassword(context, connectionConfig.name);
      if (!connectionConfig.password) {
        if (await promptPassword(connectionConfig)) {
          toDoOnConnected.push(() => ConnectionManager.setStoredPassword(context, connectionConfig.name, connectionConfig.password!));
        }
      }

      if (!connectionConfig.password) {
        return;
      }
    }

    try {
      const connected = await new IBMi().connect(connectionConfig, undefined, reloadServerSettings, toDoOnConnected);
      if (connected.success) {
        window.showInformationMessage(`Connected to ${connectionConfig.host}!`);
      } else {
        window.showErrorMessage(`Not connected to ${connectionConfig.host}! ${connected.error.message || connected.error}`);
      }

      return true;
    } catch (e) {
      window.showErrorMessage(`Error connecting to ${connectionConfig.host}! ${e}`);
    }
  }

  return false;
}


async function promptPassword(connection: ConnectionData) {
  let savePassword = false;
  const savePasswordLabel = "Save password and connect"
  const passwordBox = window.createInputBox();
  passwordBox.prompt = `Password for ${connection.name}`;
  passwordBox.password = true;
  passwordBox.buttons = [{
    iconPath: new ThemeIcon("save"),
    tooltip: savePasswordLabel
  }];

  const onClose = (button?: QuickInputButton | void) => {
    if (button && button.tooltip === savePasswordLabel) {
      savePassword = true;
    }
    connection.password = passwordBox.value;
    passwordBox.dispose();
  };
  passwordBox.onDidTriggerButton(onClose);
  passwordBox.onDidAccept(onClose);

  passwordBox.show();
  await new Promise(resolve => passwordBox.onDidHide(resolve));
  return savePassword;
}
