import vscode from "vscode";
import { ConnectionConfiguration, GlobalConfiguration } from "../../api/Configuration";
import { CustomUI, Section } from "../../api/CustomUI";
import IBMi from "../../api/IBMi";
import { disconnect, instance } from "../../instantiate";
import { ConnectionData } from '../../typings';
import { t } from "../../locale";

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

    const existingConnections = GlobalConfiguration.get<ConnectionData[]>(`connections`) || [];

    const connectionTab = new Section()
      .addInput(`name`, `Connection Name`, undefined, { minlength: 1 })
      .addInput(`host`, t(`login.host`), undefined, { minlength: 1 })
      .addInput(`port`, t(`login.port`), ``, { default: `22`, minlength: 1, maxlength: 5, regexTest: `^\\d+$` })
      .addInput(`username`, t(`username`), undefined, { minlength: 1, maxlength: 10 })
      .addParagraph(t(`login.authDecision`))
      .addPassword(`password`, t(`password`))
      .addCheckbox(`savePassword`, t(`login.savePassword`))
      .addFile(`privateKeyPath`, t(`privateKey`), t(`login.privateKey.support`));

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
        const existingConnection = existingConnections.find(item => item.name === data.name);

        if (existingConnection) {
          vscode.window.showErrorMessage(`Connection with name ${data.name} already exists.`);
        } else {
          const newConnection = (!existingConnections.some(item => item.name === data.name));
          if (newConnection) {
            // New connection!
            existingConnections.push({
              name: data.name,
              host: data.host,
              port: data.port,
              username: data.username,
              privateKeyPath: data.privateKeyPath
            });

            if (data.savePassword) {
              await context.secrets.store(`${data.name}_password`, `${data.password}`);
            }

            await GlobalConfiguration.set(`connections`, existingConnections);

            const config = await ConnectionConfiguration.load(data.name)
            config.tempLibrary = data.tempLibrary;
            config.tempDir = data.tempDir;
            ConnectionConfiguration.update(config);
            vscode.commands.executeCommand(`code-for-ibmi.refreshConnections`);
          }

          switch (data.buttons) {
            case `saveExit`:
              vscode.window.showInformationMessage(`Connection to ${data.host} saved!`);
              break;
            case `connect`:
              vscode.window.showInformationMessage(`Connecting to ${data.host}.`);
              const connection = new IBMi();

              try {
                const connected = await connection.connect(data);
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
    const connection = instance.getConnection();
    if (connection) {
      // If the user is already connected and trying to connect to a different system, disconnect them first
      if (name !== connection.currentConnectionName) {
        vscode.window.showInformationMessage(`Disconnecting from ${connection.currentHost}.`);
        if (!disconnect()) return false;
      }
    }

    const existingConnections = GlobalConfiguration.get<ConnectionData[]>(`connections`) || [];
    let connectionConfig = existingConnections.find(item => item.name === name);
    if (connectionConfig) {
      if (connectionConfig.privateKeyPath) {
        // If connecting with a private key, remove the password
        await context.secrets.delete(`${connectionConfig.name}_password`);

      } else {
        // Assume connection with a password, but prompt if we don't have one
        connectionConfig.password = await context.secrets.get(`${connectionConfig.name}_password`);
        if (!connectionConfig.password) {
          connectionConfig.password = await vscode.window.showInputBox({
            prompt: `Password for ${connectionConfig.name}`,
            password: true
          });
        }

        if (!connectionConfig.password) {
          return;
        }
      }

      try {
        const connected = await new IBMi().connect(connectionConfig, undefined, reloadServerSettings);
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