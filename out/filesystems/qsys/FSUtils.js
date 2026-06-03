"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.reconnectFS = void 0;
const path_1 = __importDefault(require("path"));
const vscode_1 = __importStar(require("vscode"));
const IBMi_1 = __importDefault(require("../../api/IBMi"));
const Tools_1 = require("../../ui/Tools");
/**
 * Called when a member/streamfile is left open when VS Code is closed and re-opened to reconnect (or not) to the previous IBM i, based on the `autoReconnect` global configuration value.
 * If the user choses not to reconnect, the editor tab will be closed.
 *
 * @param uri the uri of the file triggerring the reconnection attempt
 * @returns `true` if the user choses to reconnect, `false` otherwise.
 */
async function reconnectFS(uri) {
    const reconnect = IBMi_1.default.connectionManager.get("autoReconnect") || "ask";
    let doReconnect = false;
    switch (reconnect) {
        case "always":
            doReconnect = true;
            break;
        case "ask":
            const lastConnection = IBMi_1.default.GlobalStorage.getLastConnections()?.at(0)?.name;
            if (lastConnection) {
                if (await vscode_1.default.window.showInformationMessage(vscode_1.l10n.t("Do you want to reconnect to {0} and open {1}?", lastConnection, path_1.default.basename(uri.path)), vscode_1.l10n.t("Reconnect"))) {
                    doReconnect = true;
                }
            }
            break;
        default:
    }
    if (doReconnect) {
        return await vscode_1.default.commands.executeCommand(`code-for-ibmi.connectToPrevious`);
    }
    else {
        for (const tab of Tools_1.VscodeTools.findUriTabs(uri)) {
            await vscode_1.default.window.tabGroups.close(tab);
        }
        return false;
    }
}
exports.reconnectFS = reconnectFS;
//# sourceMappingURL=FSUtils.js.map