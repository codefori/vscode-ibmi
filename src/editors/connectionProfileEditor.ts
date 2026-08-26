import vscode, { l10n } from "vscode";
import { isActiveProfile, updateConnectionProfile } from "../api/connectionProfiles";
import { instance } from "../instantiate";
import { ConnectionProfile } from "../typings";
import { VscodeTools } from "../ui/Tools";
import { CustomEditor } from "./customEditorProvider";

type ConnectionProfileData = {
  homeDirectory: string
  currentLibrary: string
  libraryList: string
  setLibraryListCommand: string
  iasp: string
  statusBarColor: string
}

const editedProfiles: Set<string> = new Set;

export function isProfileEdited(profile: ConnectionProfile) {
  return editedProfiles.has(profile.name);
}

export function editConnectionProfile(profile: ConnectionProfile, doAfterSave?: () => Thenable<void>) {
  const activeProfile = isActiveProfile(profile);
  const config = instance.getConnection()?.getConfig();
  const objectFilters = (activeProfile && config ? config : profile).objectFilters;
  const ifsShortcuts = (activeProfile && config ? config : profile).ifsShortcuts;
  const customVariables = (activeProfile && config ? config : profile).customVariables;

  new CustomEditor<ConnectionProfileData>(`${profile.name}.profile`, data => save(profile, data).then(doAfterSave), () => editedProfiles.delete(profile.name))
    .addInput("homeDirectory", l10n.t("Home Directory"), '', { minlength: 1, default: profile.homeDirectory, readonly: activeProfile })
    .addInput("currentLibrary", l10n.t("Current Library"), '', { minlength: 1, maxlength: 10, default: profile.currentLibrary, readonly: activeProfile })
    .addInput("libraryList", l10n.t("Library List"), l10n.t("A comma-separated list of libraries."), { default: profile.libraryList.join(","), readonly: activeProfile })
    .addInput("iasp", l10n.t("Current IASP"), l10n.t("The independent ASP to enable when using this profile. If the database name of this ASP is different from its name, make sure to use the database name here. Leave blank to use the system ASP."), { default: profile.iasp, readonly: activeProfile })
    .addInput("setLibraryListCommand", l10n.t("Library List Command"), l10n.t("Library List Command can be used to set your library list based on the result of a command like <code>CHGLIBL</code>, or your own command that sets the library list.<br/>Commands should be as explicit as possible.<br/>When refering to commands and objects, both should be qualified with a library.<br/>Put <code>?</code> in front of the command to prompt it before execution."), { default: profile.setLibraryListCommand })
    .addInput("statusBarColor", l10n.t("Status bar color"), l10n.t("The color of the status bar items while this profile is active. Useful to tell your environments apart at a glance. Pick black to keep the color of the current theme."), { default: (profile.statusBarColor ?? config?.statusBarColor) || `#000000`, inputType: "color" })
    .addHorizontalRule()
    .addHeading(l10n.t("Object filters"), 3)
    .addParagraph(objectFilters.length ? `<ul>${objectFilters.map(filter => `<li>${filter.name}</li>`).join('')}</ul>` : l10n.t("None"))
    .addHorizontalRule()
    .addHeading(l10n.t("IFS shortcuts"), 3)
    .addParagraph(ifsShortcuts.length ? `<ul>${ifsShortcuts.map(shortcut => `<li>${shortcut}</li>`).join('')}</ul>` : l10n.t("None"))
    .addHorizontalRule()
    .addHeading(l10n.t("Custom variables"), 3)
    .addParagraph(customVariables.length ? `<ul>${customVariables.map(variable => `<li>&${variable.name}: <code>${variable.value}</code></li>`).join('')}</ul>` : l10n.t("None"))
    .open();

  editedProfiles.add(profile.name);
}

async function save(profile: ConnectionProfile, data: ConnectionProfileData) {
  const connection = instance.getConnection();

  if (connection) {
    const content = connection.getContent();
    profile.homeDirectory = data.homeDirectory.trim();
    profile.iasp = data.iasp.trim() ? data.iasp.trim() : undefined;
    profile.setLibraryListCommand = data.setLibraryListCommand.trim();
    profile.statusBarColor = VscodeTools.parseStatusBarColor(data.statusBarColor) || ``;

    const currentASP = connection.getCurrentASP();
    try {
      await connection.setCurrentASP(profile.iasp);
      data.currentLibrary = data.currentLibrary.trim();
      if (data.currentLibrary) {
        if (data.currentLibrary === '*CRTDFT' || await content.checkObject({ library: "QSYS", name: data.currentLibrary, type: "*LIB" })) {
          profile.currentLibrary = data.currentLibrary;
        }
        else {
          throw new Error(l10n.t("Current library {0} is invalid", data.currentLibrary));
        }
      }

      let libraryList = data.libraryList.split(',').map(library => library.trim());

      const systemLibraries = await content.getSystemLibraries();
      const librariesInSystemPortion = libraryList.filter(library => systemLibraries.includes(connection.upperCaseName(library)));
      if (librariesInSystemPortion.length) {
        libraryList = libraryList.filter(library => !librariesInSystemPortion.includes(library));
        vscode.window.showWarningMessage(l10n.t("The following libraries are already in the system portion of the library list and were removed: {0}", librariesInSystemPortion.sort().join(', ')));
      }

      const badLibraries = await content.validateLibraryList(libraryList);
      if (badLibraries.length && !await vscode.window.showWarningMessage(l10n.t("The following libraries are invalid. Do you still want to save that profile?"), {
        modal: true,
        detail: badLibraries.sort().map(library => `- ${library}`).join("\n")
      }, l10n.t("Yes"))) {
        throw new Error(l10n.t("Save aborted"));
      }
      profile.libraryList = libraryList;

      await updateConnectionProfile(profile);
    }
    finally {
      await connection.setCurrentASP(currentASP);
    }
  }
}