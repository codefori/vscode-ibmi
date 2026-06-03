"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerConnectionCommands = void 0;
const vscode_1 = require("vscode");
const passwords_1 = require("../config/passwords");
const instantiate_1 = require("../instantiate");
function registerConnectionCommands(context, instance) {
    return [
        vscode_1.commands.registerCommand(`code-for-ibmi.connectDirect`, async (connectionData, reloadSettings = false, savePassword = false) => {
            const existingConnection = instance.getConnection();
            if (existingConnection) {
                return;
            }
            if (savePassword && connectionData.password) {
                await (0, passwords_1.setStoredPassword)(context, connectionData.name, connectionData.password);
            }
            return (await instance.connect({ data: connectionData, reloadServerSettings: reloadSettings }));
        }),
        vscode_1.commands.registerCommand(`code-for-ibmi.disconnect`, async (silent) => {
            if (instance.getConnection()) {
                await (0, instantiate_1.safeDisconnect)();
            }
            else if (!silent) {
                vscode_1.window.showErrorMessage(`Not currently connected to any system.`);
            }
        }),
    ];
}
exports.registerConnectionCommands = registerConnectionCommands;
//# sourceMappingURL=connection.js.map