import vscode, { l10n, ThemeIcon } from "vscode";
import IBMi from "../../api/IBMi";
import { Tools } from "../../api/Tools";
import { deleteStoredPassword, getStoredPassphrase, getStoredPassword, setStoredPassphrase, setStoredPassword } from "../../config/passwords";
import { instance, safeDisconnect } from "../../instantiate";
import { ConnectionData } from '../../typings';
import { CustomUI, Section } from "../CustomUI";

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
      if (!safeDisconnect()) return;
    }

    const connectionTab = new Section()
      .addInput(`name`, `Connection Name`, undefined, { minlength: 1 })
      .addInput(`host`, l10n.t(`Host or IP Address`), undefined, { minlength: 1 })
      .addInput(`port`, l10n.t(`Port (SSH)`), ``, { default: `22`, min: 1, max: 65535, inputType: "number" })
      .addInput(`username`, l10n.t(`Username`), undefined, { minlength: 1, maxlength: 10 })
      .addHorizontalRule()
      .addParagraph(l10n.t(`Only provide either the password or a private key - not both.`))
      .addPassword(`password`, l10n.t(`Password`))
      .addCheckbox(`savePassword`, l10n.t(`Save Password`))
      .addCheckbox(`enableMfa`, l10n.t(`Enable Multi-Factor Authentication (MFA)`), l10n.t(`Enable this to be prompted for your additional factor when connecting.`))
      .addFile(`privateKeyPath`, l10n.t(`Private Key`), l10n.t(`OpenSSH, RFC4716 and PPK formats are supported.`))
      .addPassword(`passphrase`, l10n.t(`Key Passphrase`))
      .addHorizontalRule()
      .addInput(`readyTimeout`, l10n.t(`Connection Timeout (in milliseconds)`), l10n.t(`How long to wait for the SSH handshake to complete.`), { inputType: "number", min: 1, default: "20000" })
      .addCheckbox(`sshDebug`, l10n.t(`Turn on SSH debug output`), l10n.t(`Enable this to output debug traces in the Code for i and help diagnose SSH connection issues.`));
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
        { id: `saveExit`, label: `Save & Exit`, requiresValidation: true },
      )
      .loadPage<NewLoginSettings>(`IBM i Login`, checkLoginForm);

    if (page && page.data) {
      const data = page.data;
      page.panel.dispose();

      data.port = Number(data.port);
      data.readyTimeout = Number(data.readyTimeout);
      data.privateKeyPath = data.privateKeyPath?.trim() ? Tools.normalizePath(data.privateKeyPath) : undefined;
      if (data.name) {
        const existingConnection = IBMi.connectionManager.getByName(data.name);

        if (existingConnection) {
          vscode.window.showErrorMessage(`Connection with name ${data.name} already exists.`);
        } else {
          // New connection!
          const newConnection: ConnectionData = {
            name: data.name,
            host: data.host,
            port: data.port,
            username: data.username,
            privateKeyPath: data.privateKeyPath,
            passphrase: data.passphrase,
            enableMfa: data.enableMfa
          };

          if (data.savePassword && data.password) {
            delete data.privateKeyPath;
            delete data.passphrase;
            await setStoredPassword(context, data.name, data.password);
          }
          else if (data.privateKeyPath) {
            delete data.password;
            if (data.passphrase) {
              await setStoredPassphrase(context, data.name, data.passphrase);
            }
          }

          await IBMi.connectionManager.storeNew(newConnection);

          const config = await IBMi.connectionManager.load(data.name)
          config.tempLibrary = data.tempLibrary;
          config.tempDir = data.tempDir;
          IBMi.connectionManager.update(config);
          vscode.commands.executeCommand(`code-for-ibmi.refreshConnections`);

          switch (data.buttons) {
            case `saveExit`:
              vscode.window.showInformationMessage(`Connection to ${data.host} saved!`);
              break;
            case `connect`:
              vscode.window.showInformationMessage(`Connecting to ${data.host}.`);
              const toDoOnConnected: Function[] = [];
              if (!data.password && !data.privateKeyPath && await promptPassword(data)) {
                toDoOnConnected.push(() => setStoredPassword(context, data.name, data.password!));
              }

              if (data.password || data.privateKeyPath) {
                try {
                  const connected = await instance.connect({ data, onConnectedOperations: toDoOnConnected });
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
                    vscode.window.showErrorMessage(`Not connected to ${data.host}${connected.error ? `: ${connected.error}` : '!'}`);
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
        if (!await safeDisconnect()) return false;
      }
    }

    const connection = IBMi.connectionManager.getByName(name);
    if (connection) {
      const toDoOnConnected: Function[] = [];
      const connectionConfig = connection.data;
      if (connectionConfig.privateKeyPath) {
        // If connecting with a private key, remove the password
        await deleteStoredPassword(context, connectionConfig.name);
        connectionConfig.passphrase = await getStoredPassphrase(context, connectionConfig.name);
      } else {
        // Assume connection with a password, but prompt if we don't have one        
        connectionConfig.password = await getStoredPassword(context, connectionConfig.name);
        if (!connectionConfig.password) {
          if (await promptPassword(connectionConfig)) {
            toDoOnConnected.push(() => setStoredPassword(context, connectionConfig.name, connectionConfig.password!));
          }
        }

        if (!connectionConfig.password) {
          return false;
        }
      }

      try {
        const connected = await instance.connect({ data: connectionConfig, onConnectedOperations: toDoOnConnected, reloadServerSettings });
        if (connected.success) {
          vscode.window.showInformationMessage(`Connected to ${connectionConfig.host}!`);
          return true;
        } else {
          vscode.window.showErrorMessage(`Not connected to ${connectionConfig.host}${connected.error ? `: ${connected.error}` : '!'}`);
        }
      } catch (e) {
        vscode.window.showErrorMessage(`Error connecting to ${connectionConfig.host}! ${e}`);
      }
    }

    return false;
  }

}

async function promptPassword(connection: ConnectionData) {
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

export async function checkLoginForm(data: ConnectionData) {
  if (data.password && data.privateKeyPath) {
    const password = l10n.t("Password");
    const privateKey = l10n.t("Private Key");
    const toKeep = await vscode.window.showWarningMessage(l10n.t("Both a password and a private key were provided. Which one should be kept?"), { modal: true }, password, privateKey);
    if (toKeep === password) {
      delete data.privateKeyPath;
      delete data.passphrase;
    }
    else if (toKeep === privateKey) {
      delete data.password;
    }
    else {
      return false;
    }
  }
  return true;
}