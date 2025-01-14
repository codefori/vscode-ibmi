import { ConnectionConfiguration } from "../Configuration";
import IBMi from "../IBMi";
import { ConfigFile } from "./configFile";

type FullConnectionProfile = ConnectionConfiguration.ConnectionProfile;

export interface ProfilesConfigFile {
  profiles: FullConnectionProfile[]
}

export function getProfilesConfig(connection: IBMi) {
  const ProfilesConfig = new ConfigFile<ProfilesConfigFile>(connection, `profiles`, {profiles: []});

  ProfilesConfig.hasServerFile = true;

  ProfilesConfig.validateAndCleanInPlace = (loadedConfig: ProfilesConfigFile) => {
    if (loadedConfig.profiles) {
      const profilesJson = loadedConfig.profiles;
      // Maybe one day replace this with real schema validation
      if (Array.isArray(profilesJson)) {
        for (let i = 0; i < profilesJson.length; i++) {
          let profile = profilesJson[i];
          if (!profile.name) {
            throw new Error(`Profile name is required.`);
          }
        
          if (profile.homeDirectory && typeof profile.homeDirectory !== `string`) {
            throw new Error(`Home directory must a string.`);
          }
        
          if (profile.currentLibrary && typeof profile.currentLibrary !== `string`) {
            throw new Error(`Current library must a string.`);
          }
        
          if (profile.libraryList && !Array.isArray(profile.libraryList)) {
            throw new Error(`Library list must be an array of strings.`);
          }
        
          if (profile.ifsShortcuts && !Array.isArray(profile.ifsShortcuts)) {
            throw new Error(`IFS shortcuts must be an array of strings.`);
          }
        
          if (profile.objectFilters && !Array.isArray(profile.objectFilters)) {
            throw new Error(`Object filters must be an array of objects.`);
          }
        
          if (profile.customVariables && !Array.isArray(profile.customVariables)) {
            throw new Error(`Custom variables must be an array of objects.`);
          }
        
          profilesJson[i] = {
            name: profile.name,
            homeDirectory: profile.homeDirectory || `.`,
            currentLibrary: profile.currentLibrary || ``,
            libraryList: profile.libraryList || [],
            objectFilters: profile.objectFilters || [],
            ifsShortcuts: profile.ifsShortcuts || [],
            customVariables: profile.customVariables || []
          }
        }
      }
    } else {
      throw new Error(`Profiles file must contain a profiles array.`);
    }
  
    return loadedConfig;
  }

  return ProfilesConfig;
}
