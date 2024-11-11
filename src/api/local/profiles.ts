
import { workspace, window } from "vscode";
import { ConnectionConfiguration } from "../../api/Configuration";
import IBMi from "../IBMi";

type PartialConnectionProfile = Partial<ConnectionConfiguration.ConnectionProfile>;
type FullConnectionProfile = ConnectionConfiguration.ConnectionProfile;

const PROFILES_PATH = `/.vscode/profiles.json`;

let serverProfiles: FullConnectionProfile[]|undefined;

interface ProfilesFile {
  profiles: PartialConnectionProfile[]
}

export async function getProfiles(connection: IBMi) {
  const profiles: ConnectionConfiguration.ConnectionProfile[] = [];

  if (workspace.workspaceFolders) {
    const actionsFiles = await workspace.findFiles(`**${PROFILES_PATH}`);

    for (const file of actionsFiles) {
      const content = await workspace.fs.readFile(file);
      try {
        profiles.push(...parseJsonIntoProfilesFile(content.toString()));
      } catch (e: any) {
        // ignore
        window.showErrorMessage(`Error parsing ${file.fsPath}: ${e.message}\n`);
      }
    };
  }

  if (serverProfiles === undefined) {
    serverProfiles = [];
    const isAvailable = await connection.content.testStreamFile(PROFILES_PATH, `r`);
    if (isAvailable) {
      const content = await connection.content.downloadStreamfileRaw(PROFILES_PATH);
      try {
        serverProfiles = parseJsonIntoProfilesFile(content.toString());
      } catch (e: any) {
        // ignore
        window.showErrorMessage(`Error parsing server file ${PROFILES_PATH}: ${e.message}\n`);
      }
    }
  } else if (Array.isArray(serverProfiles)) {
    profiles.push(...serverProfiles);
  }

  return profiles;
}

export function resetServerProfiles() {
  serverProfiles = undefined;
}

function parseJsonIntoProfilesFile(json: string) {
  const profiles: ConnectionConfiguration.ConnectionProfile[] = [];
  const theJson: ProfilesFile = JSON.parse(json.toString());

  if (theJson.profiles) {
    const profilesJson = theJson.profiles;
    // Maybe one day replace this with real schema validation
    if (Array.isArray(profilesJson)) {
      profilesJson.forEach((profile, index) => {
        const validProfile = validateLocalProfile(profile);
        profiles.push(validProfile);
      })
    }
  }

  return profiles;
}

function validateLocalProfile(input: PartialConnectionProfile): FullConnectionProfile {
  if (!input.name) {
    throw new Error(`Profile name is required.`);
  }

  if (input.homeDirectory && typeof input.homeDirectory !== `string`) {
    throw new Error(`Home directory must a string.`);
  }

  if (input.currentLibrary && typeof input.currentLibrary !== `string`) {
    throw new Error(`Current library must a string.`);
  }

  if (input.libraryList && !Array.isArray(input.libraryList)) {
    throw new Error(`Library list must be an array of strings.`);
  }

  if (input.ifsShortcuts && !Array.isArray(input.ifsShortcuts)) {
    throw new Error(`IFS shortcuts must be an array of strings.`);
  }

  if (input.objectFilters && !Array.isArray(input.objectFilters)) {
    throw new Error(`Object filters must be an array of objects.`);
  }

  if (input.customVariables && !Array.isArray(input.customVariables)) {
    throw new Error(`Custom variables must be an array of objects.`);
  }

  return {
    name: input.name,
    homeDirectory: input.homeDirectory || `.`,
    currentLibrary: input.currentLibrary || ``,
    libraryList: input.libraryList || [],
    objectFilters: input.objectFilters || [],
    ifsShortcuts: input.ifsShortcuts || [],
    customVariables: input.customVariables || []
  }
}