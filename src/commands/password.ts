import { commands, Disposable, ExtensionContext, extensions, l10n, ProgressLocation, window } from "vscode";
import Instance from "../Instance";
import { PasswordManager } from "../api/components/password";
import { getStoredPassword, setStoredPassword } from "../config/passwords";
import { CustomUI } from "../webviews/CustomUI";


const passwordAttempts: { [extensionId: string]: number } = {}

export function registerPasswordCommands(context: ExtensionContext, instance: Instance): Disposable[] {
  instance.subscribe(context, "connected", "Check password expiration", async () => {
    const nextCheck = instance.getStorage()?.getNextPasswordCheck();
    //Never checked or next check is overdue
    const today = new Date();
    if (!nextCheck || today > nextCheck) {
      const connection = instance.getConnection();
      const expiration = await connection?.getComponent<PasswordManager>(PasswordManager.ID)?.getPasswordExpiration(connection);
      let whenNextDay = 7; //Next check in one week by default
      if (expiration) {
        if (expiration.daysLeft < 7) {
          //Less than a week left: check every day
          whenNextDay = 1;
        }
        else if (expiration.daysLeft < 14) {
          //Less than two weeks left: check again when there will be one week left
          whenNextDay = expiration.daysLeft - 7;
        }

        if (expiration.daysLeft <= 14) { //Warn at least two weeks before expiration
          window.showInformationMessage(l10n.t("Your IBM i password will expire in {0} day(s); do you want to change it now?", expiration.daysLeft), { modal: true }, l10n.t("Change password"))
            .then(change => {
              if (change) {
                commands.executeCommand("code-for-ibmi.changePassword");
              }
            });
        }
      }

      instance.getStorage()?.setNextPasswordCheck(today.setDate(today.getDate() + whenNextDay));
    }
  });

  return [
    commands.registerCommand(`code-for-ibmi.getPassword`, async (extensionId: string, reason?: string) => {
      if (extensionId) {
        const extension = extensions.getExtension(extensionId);
        const isValid = (extension && extension.isActive);
        if (isValid) {
          const connection = instance.getConnection();
          const storage = instance.getStorage();
          if (connection && storage) {
            const displayName = extension.packageJSON.displayName || extensionId;

            // Some logic to stop spam from extensions.
            passwordAttempts[extensionId] = passwordAttempts[extensionId] || 0;
            if (passwordAttempts[extensionId] > 1) {
              throw new Error(`Password request denied for extension ${displayName}.`);
            }

            const storedPassword = await getStoredPassword(context, instance.getConnection()!.currentConnectionName);

            if (storedPassword) {
              let isAuthed = storage.getExtensionAuthorisation(extension.id) !== undefined;

              if (!isAuthed) {
                const detail = `The ${displayName} extension is requesting access to your password for this connection. ${reason ? `\n\nReason: ${reason}` : `The extension did not provide a reason for password access.`}`;
                let done = false;
                let modal = true;

                while (!done) {
                  const options: string[] = [`Allow`];

                  if (modal) {
                    options.push(`View on Marketplace`);
                  } else {
                    options.push(`Deny`);
                  }

                  const result = await window.showWarningMessage(
                    modal ? `Password Request` : detail,
                    {
                      modal,
                      detail,
                    },
                    ...options
                  );

                  switch (result) {
                    case `Allow`:
                      await storage.grantExtensionAuthorisation(extension.id, displayName);
                      isAuthed = true;
                      done = true;
                      break;

                    case `View on Marketplace`:
                      commands.executeCommand('extension.open', extensionId);
                      modal = false;
                      break;

                    default:
                      done = true;
                      break;
                  }
                }
              }

              if (isAuthed) {
                return storedPassword;
              } else {
                passwordAttempts[extensionId]++;
              }
            }

          } else {
            throw new Error(`Not connected to an IBM i.`);
          }
        }
      }
    }),
    commands.registerCommand("code-for-ibmi.changePassword", async () => {
      const connection = instance.getConnection();
      if (connection) {
        let currentPassword = "";
        let newPassword = "";
        let done = false;
        let error = "";
        while (!done) {
          const form = new CustomUI().addHeading(l10n.t("Change password for {0} on {1}", connection.currentUser, connection.currentConnectionName));
          if (error) {
            form.addParagraph(`<span style="color: var(--vscode-errorForeground)">${error}</span>`);
          }
          const page = (await form.addPassword("currentPassword", l10n.t("Current password"), '', currentPassword)
            .addPassword("newPassword", l10n.t("New password"), '', newPassword)
            .addPassword("newPasswordConfirm", l10n.t("Confirm new password"), '')
            .addButtons({ id: "apply", label: l10n.t("Change password"), requiresValidation: false })
            .loadPage<{ currentPassword: string, newPassword: string, newPasswordConfirm: string }>(l10n.t("Password change")));

          if (page?.data) {
            const data = page.data;
            currentPassword = data.currentPassword;
            newPassword = data.newPassword;
            if (!currentPassword || !newPassword || !data.newPasswordConfirm) {
              error = l10n.t("Every password field must be filled.")
            }
            else if (data.currentPassword === data.newPassword) {
              error = l10n.t("New password must be different from the current one.")
            }
            else if (data.newPassword !== data.newPasswordConfirm) {
              error = l10n.t("New password field and confirmation field don't match.")
            }
            else {
              try {
                await window.withProgress({ title: l10n.t("Changing password..."), location: ProgressLocation.Notification }, async () => await connection.getComponent<PasswordManager>(PasswordManager.ID)?.changePassword(connection, currentPassword, newPassword));
                if (await getStoredPassword(context, connection.currentConnectionName)) {
                  //Only save the new password if one was already stored
                  await setStoredPassword(context, connection.currentConnectionName, newPassword);
                }
                const today = new Date();
                await instance.getStorage()?.setNextPasswordCheck(today.setDate(today.getDate() + 7));
                window.showInformationMessage(l10n.t("Password successfully changed for {0} on {1}", connection.currentUser, connection.currentConnectionName));
                done = true;
              }
              catch (e: any) {
                error = l10n.t("Password change failed: {0}", e instanceof Error ? e.message : String(e));
              }
            }
          }
          else {
            done = true;
          }
          page?.panel.dispose();
        }
      } else {
        throw new Error(`Not connected to an IBM i.`);
      }
    })
  ]
}