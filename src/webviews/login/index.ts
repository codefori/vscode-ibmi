import vscode, { l10n, ThemeIcon } from "vscode";
import { ConnectionConfiguration, ConnectionManager } from "../../api/Configuration";
import { CustomUI, Section } from "../../api/CustomUI";
import { disconnect, instance } from "../../instantiate";
import { ConnectionData } from '../../typings';
import { LoginNew } from "../../login";

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
      .addFile(`privateKeyPath`, l10n.t(`Private Key`), l10n.t(`OpenSSH, RFC4716, or PPK formats are supported.`));

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
              LoginNew(context, newConnection);
              break;
          }

        }
      } else {
        vscode.window.showErrorMessage(`Connection name is required.`);
      }
    }

    return;

  }
}