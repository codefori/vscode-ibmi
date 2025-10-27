import { l10n, window } from "vscode";
import IBMi from "./api/IBMi";

export async function mergeCommandProfiles() {
  const connectionSettings = IBMi.connectionManager.getConnectionSettings();
  let updateSettings = false;
  for (const settings of connectionSettings.filter(setting => setting.commandProfiles)) {
    for (const commandProfile of settings.commandProfiles) {
      settings.connectionProfiles.push({
        name: commandProfile.name as string,
        setLibraryListCommand: commandProfile.command as string,
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
    window.showInformationMessage(
      l10n.t("Your Command Profiles have been turned into Profiles since these two concepts have been merged with this new version of the Code for IBM i extension."),
      { modal: true, detail: l10n.t("Open the Context view once connected to find your profile(s) and run your library list command(s).") });
    await IBMi.connectionManager.updateAll(connectionSettings);
  }
}