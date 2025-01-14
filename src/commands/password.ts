import { commands, extensions, window, Disposable, ExtensionContext } from "vscode";
import Instance from "../Instance";
import { getStoredPassword } from "../config/passwords";


const passwordAttempts: { [extensionId: string]: number } = {}

export function registerPasswordCommands(context: ExtensionContext, instance: Instance): Disposable[] {
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
    })
  ]
}