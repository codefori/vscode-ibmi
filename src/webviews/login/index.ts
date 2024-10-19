import vscode, { l10n, ThemeIcon } from "vscode";
import { ConnectionConfiguration, ConnectionManager } from "../../api/Configuration";
import { CustomUI, Section } from "../../api/CustomUI";
import IBMi from "../../api/IBMi";
import { disconnect, instance } from "../../instantiate";
import { ConnectionData } from '../../typings';

type NewLoginSettings = ConnectionData & {
  savePassword: boolean
  buttons: 'saveExit' | 'connect'
  tempLibrary: string
  tempDir: string
}

export class Login {

  /**
   * Called when logging into a brand new system
   * @param {} context
   */
  static async show(context: vscode.ExtensionContext) {
    const connection = instance.getConnection();
    if (connection) {
      if (!disconnect()) return;
    }

    const connectionTab = new Section()
      .addInput(`name`, `Connection Name`, undefined, { minlength: 1 })
      .addInput(`host`, l10n.t(`Host or IP Address`), undefined, { minlength: 1 })
      .addInput(`port`, l10n.t(`Port (SSH)`), ``, { default: `22`, minlength: 1, maxlength: 5, regexTest: `^\\d+$` })
      .addInput(`username`, l10n.t(`Username`), undefined, { minlength: 1, maxlength: 10 })
      .addParagraph(l10n.t(`Only provide either the password or a private key - not both.`))
      .addPassword(`password`, l10n.t(`Password`))
      .addCheckbox(`savePassword`, l10n.t(`Save Password`))
      .addFile(`privateKeyPath`, l10n.t(`Private Key`), l10n.t(`Private Key`));

    const tempTab = new Section()
      .addInput(`tempLibrary`, `Temporary library`, `Temporary library. Cannot be QTEMP.`, { default: `ILEDITOR`, minlength: 1, maxlength: 10 })
      .addInput(`tempDir`, `Temporary IFS directory`, `Directory that will be used to write temporary files to. User must be authorized to create new files in this directory.`, { default: '/tmp', minlength: 1 });

    const page = await new CustomUI()
      .addComplexTabs([
        { label: `Connection`, fields: connectionTab.fields },
        { label: `Temporary data`, fields: tempTab.fields }
      ])
      .addButtons(
        { id: `connect`, label: `Connect`, requiresValidation: true },
        { id: `saveExit`, label: `Save & Exit` }
      )
      .loadPage<NewLoginSettings>(`IBM i Login`);

    if (page && page.data) {
      const data = page.data;
      page.panel.dispose();

      data.port = Number(data.port);
      data.privateKeyPath = data.privateKeyPath?.trim() ? data.privateKeyPath : undefined;
      if (data.name) {
        const existingConnection = ConnectionManager.getByName(data.name);

        if (existingConnection) {
          vscode.window.showErrorMessage(`Connection with name ${data.name} already exists.`);
        } else {
          // New connection!
          const newConnection: ConnectionData = {
            name: data.name,
            host: data.host,
            port: data.port,
            username: data.username,
            privateKeyPath: data.privateKeyPath
          };

          if (data.savePassword && data.password) {
            await ConnectionManager.setStoredPassword(context, data.name, data.password);
          }

          await ConnectionManager.storeNew(newConnection);

          const config = await ConnectionConfiguration.load(data.name)
          config.tempLibrary = data.tempLibrary;
          config.tempDir = data.tempDir;
          ConnectionConfiguration.update(config);
          vscode.commands.executeCommand(`code-for-ibmi.refreshConnections`);

          switch (data.buttons) {
            case `saveExit`:
              vscode.window.showInformationMessage(`Connection to ${data.host} saved!`);
              break;
            case `connect`:
              vscode.window.showInformationMessage(`Connecting to ${data.host}.`);
              const toDoOnConnected: Function[] = [];
              if (!data.password && !data.privateKeyPath && await promptPassword(context, data)) {
                toDoOnConnected.push(() => ConnectionManager.setStoredPassword(context, data.name, data.password!));
              }

              if (data.password || data.privateKeyPath) {
                try {
                  const connected = await new IBMi().connect(data, false, false, toDoOnConnected);
                  if (connected.success) {
                    if (newConnection) {
                      vscode.window.showInformationMessage(`Connected to ${data.host}! Would you like to configure this connection?`, `Open configuration`).then(async (selectionA) => {
                        if (selectionA === `Open configuration`) {
                          vscode.commands.executeCommand(`code-for-ibmi.showAdditionalSettings`);

                        } else {
                          vscode.window.showInformationMessage(`Source dates are disabled by default. Enable them in the connection settings.`, `Open configuration`).then(async (selectionB) => {
                            if (selectionB === `Open configuration`) {
                              vscode.commands.executeCommand(`code-for-ibmi.showAdditionalSettings`, undefined, `Source Code`);
                            }
                          });
                        }
                      });
                    } else {
                      vscode.window.showInformationMessage(`Connected to ${data.host}!`);
                    }

                  } else {
                    vscode.window.showErrorMessage(`Not connected to ${data.host}! ${connected.error.message || connected.error}`);
                  }
                } catch (e) {
                  vscode.window.showErrorMessage(`Error connecting to ${data.host}! ${e}`);
                }
              }
              break;
          }

        }
      } else {
        vscode.window.showErrorMessage(`Connection name is required.`);
      }
    }

    return;

  }

  /**
   * Start the login process to connect to a system
   * @param name Connection name
   * @param context
   */
  static async LoginToPrevious(name: string, context: vscode.ExtensionContext, reloadServerSettings?: boolean) {
    const existingConnection = instance.getConnection();
    if (existingConnection) {
      // If the user is already connected and trying to connect to a different system, disconnect them first
      if (name !== existingConnection.currentConnectionName) {
        vscode.window.showInformationMessage(`Disconnecting from ${existingConnection.currentHost}.`);
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
          if (await promptPassword(context, connectionConfig)) {
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
          vscode.window.showInformationMessage(`Connected to ${connectionConfig.host}!`);
        } else {
          vscode.window.showErrorMessage(`Not connected to ${connectionConfig.host}! ${connected.error.message || connected.error}`);
        }

        return true;
      } catch (e) {
        vscode.window.showErrorMessage(`Error connecting to ${connectionConfig.host}! ${e}`);
      }
    }

    return false;
  }

}

async function promptPassword(context: vscode.ExtensionContext, connection: ConnectionData) {
  let savePassword = false;
  const savePasswordLabel = "Save password and connect"
  const passwordBox = vscode.window.createInputBox();
  passwordBox.prompt = `Password for ${connection.name}`;
  passwordBox.password = true;
  passwordBox.buttons = [{
    iconPath: new ThemeIcon("save"),
    tooltip: savePasswordLabel
  }];

  const onClose = (button?: vscode.QuickInputButton | void) => {
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
