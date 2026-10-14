import crypto from "crypto";
import { l10n } from "vscode";
import { instance } from "../instantiate";
import IBMi from "./IBMi";
import { AnyConnectionProfile, LocalConnectionProfile, ServerConnectionProfile, ConnectionConfig, ConnectionProfile, ProfileType } from "./configuration/config/types";

/**
 * Thrown when a server profile was changed (or deleted, or created) by someone else since it was last loaded
 */
export class ProfileConflictError extends Error {
  constructor(readonly profileName: string) {
    super(l10n.t("Server profile {0} has been changed on the server since it was last loaded.", profileName));
  }
}

export async function updateConnectionProfile(profile: AnyConnectionProfile, options?: { newName?: string, delete?: boolean, modifiedConfig?: ConnectionConfig, force?: boolean }) {
  const connection = instance.getConnection();
  if (connection) {
    const config = options?.modifiedConfig || connection.getConfig();
    const currentName = profile.name;
    const newName = options?.newName || currentName;
    const isActive = isActiveProfile(profile);

    if (profile.type === 'server') {
      // Map internal server profile type to connection profile
      const { type, state, loadedHash, homeDirectory, ...serverProfile } = profile;
      serverProfile.name = newName;

      // Only this profile is changed, on top of the latest content of the file: changes made by others to other profiles are kept
      const profilesConfigFile = connection.getConfigFile<ConnectionProfile[]>(`profiles`);
      await profilesConfigFile.update(serverProfiles => {
        const index = serverProfiles.findIndex(p => p.name === currentName);
        const currentHash = index < 0 ? undefined : hashProfile(serverProfiles[index]);
        if (!options?.force && currentHash !== profile.loadedHash) {
          throw new ProfileConflictError(currentName);
        }

        if (options?.delete) {
          if (index >= 0) {
            serverProfiles.splice(index, 1);
          }
        } else {
          if (newName !== currentName && serverProfiles.some(p => p.name === newName)) {
            throw new Error(l10n.t("Profile {0} already exists", newName));
          }
          serverProfiles[index < 0 ? serverProfiles.length : index] = serverProfile;
        }

        return serverProfiles;
      });

      // The profile object may be saved again (e.g. from the same editor): it now matches what is on the server
      profile.loadedHash = options?.delete ? undefined : hashProfile(serverProfile);
      profile.state = `In Sync`;
    } else {
      const profiles = config.connectionProfiles;
      const index = profiles.findIndex(p => p.name === currentName);
      if (options?.delete) {
        if (index < 0) {
          throw new Error(l10n.t("Profile {0} not found for deletion.", currentName));
        }
        profiles.splice(index, 1);
      } else {
        // Map internal local profile type to connection profile
        const { type, ...localProfile } = profile;
        localProfile.name = newName;
        profiles[index < 0 ? profiles.length : index] = localProfile;
      }
    }

    profile.name = newName;

    if (isActive) {
      //Only update the setLibraryListCommand and statusBarColor in the current config since the editor is the only place they can be changed
      config.setLibraryListCommand = profile.setLibraryListCommand;
      config.statusBarColor = profile.statusBarColor || ``;
      config.currentProfile = profile.name;

      if (profile.type === 'server') {
        config.currentProfileLastKnownHash = profile.loadedHash;
      }
    }

    await IBMi.connectionManager.update(config);
  }
}

/**
 * @returns an arry of local (stored in the config) and system (stored in /etc/vscode/profiles.json) {@link ConnectionProfile};
 * except the default profile (with a blank name), only used internally
 */
export async function getAllConnectionProfiles() {
  const { localProfiles, serverProfiles } = await getConnectionProfilesInGroups();
  return [...localProfiles, ...serverProfiles];
}

export async function getConnectionProfilesInGroups() {
  const connection = instance.getConnection();
  if (connection) {
    const config = connection.getConfig();
    const rawLocalProfiles: ConnectionProfile[] = config.connectionProfiles;

    // Map connection profiles to internal local profile type
    const localProfiles: LocalConnectionProfile[] = rawLocalProfiles.map(rawlocalProfile => ({
      ...rawlocalProfile,
      type: 'local' as const
    }));

    // Get server profiles
    const profilesConfigFile = connection.getConfigFile<ConnectionProfile[]>(`profiles`);
    const rawServerProfiles: ConnectionProfile[] = await profilesConfigFile.get();

    // Get current profile
    const currentProfileName = config.currentProfile;
    const currentProfileType = config.currentProfileType;

    // Map connection profiles to internal server profile type
    const serverProfiles: ServerConnectionProfile[] = rawServerProfiles.map(rawServerProfile => {
      const loadedHash = hashProfile(rawServerProfile);

      let state: ServerConnectionProfile['state'] = 'In Sync';
      if (currentProfileType === 'server' && currentProfileName === rawServerProfile.name) {
        // Current server profile: compare the local version against the server version, then the server version against the one last activated or saved
        if (hashProfile(config) !== loadedHash) {
          state = loadedHash === config.currentProfileLastKnownHash ? 'Modified' : 'Out of Sync';
        }
      }

      return {
        ...rawServerProfile,
        type: 'server' as const,
        state,
        loadedHash
      };
    });

    // Check if current profile is a server profile that no longer exists in the remote file
    if (currentProfileName && currentProfileType === 'server') {
      const profileExistsOnServer = serverProfiles.some(p => p.name === currentProfileName);
      if (!profileExistsOnServer) {
        // Add the missing profile with out of sync state
        const localVersionOfServerProfile: ServerConnectionProfile = {
          name: currentProfileName,
          type: 'server' as const,
          currentLibrary: config.currentLibrary,
          libraryList: config.libraryList,
          objectFilters: config.objectFilters,
          ifsShortcuts: config.ifsShortcuts,
          customVariables: config.customVariables,
          setLibraryListCommand: config.setLibraryListCommand,
          iasp: config.iasp,
          statusBarColor: config.statusBarColor,
          state: 'Out of Sync'
        };

        serverProfiles.push(localVersionOfServerProfile);
      }
    }

    return {
      localProfiles,
      serverProfiles
    };
  } else {
    throw new Error(l10n.t("Not connected to an IBM i"));
  }
}

/**
 * @returns a hash of the content a server profile shares, which only changes when that content does
 * (key order, blank optional values and the profile name are ignored)
 */
export function hashProfile(profile: ConnectionProfile) {
  const sharedContent = {
    currentLibrary: profile.currentLibrary || undefined,
    libraryList: profile.libraryList || [],
    objectFilters: profile.objectFilters || [],
    ifsShortcuts: profile.ifsShortcuts || [],
    customVariables: profile.customVariables || [],
    setLibraryListCommand: profile.setLibraryListCommand || undefined,
    iasp: profile.iasp || undefined,
    statusBarColor: profile.statusBarColor || undefined
  };

  return crypto.createHash(`sha256`).update(stableStringify(sharedContent)).digest(`hex`);
}

function stableStringify(value: any): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(`,`)}]`;
  }
  else if (value && typeof value === `object`) {
    return `{${Object.keys(value).filter(key => value[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(`,`)}}`;
  }
  else {
    return JSON.stringify(value) ?? `null`;
  }
}

export async function getConnectionProfile(profileName: string, type: ProfileType) {
  const { localProfiles, serverProfiles } = await getConnectionProfilesInGroups();
  if (type === 'local') {
    return localProfiles.find(p => p.name === profileName);
  } else {
    return serverProfiles.find(p => p.name === profileName);
  }
}

export function getDefaultProfile(config: ConnectionConfig): LocalConnectionProfile {
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

  return {
    ...defaultProfile,
    type: 'local'
  };
}

export function assignProfile(fromProfile: ConnectionProfile, toProfile: ConnectionProfile) {
  if (fromProfile.homeDirectory) {
    // Home directory will be undefined when assigning from a server profile
    toProfile.homeDirectory = fromProfile.homeDirectory;
  }

  toProfile.currentLibrary = fromProfile.currentLibrary;
  toProfile.iasp = fromProfile.iasp;
  toProfile.libraryList = fromProfile.libraryList;
  toProfile.objectFilters = fromProfile.objectFilters;
  toProfile.ifsShortcuts = fromProfile.ifsShortcuts;
  toProfile.customVariables = fromProfile.customVariables;
  toProfile.setLibraryListCommand = fromProfile.setLibraryListCommand;
  toProfile.statusBarColor = fromProfile.statusBarColor ?? toProfile.statusBarColor;
  return toProfile;
}

export function cloneProfile(fromProfile: ConnectionProfile, newName: string): ConnectionProfile {
  return assignProfile(fromProfile, { name: newName } as ConnectionProfile);
}

export function isActiveProfile(profile: AnyConnectionProfile) {
  const connection = instance.getConnection();
  const config = connection?.getConfig();
  return config?.currentProfile === profile.name && config?.currentProfileType === profile.type;
}