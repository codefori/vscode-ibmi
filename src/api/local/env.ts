import { workspace, WorkspaceFolder } from "vscode";
import * as path from "path";

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
  let env: {[key: string]: string} = {};

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

  // @ts-ignore
  return env;
}

export function getBranchLibraryName(currentBranch: string) {
  const parts = branchSplit(currentBranch);
  if (parts.length > 1) {
    // We make A LOT of assumptions here about a valid branch name
    const branchType = parts[0].length > 3 ? parts[0].substring(0, 3) : parts[0];
    const possibleId = parts.find(p => p.length <= 7 && !isNaN(parseInt(p)));
    const backupId = parts[1].length > 7 ? parts[1].substring(0, 7) : parts[1];

    const actualId = possibleId || backupId;

    return (branchType + actualId).trim().toUpperCase();

  } else if (currentBranch.length > 10) {
    return currentBranch.substring(0, 10).toUpperCase();

  } else {
    return currentBranch.toUpperCase();
  }
}

function branchSplit(value: string) {
  let parts: string[] = [];
  let c = ``;

  for (const v of value) {
    if (v === `/` || v === `-` || v === ` `) {
      parts.push(c);
      c = ``;
    } else {
      c += v;
    }
  }

  parts.push(c);

  return parts;
}