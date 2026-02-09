import vscode, { l10n } from "vscode";
import { isActiveProfile, updateConnectionProfile } from "../api/connectionProfiles";
import { instance } from "../instantiate";
import { AnyConnectionProfile } from "../typings";
import { CustomEditor } from "./customEditorProvider";
import { verifyLatestServerProfileState } from "../ui/views/environment/environmentView";
import IBMi from "../api/IBMi";

type ConnectionProfileData = {
  homeDirectory: string
  currentLibrary: string
  libraryList: string
  setLibraryListCommand: string
}

const editedProfiles: Set<{ name: string, type: string }> = new Set;

export function isProfileEdited(profile: AnyConnectionProfile) {
  return editedProfiles.has({ name: profile.name, type: profile.type });
}

export function editConnectionProfile(profile: AnyConnectionProfile, doAfterSave?: () => Thenable<void>) {
  const activeProfile = isActiveProfile(profile);
  const config = instance.getConnection()?.getConfig();
  const objectFilters = (activeProfile && config ? config : profile).objectFilters;
  const ifsShortcuts = (activeProfile && config ? config : profile).ifsShortcuts;
  const customVariables = (activeProfile && config ? config : profile).customVariables;

  const profileEditor = new CustomEditor<ConnectionProfileData>(`${profile.name}.profile`, data => save(profile, data).then(doAfterSave), () => editedProfiles.delete({ name: profile.name, type: profile.type }));
  if (profile.type === `local`) {
    profileEditor
      .addInput("homeDirectory", l10n.t("Home Directory"), '', { minlength: 1, default: profile.homeDirectory, readonly: activeProfile })
  }
  profileEditor
    .addInput("currentLibrary", l10n.t("Current Library"), '', { minlength: 1, maxlength: 10, default: profile.currentLibrary, readonly: activeProfile })
    .addInput("libraryList", l10n.t("Library List"), l10n.t("A comma-separated list of libraries."), { default: profile.libraryList.join(","), readonly: activeProfile })
    .addInput("setLibraryListCommand", l10n.t("Library List Command"), l10n.t("Library List Command can be used to set your library list based on the result of a command like <code>CHGLIBL</code>, or your own command that sets the library list.<br/>Commands should be as explicit as possible.<br/>When refering to commands and objects, both should be qualified with a library.<br/>Put <code>?</code> in front of the command to prompt it before execution."), { default: profile.setLibraryListCommand })
    .addHorizontalRule()
    .addHeading(l10n.t("Object filters"), 3)
    .addParagraph(objectFilters.length ? `<ul>${objectFilters.map(filter => `<li>${filter.name}: <code>${`${filter.library}/${filter.object}/${filter.member}.${filter.memberType || `*`} (${filter.types.join(`, `)})`}</code></li>`).join('')}</ul>` : l10n.t("None"))
    .addHorizontalRule()
    .addHeading(l10n.t("IFS shortcuts"), 3)
    .addParagraph(ifsShortcuts.length ? `<ul>${ifsShortcuts.map(shortcut => `<li>${shortcut}</li>`).join('')}</ul>` : l10n.t("None"))
    .addHorizontalRule()
    .addHeading(l10n.t("Custom variables"), 3)
    .addParagraph(customVariables.length ? `<ul>${customVariables.map(variable => `<li>&${variable.name}: <code>${variable.value}</code></li>`).join('')}</ul>` : l10n.t("None"))
    .open();

  editedProfiles.add({ name: profile.name, type: profile.type });
}

async function save(profile: AnyConnectionProfile, data: ConnectionProfileData) {
  const connection = instance.getConnection();
  if (connection) {
    const content = connection.getContent();
    const config = connection.getConfig();
    const isActive = isActiveProfile(profile);
    if (isActive && profile.type === `server`) {
      config.setLibraryListCommand = data.setLibraryListCommand.trim();
      await IBMi.connectionManager.update(config);
    } else {
      if (profile.type === `local`) {
        profile.homeDirectory = data.homeDirectory.trim();
      }
      profile.setLibraryListCommand = data.setLibraryListCommand.trim();

      data.currentLibrary = data.currentLibrary.trim();
      if (data.currentLibrary) {
        if (await content.checkObject({ library: "QSYS", name: data.currentLibrary, type: "*LIB" })) {
          profile.currentLibrary = data.currentLibrary;
        }
        else {
          throw new Error(l10n.t("Current library {0} is invalid", data.currentLibrary));
        }
      }

      const libraryList = data.libraryList.split(',').map(library => library.trim());
      const badLibraries = await content.validateLibraryList(libraryList);
      if (badLibraries.length && !await vscode.window.showWarningMessage(l10n.t("The following libraries are invalid. Do you still want to save that profile?"), {
        modal: true,
        detail: badLibraries.sort().map(library => `- ${library}`).join("\n")
      }, l10n.t("Yes"))) {
        throw new Error(l10n.t("Save aborted"));
      }
      profile.libraryList = libraryList;

      const canProceed = await verifyLatestServerProfileState(profile);
      if (canProceed) {
        await updateConnectionProfile(profile);
      }
    }
  }
}