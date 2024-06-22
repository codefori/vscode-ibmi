import * as path from "path";
import { workspace, WorkspaceFolder } from "vscode";

import { str } from "crc-32/crc32c";

export type Env = Record<string, string>;

async function envExists(currentWorkspace: WorkspaceFolder) {
  const folderUri = currentWorkspace.uri;
  const envUri = folderUri.with({ path: path.join(folderUri.fsPath, `.env`) });

  try {
    await workspace.fs.stat(envUri);
    return true;
  } catch (err) {
    return false;
  }
}

export async function getEnvConfig(currentWorkspace: WorkspaceFolder) {
  const env: Env = {};

  if (await envExists(currentWorkspace)) {
    const folderUri = currentWorkspace.uri;
    let readData, readStr;

    // Then we get the local .env file
    const envUri = folderUri.with({ path: path.join(folderUri.fsPath, `.env`) });
    readData = await workspace.fs.readFile(envUri);
    readStr = Buffer.from(readData).toString(`utf8`);

    const envLines = readStr.replace(new RegExp(`\\\r`, `g`), ``).split(`\n`);

    // Parse out the env lines
    envLines.forEach(line => {
      if (!line.startsWith(`#`)) {
        const [key, value] = line.split(`=`);
        if (key.length > 0 && value.length > 0) {
          env[key.trim()] = value.trim();
        }
      }
    });
  }

  return env;
}

export function getBranchLibraryName(currentBranch: string) {
  return `VS${(str(currentBranch, 0) >>> 0).toString(16).toUpperCase()}`;
}