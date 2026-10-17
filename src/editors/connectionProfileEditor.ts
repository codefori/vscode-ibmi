import vscode, { l10n } from "vscode";
import { getConnectionProfile, isActiveProfile } from "../api/connectionProfiles";
import { instance } from "../instantiate";
import { AnyConnectionProfile } from "../typings";
import { VscodeTools } from "../ui/Tools";
import { CustomEditor } from "./customEditorProvider";
import { saveConnectionProfile, verifyLatestServerProfileState } from "../ui/views/environment/environmentView";
import IBMi from "../api/IBMi";

type ConnectionProfileData = {
  homeDirectory: string
  currentLibrary: string
  libraryList: string
  setLibraryListCommand: string
  iasp: string
  statusBarColor: string
}

const editedProfiles: Set<string> = new Set;

function getEditedKey(profile: AnyConnectionProfile) {
  return `${profile.type}:${profile.name}`;
}

export function isProfileEdited(profile: AnyConnectionProfile) {
  return editedProfiles.has(getEditedKey(profile));
}

/** What each opened editor last loaded or saved: reverting goes back to it, without asking the server */
const savedProfiles: WeakMap<CustomEditor<ConnectionProfileData>, AnyConnectionProfile> = new WeakMap;

export function editConnectionProfile(profile: AnyConnectionProfile, doAfterSave?: () => Thenable<void>) {
  const profileEditor: CustomEditor<ConnectionProfileData> = new CustomEditor<ConnectionProfileData>(
    `${profile.name}.profile`,
    data => save(profileEditor, profile, data).then(() => { savedProfiles.set(profileEditor, structuredClone(profile)); }).then(doAfterSave),
    () => editedProfiles.delete(getEditedKey(profile)),
    async () => revert(profileEditor, profile)
  );
  savedProfiles.set(profileEditor, structuredClone(profile));
  buildForm(profileEditor, profile);
  profileEditor.open();

  editedProfiles.add(getEditedKey(profile));
}

function getFormData(profile: AnyConnectionProfile): ConnectionProfileData {
  const config = instance.getConnection()?.getConfig();
  return {
    homeDirectory: profile.homeDirectory || ``,
    currentLibrary: profile.currentLibrary || ``,
    libraryList: profile.libraryList.join(","),
    setLibraryListCommand: profile.setLibraryListCommand || ``,
    iasp: profile.iasp || ``,
    statusBarColor: (profile.statusBarColor ?? config?.statusBarColor) || `#000000`
  };
}

function buildForm(profileEditor: CustomEditor<ConnectionProfileData>, profile: AnyConnectionProfile) {
  const activeProfile = isActiveProfile(profile);
  const config = instance.getConnection()?.getConfig();
  const objectFilters = (activeProfile && config ? config : profile).objectFilters;
  const ifsShortcuts = (activeProfile && config ? config : profile).ifsShortcuts;
  const customVariables = (activeProfile && config ? config : profile).customVariables;
  const data = getFormData(profile);

  if (profile.type === `local`) {
    profileEditor
      .addInput("homeDirectory", l10n.t("Home Directory"), '', { minlength: 1, default: data.homeDirectory, readonly: activeProfile })
  }
  profileEditor
    .addInput("currentLibrary", l10n.t("Current Library"), l10n.t("Leave blank or use <code>*CRTDFT</code> to set no current library.<br/>Overwritten if <code>Library List Command</code> is set and run."), { minlength: 0, maxlength: 10, default: data.currentLibrary, readonly: activeProfile })
    .addInput("libraryList", l10n.t("Library List"), l10n.t("A comma-separated list of libraries.<br/>Overwritten if <code>Library List Command</code> is set and run."), { default: data.libraryList, readonly: activeProfile })
    .addInput("iasp", l10n.t("Current IASP"), l10n.t("The independent ASP to enable when using this profile. If the database name of this ASP is different from its name, make sure to use the database name here. Leave blank to use the system ASP."), { default: data.iasp, readonly: activeProfile })
    .addInput("setLibraryListCommand", l10n.t("Library List Command"), l10n.t("Library List Command can be used to set your library list based on the result of a command like <code>CHGLIBL</code>, or your own command that sets the library list.<br/>Commands should be as explicit as possible.<br/>When refering to commands and objects, both should be qualified with a library.<br/>Put <code>?</code> in front of the command to prompt it before execution."), { default: data.setLibraryListCommand })
    .addInput("statusBarColor", l10n.t("Status bar color"), l10n.t("The color of the status bar items while this profile is active. Useful to tell your environments apart at a glance. Pick black to keep the color of the current theme."), { default: data.statusBarColor, inputType: "color" })
    .addHorizontalRule()
    .addHeading(l10n.t("Object filters"), 3)
    .addParagraph(objectFilters.length ? `<ul>${objectFilters.map(filter => `<li>${filter.name}: <code>${`${filter.library}/${filter.object}/${filter.member}.${filter.memberType || `*`} (${filter.types.join(`, `)})`}</code></li>`).join('')}</ul>` : l10n.t("None"))
    .addHorizontalRule()
    .addHeading(l10n.t("IFS shortcuts"), 3)
    .addParagraph(ifsShortcuts.length ? `<ul>${ifsShortcuts.map(shortcut => `<li>${shortcut}</li>`).join('')}</ul>` : l10n.t("None"))
    .addHorizontalRule()
    .addHeading(l10n.t("Custom variables"), 3)
    .addParagraph(customVariables.length ? `<ul>${customVariables.map(variable => `<li>&${variable.name}: <code>${variable.value}</code></li>`).join('')}</ul>` : l10n.t("None"));
}

/** Replaces the content of `profile` with the one of `from`; the unsaved values may already be set on `profile`, those `from` doesn't have must go too */
function replaceProfile(profile: AnyConnectionProfile, from: AnyConnectionProfile) {
  for (const key of Object.keys(profile)) {
    if (!(key in from)) {
      delete (profile as any)[key];
    }
  }
  Object.assign(profile, structuredClone(from));
}

/** Goes back to what was last loaded or saved in this editor */
function revert(profileEditor: CustomEditor<ConnectionProfileData>, profile: AnyConnectionProfile) {
  const saved = savedProfiles.get(profileEditor);
  if (saved) {
    replaceProfile(profile, saved);
    profileEditor.rebuild(editor => buildForm(editor, profile), getFormData(profile), false);
  }
}

/**
 * Replaces the profile and the form with what is on the server now; the editor stays dirty so the profile can be saved again right away.
 * @throws an Error if the profile no longer exists on the server
 */
async function reloadFromServer(profileEditor: CustomEditor<ConnectionProfileData>, profile: AnyConnectionProfile) {
  await vscode.commands.executeCommand("code-for-ibmi.environment.refresh");

  const latest = await getConnectionProfile(profile.name, `server`);
  if (!latest) {
    throw new Error(l10n.t("Server profile {0} no longer exists on the server. Save again and choose to overwrite to create it again, or close this editor.", profile.name));
  }

  replaceProfile(profile, latest);
  savedProfiles.set(profileEditor, structuredClone(latest));
  profileEditor.rebuild(editor => buildForm(editor, profile), getFormData(profile), true);
}

async function save(profileEditor: CustomEditor<ConnectionProfileData>, profile: AnyConnectionProfile, data: ConnectionProfileData) {
  // Validating and writing a profile takes several round trips to the server: show what is going on
  await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: l10n.t("Saving profile {0}", profile.name) },
    progress => saveProfile(profileEditor, profile, data, progress));
}

async function saveProfile(profileEditor: CustomEditor<ConnectionProfileData>, profile: AnyConnectionProfile, data: ConnectionProfileData, progress: vscode.Progress<{ message?: string }>) {
  const connection = instance.getConnection();

  if (connection) {
    const content = connection.getContent();
    const config = connection.getConfig();
    const isActive = isActiveProfile(profile);
    if (isActive && profile.type === `server`) {
      config.setLibraryListCommand = data.setLibraryListCommand.trim();
      config.statusBarColor = VscodeTools.parseStatusBarColor(data.statusBarColor) || ``;
      await IBMi.connectionManager.update(config);
    } else {
      if (profile.type === `local`) {
        profile.homeDirectory = data.homeDirectory.trim();
      }
      profile.iasp = data.iasp.trim() ? data.iasp.trim() : undefined;
      profile.setLibraryListCommand = data.setLibraryListCommand.trim();
      profile.statusBarColor = VscodeTools.parseStatusBarColor(data.statusBarColor) || ``;

      const currentASP = connection.getCurrentASP();
      try {
        progress.report({ message: l10n.t("Validating the libraries...") });
        await connection.setCurrentASP(profile.iasp);

        data.currentLibrary = connection.upperCaseName(data.currentLibrary.trim());
        if (!data.currentLibrary || data.currentLibrary === '*CRTDFT') {
          profile.currentLibrary = undefined;
        }
        else if (await content.checkObject({ library: "QSYS", name: data.currentLibrary, type: "*LIB" })) {
          profile.currentLibrary = data.currentLibrary;
        }
        else {
          throw new Error(l10n.t("Current library {0} is invalid", data.currentLibrary));
        }

        let libraryList = data.libraryList.split(',').map(library => connection.upperCaseName(library.trim())).filter(Boolean);

        const librariesInSystemPortion = libraryList.filter(library => connection.systemLibraries.includes(library));
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

        let reloaded = false;
        if (profile.type === `server`) {
          progress.report({ message: l10n.t("Checking the server profile state...") });
        }
        const canProceed = await verifyLatestServerProfileState(profile);
        const saved = canProceed && await saveConnectionProfile(profile, {}, {
          progress,
          onReload: async () => {
            await reloadFromServer(profileEditor, profile);
            reloaded = true;
          }
        });

        // Throwing keeps the editor open and dirty, so it can be saved again
        if (reloaded) {
          throw new Error(l10n.t("Profile {0} was reloaded from the server: review it and save it again.", profile.name));
        }
        else if (!saved) {
          throw new Error(l10n.t("Profile {0} was not saved.", profile.name));
        }
      }
      finally {
        await connection.setCurrentASP(currentASP);
      }
    }
  }
}