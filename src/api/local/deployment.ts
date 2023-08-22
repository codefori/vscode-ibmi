
import path from 'path';
import tar from 'tar';
import tmp from 'tmp';
import vscode from 'vscode';
import { instance } from '../../instantiate';
import { DeploymentParameters } from '../../typings';
import IBMi from '../IBMi';
import { Tools } from '../Tools';
import { getLocalActions } from './actions';
import { DeployTools } from './deployTools';

export namespace Deployment {
  export interface MD5Entry {
    path: string
    md5: string
  }

  export const BUTTON_BASE = `$(cloud-upload) Deploy`;
  export const BUTTON_WORKING = `$(sync~spin) Deploying`;

  export const deploymentLog = vscode.window.createOutputChannel(`IBM i Deployment`);
  export const button = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
  export const workspaceChanges: Map<vscode.WorkspaceFolder, Map<string, vscode.Uri>> = new Map;

  export function initialize(context: vscode.ExtensionContext) {
    button.command = {
      command: `code-for-ibmi.launchDeploy`,
      title: `Launch Deploy`
    }
    button.text = BUTTON_BASE;

    context.subscriptions.push(
      button,
      deploymentLog,
      vscode.commands.registerCommand(`code-for-ibmi.launchActionsSetup`, DeployTools.launchActionsSetup),
      vscode.commands.registerCommand(`code-for-ibmi.launchDeploy`, DeployTools.launchDeploy),
      vscode.commands.registerCommand(`code-for-ibmi.setDeployLocation`, DeployTools.setDeployLocation)
    );

    const workspaces = vscode.workspace.workspaceFolders;
    if (workspaces && workspaces.length > 0) {
      buildWatcher().then(bw => context.subscriptions.push(bw));
    }

    instance.onEvent("connected", () => {
      const workspaces = vscode.workspace.workspaceFolders;
      const connection = instance.getConnection();
      const config = instance.getConfig();
      const storage = instance.getStorage();

      if (workspaces && connection && storage && config) {
        if (workspaces.length > 0) {
          buildWatcher().then(bw => context.subscriptions.push(bw));
          button.show();
        }

        const existingPaths = storage.getDeployment();

        if (workspaces.length === 1) {
          const workspace = workspaces[0];

          if (existingPaths && !existingPaths[workspace.uri.fsPath]) {
            const possibleDeployDir = DeployTools.buildPossibleDeploymentDirectory(workspace);
            vscode.window.showInformationMessage(
              `Deploy directory for Workspace not setup. Would you like to default to '${possibleDeployDir}'?`,
              `Yes`,
              `Ignore`
            ).then(async result => {
              if (result === `Yes`) {
                DeployTools.setDeployLocation({ path: possibleDeployDir }, workspace);
              }
            });
          }

          getLocalActions(workspace).then(result => {
            if (result.length === 0) {
              vscode.window.showInformationMessage(
                `There are no local Actions defined for this project.`,
                `Run Setup`
              ).then(result => {
                if (result === `Run Setup`)
                  vscode.commands.executeCommand(`code-for-ibmi.launchActionsSetup`);
              });
            }
          })
        }
      }
    });

    instance.onEvent("disconnected", () => {
      button.hide();
    })
  }

  export function getConnection(): IBMi {
    const connection = instance.getConnection();
    if (!connection) {
      throw new Error("Please connect to an IBM i");
    }
    return connection;
  }

  export async function createRemoteDirectory(remotePath: string) {
    return await getConnection().sendCommand({
      command: `mkdir -p "${remotePath}"`
    });
  }

  async function buildWatcher() {
    const invalidFs = [`member`, `streamfile`];
    const watcher = vscode.workspace.createFileSystemWatcher(`**`);

    const getChangesMap = (uri: vscode.Uri) => {
      if (!invalidFs.includes(uri.scheme) && !uri.fsPath.includes(`.git`)) {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
        if (workspaceFolder) {
          let changes = workspaceChanges.get(workspaceFolder);
          if (!changes) {
            changes = new Map;
            workspaceChanges.set(workspaceFolder, changes);
          }
          return changes;
        }
      }
    }

    watcher.onDidChange(uri => {
      getChangesMap(uri)?.set(uri.fsPath, uri);
    });
    watcher.onDidCreate(async uri => {
      const fileStat = await vscode.workspace.fs.stat(uri);
      if (fileStat.type === vscode.FileType.File) {
        getChangesMap(uri)?.set(uri.fsPath, uri);
      }
    });
    watcher.onDidDelete(uri => {
      getChangesMap(uri)?.delete(uri.fsPath);
    });

    return watcher;
  }

  export async function showErrorButton() {
    if (await vscode.window.showErrorMessage(`Deployment failed.`, `View Log`)) {
      deploymentLog.show();
    }
  }

  export async function getWorkspaceFolder(workspaceIndex?: number) {
    if (workspaceIndex !== undefined) {
      return vscode.workspace.workspaceFolders?.find(dir => dir.index === workspaceIndex);
    } else {
      const workspaces = vscode.workspace.workspaceFolders;
      if (workspaces && workspaces.length > 0) {
        if (workspaces.length === 1) {
          return workspaces[0];
        } else {
          const chosen = await vscode.window.showQuickPick(workspaces.map(dir => dir.name), {
            placeHolder: `Select workspace to deploy`
          });

          if (chosen) {
            return workspaces.find(dir => dir.name === chosen);
          }
        }
      }
    }
  }

  export function toMD5Entry(line: string): MD5Entry {
    const parts = line.split(/\s+/);
    return {
      md5: parts[0].trim(),
      path: parts[1].trim().substring(2) //these path starts with ./
    };
  }

  export function toRelative(root: vscode.Uri, file: vscode.Uri) {
    return path.relative(root.path, file.path).replace(/\\/g, `/`);
  }

  export async function findFiles(parameters: DeploymentParameters, includePattern: string, excludePattern?: string) {
    const root = parameters.workspaceFolder.uri;
    return (await vscode.workspace.findFiles(new vscode.RelativePattern(parameters.workspaceFolder, includePattern),
      excludePattern ? new vscode.RelativePattern(parameters.workspaceFolder, excludePattern) : null))
      .filter(file => {
        if (parameters.ignoreRules) {
          const relative = toRelative(root, file);
          return !parameters.ignoreRules.ignores(relative);
        }
        else {
          return true;
        }
      });
  }

  export async function sendCompressed(parameters: DeploymentParameters, files: vscode.Uri[], progress: vscode.Progress<{ message?: string }>) {
    const connection = getConnection();
    const localTarball = tmp.fileSync({ postfix: ".tar" });
    const remoteTarball = path.posix.join(getConnection().config?.tempDir || '/tmp', `deploy_${Tools.makeid()}.tar`);
    try {
      const toSend = files.map(file => path.relative(parameters.workspaceFolder.uri.fsPath, file.fsPath));

      progress?.report({ message: `creating deployment tarball for ${toSend.length} file(s)...` });
      tar.create({ cwd: parameters.workspaceFolder.uri.fsPath, sync: true, file: localTarball.name }, toSend);
      deploymentLog.appendLine(`Created deployment tarball ${localTarball.name}`);

      progress?.report({ message: `sending deployment tarball...` });
      await connection.client.putFile(localTarball.name, remoteTarball);
      deploymentLog.appendLine(`Uploaded deployment tarball as ${remoteTarball}`);

      progress?.report({ message: `extracting deployment tarball to ${parameters.remotePath}...` });
      //Extract and remove tar's PaxHeader metadata folder
      const result = await connection.sendCommand({ command: `${connection.remoteFeatures.tar} -xof ${remoteTarball} && rm -rf PaxHeader`, directory: parameters.remotePath });
      if (result.code !== 0) {
        throw new Error(`Tarball extraction failed: ${result.stderr}`)
      }

      const entries: string[] = [];
      tar.t({ sync: true, file: localTarball.name, onentry: entry => entries.push(entry.path) });
      deploymentLog.appendLine(`${entries.length} file(s) uploaded to ${parameters.remotePath}`);
      entries.sort().map(e => `\t${e}`).forEach(deploymentLog.appendLine);
    }
    finally {
      deploymentLog.appendLine('');
      await connection.sendCommand({ command: `rm ${remoteTarball}` })
      deploymentLog.appendLine(`${remoteTarball} deleted`);

      localTarball.removeCallback();
      deploymentLog.appendLine(`${localTarball.name} deleted`);
    }
  }
}