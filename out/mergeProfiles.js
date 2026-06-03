"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.mergeCommandProfiles = void 0;
const vscode_1 = require("vscode");
const IBMi_1 = __importDefault(require("./api/IBMi"));
async function mergeCommandProfiles() {
    const connectionSettings = IBMi_1.default.connectionManager.getConnectionSettings();
    let updateSettings = false;
    for (const settings of connectionSettings.filter(setting => setting.commandProfiles)) {
        for (const commandProfile of settings.commandProfiles) {
            settings.connectionProfiles.push({
                name: commandProfile.name,
                setLibraryListCommand: commandProfile.command,
                currentLibrary: "QGPL",
                customVariables: [],
                homeDirectory: settings.homeDirectory,
                ifsShortcuts: [],
                libraryList: ["QGPL", "QTEMP"],
                objectFilters: []
            });
        }
        delete settings.commandProfiles;
        updateSettings = true;
    }
    if (updateSettings) {
        vscode_1.window.showInformationMessage(vscode_1.l10n.t("Your Command Profiles have been turned into Profiles since these two concepts have been merged with this new version of the Code for IBM i extension."), { modal: true, detail: vscode_1.l10n.t("Open the Environment view once connected to find your profile(s) and run your library list command(s).") });
        await IBMi_1.default.connectionManager.updateAll(connectionSettings);
    }
}
exports.mergeCommandProfiles = mergeCommandProfiles;
//# sourceMappingURL=mergeProfiles.js.map