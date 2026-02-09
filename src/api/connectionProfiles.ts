import { l10n } from "vscode";
import { instance } from "../instantiate";
import IBMi from "./IBMi";
import { AnyConnectionProfile, LocalConnectionProfile, ServerConnectionProfile, ConnectionConfig, ConnectionProfile, ProfileType } from "./configuration/config/types";

export async function updateConnectionProfile(profile: AnyConnectionProfile, options?: { newName?: string, delete?: boolean, modifiedConfig?: ConnectionConfig, }) {
  const connection = instance.getConnection();
  if (connection) {
    const config = options?.modifiedConfig || connection.getConfig();
    const isServerProfile = profile.type === 'server';

    const { localProfiles, serverProfiles } = await getConnectionProfilesInGroups();
    const profiles = isServerProfile ? serverProfiles : localProfiles;

    let now: number | undefined;
    let oldName: string | undefined
    const index = profiles.findIndex(p => p.name === profile.name);
    if (options?.delete) {
      if (index < 0) {
        throw new Error(l10n.t("Profile {0} not found for deletion.", profile.name));
      }
      profiles.splice(index, 1);
    } else {
      if (options?.newName) {
        oldName = profile.name;
        profile.name = options?.newName
      } else {
        profile.name = profile.name;
      }
      if (isServerProfile) {
        now = Date.now();
        profile.lastUpdated = now;
      }
      profiles[index < 0 ? profiles.length : index] = profile;
    }

    if (isActiveProfile(profile, oldName)) {
      // Only update the setLibraryListCommand in the current config since the editor is the only place it can be changed
      config.setLibraryListCommand = profile.setLibraryListCommand;

      if (options?.newName) {
        config.currentProfile = profile.name;
      }

      if (now) {
        config.currentProfileLastKnownUpdate = now;
      }
    }

    if (isServerProfile) {
      // Map internal server profile type to connection profile
      const serverProfiles: ConnectionProfile[] = (profiles as ServerConnectionProfile[]).map(({ type, state, homeDirectory, ...profile }) => profile);

      const profilesConfigFile = connection.getConfigFile<ConnectionProfile[]>(`profiles`);
      await profilesConfigFile.writeToServer(serverProfiles);
      await IBMi.connectionManager.update(config);
    } else {
      // Map internal local profile type to connection profile
      const localProfiles: ConnectionProfile[] = (profiles as LocalConnectionProfile[]).map(({ type, ...profile }) => profile);

      config.connectionProfiles = localProfiles;
      await IBMi.connectionManager.update(config);
    }
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
    const rawLocalProfiles: ConnectionProfile[] = config.connectionProfiles.filter(profile => Boolean(profile.name));

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
      const profileLastUpdated = rawServerProfile.lastUpdated || 0;

      let state: ServerConnectionProfile['state'];
      if (currentProfileType === 'server' && currentProfileName === rawServerProfile.name) {
        // Current server profile, so compare the local version against the server version
        const localVersionOfServerProfile: ConnectionProfile = {
          name: currentProfileName,
          currentLibrary: config.currentLibrary,
          libraryList: config.libraryList,
          objectFilters: config.objectFilters,
          ifsShortcuts: config.ifsShortcuts,
          customVariables: config.customVariables,
          setLibraryListCommand: config.setLibraryListCommand
        };
        const isInSync = isProfileInSync(rawServerProfile, localVersionOfServerProfile);
        const lastKnownUpdate = config.currentProfileLastKnownUpdate || 0;
        const isOutdated = profileLastUpdated > lastKnownUpdate;

        if (isOutdated && !isInSync) {
          state = 'Conflict';
        } else if (isOutdated && isInSync) {
          state = 'Outdated';
        } else if (!isOutdated && !isInSync) {
          state = 'Modified';
        } else {
          state = 'In-sync';
        }
      } else {
        // Not current server profile, so it's in sync
        state = 'In-sync';
      }

      return {
        ...rawServerProfile,
        type: 'server' as const,
        state,
        lastUpdated: profileLastUpdated
      };
    });

    // Check if current profile is a server profile that no longer exists in the remote file
    if (currentProfileName && currentProfileType === 'server') {
      const profileExistsOnServer = serverProfiles.some(p => p.name === currentProfileName);
      if (!profileExistsOnServer) {
        // Add the missing profile with Conflict state
        const localVersionOfServerProfile: ServerConnectionProfile = {
          name: currentProfileName,
          type: 'server' as const,
          currentLibrary: config.currentLibrary,
          libraryList: config.libraryList,
          objectFilters: config.objectFilters,
          ifsShortcuts: config.ifsShortcuts,
          customVariables: config.customVariables,
          setLibraryListCommand: config.setLibraryListCommand,
          state: 'Conflict',
          lastUpdated: 0
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

export function isProfileInSync(profile1: ConnectionProfile, profile2: ConnectionProfile): boolean {
  return (
    profile1.currentLibrary === profile2.currentLibrary &&
    JSON.stringify(profile1.libraryList) === JSON.stringify(profile2.libraryList) &&
    JSON.stringify(profile1.objectFilters) === JSON.stringify(profile2.objectFilters) &&
    JSON.stringify(profile1.ifsShortcuts) === JSON.stringify(profile2.ifsShortcuts) &&
    JSON.stringify(profile1.customVariables) === JSON.stringify(profile2.customVariables) &&
    profile1.setLibraryListCommand === profile2.setLibraryListCommand
  );
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

export function isActiveProfile(profile: AnyConnectionProfile, oldName?: string) {
  const connection = instance.getConnection();
  const config = connection?.getConfig();
  return config?.currentProfile === (oldName || profile.name) && config?.currentProfileType === profile.type;
}