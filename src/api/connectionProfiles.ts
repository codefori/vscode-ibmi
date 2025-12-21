import { l10n } from "vscode";
import { instance } from "../instantiate";
import IBMi from "./IBMi";
import { ConnectionProfile } from "./types";

export async function updateConnectionProfile(profile: ConnectionProfile, options?: { newName?: string, delete?: boolean }) {
  const config = instance.getConnection()?.getConfig();
  if (config) {
    const profiles = config.connectionProfiles;
    const index = profiles.findIndex(p => p.name === profile.name);

    if (options?.delete) {
      if (index < 0) {
        throw new Error(l10n.t("Profile {0} not found for deletion.", profile.name));
      }
      profiles.splice(index, 1);
    }
    else {
      profile.name = options?.newName || profile.name;
      profiles[index < 0 ? profiles.length : index] = profile;
    }

    if (isActiveProfile(profile)) {
      //Only update the setLibraryListCommand in the current config since the editor is the only place it can be changed
      config.setLibraryListCommand = profile.setLibraryListCommand;
    }

    await IBMi.connectionManager.update(config);
  }
}

/**
 * @returns ann arry of {@link ConnectionProfile} stored in the config; except the default profile (with a blank name), only used internally
 */
export function getConnectionProfiles() {
  const config = instance.getConnection()?.getConfig();
  if (config) {
    return config.connectionProfiles.filter(profile => Boolean(profile.name));
  }
  else {
    throw new Error(l10n.t("Not connected to an IBM i"));
  }
}

export function getConnectionProfile(profileName: string) {
  return getConnectionProfiles().filter(p => p.name === profileName).at(0);
}

export function getDefaultProfile() {
  const config = instance.getConnection()?.getConfig();
  if (config) {
    let defaultProfile = config.connectionProfiles.filter(profile => !profile.name).at(0);
    if (!defaultProfile) {
      defaultProfile = {
        name: '',
        homeDirectory: '',
        ifsShortcuts: [],
        currentLibrary: '',
        objectFilters: [],
        customVariables: [],
        libraryList: []
      };

      config.connectionProfiles.push(defaultProfile);
    }

    return defaultProfile;
  }
  else {
    throw new Error(l10n.t("Not connected to an IBM i"));
  }
}

export function assignProfile(fromProfile: ConnectionProfile, toProfile: ConnectionProfile) {
  toProfile.homeDirectory = fromProfile.homeDirectory;
  toProfile.currentLibrary = fromProfile.currentLibrary;
  toProfile.libraryList = fromProfile.libraryList;
  toProfile.objectFilters = fromProfile.objectFilters;
  toProfile.ifsShortcuts = fromProfile.ifsShortcuts;
  toProfile.customVariables = fromProfile.customVariables;
  toProfile.setLibraryListCommand = fromProfile.setLibraryListCommand;
  return toProfile;
}

export function cloneProfile(fromProfile: ConnectionProfile, newName: string): ConnectionProfile {
  return assignProfile(fromProfile, { name: newName } as ConnectionProfile);
}

export function isActiveProfile(profile: ConnectionProfile) {
  return instance.getConnection()?.getConfig().currentProfile === profile.name;
}