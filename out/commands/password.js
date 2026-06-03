"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerPasswordCommands = void 0;
const vscode_1 = require("vscode");
const passwords_1 = require("../config/passwords");
const passwordAttempts = {};
function registerPasswordCommands(context, instance) {
    return [
        vscode_1.commands.registerCommand(`code-for-ibmi.getPassword`, async (extensionId, reason) => {
            if (extensionId) {
                const extension = vscode_1.extensions.getExtension(extensionId);
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
                        const storedPassword = await (0, passwords_1.getStoredPassword)(context, instance.getConnection().currentConnectionName);
                        if (storedPassword) {
                            let isAuthed = storage.getExtensionAuthorisation(extension.id) !== undefined;
                            if (!isAuthed) {
                                const detail = `The ${displayName} extension is requesting access to your password for this connection. ${reason ? `\n\nReason: ${reason}` : `The extension did not provide a reason for password access.`}`;
                                let done = false;
                                let modal = true;
                                while (!done) {
                                    const options = [`Allow`];
                                    if (modal) {
                                        options.push(`View on Marketplace`);
                                    }
                                    else {
                                        options.push(`Deny`);
                                    }
                                    const result = await vscode_1.window.showWarningMessage(modal ? `Password Request` : detail, {
                                        modal,
                                        detail,
                                    }, ...options);
                                    switch (result) {
                                        case `Allow`:
                                            await storage.grantExtensionAuthorisation(extension.id, displayName);
                                            isAuthed = true;
                                            done = true;
                                            break;
                                        case `View on Marketplace`:
                                            vscode_1.commands.executeCommand('extension.open', extensionId);
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
                            }
                            else {
                                passwordAttempts[extensionId]++;
                            }
                        }
                    }
                    else {
                        throw new Error(`Not connected to an IBM i.`);
                    }
                }
            }
        })
    ];
}
exports.registerPasswordCommands = registerPasswordCommands;
//# sourceMappingURL=password.js.map