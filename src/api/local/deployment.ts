
import path, { basename } from 'path';
import vscode from 'vscode';

import IBMi from '../IBMi';
import { getLocalActions } from './actions';

import { ConnectionConfiguration } from '../Configuration';
import { LocalLanguageActions } from '../../schemas/LocalLanguageActions';
import { GitExtension } from '../import/git';
import { instance } from '../../instantiate';
import Instance from '../Instance';
import { Ignore } from 'ignore'
import ignore from 'ignore'
import { NodeSSH } from 'node-ssh';

export namespace Deployment {
  interface Upload {
    local: string
    remote: string
    uri: vscode.Uri
  }

  interface DeploymentParameters {
    method: Method
    localFolder: vscode.Uri
    remotePath: string
    ignoreRules?: Ignore    
  }

  const BUTTON_BASE = `$(cloud-upload) Deploy`;
  const BUTTON_WORKING = `$(sync~spin) Deploying`;

  const deploymentLog = vscode.window.createOutputChannel(`IBM i Deployment`);
  const button = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
  const changes: Map<string, vscode.Uri> = new Map;

  export enum Method {
    "all",
    "staged",
    "unstaged",
    "changed"
  }

  export function initialize(context: vscode.ExtensionContext, instance: Instance) {
    button.command = {
      command: `code-for-ibmi.launchDeploy`,
      title: `Launch Deploy`
    }
    button.text = BUTTON_BASE;

    context.subscriptions.push(
      button,
      deploymentLog,
      vscode.commands.registerCommand(`code-for-ibmi.launchActionsSetup`, launchActionsSetup),
      vscode.commands.registerCommand(`code-for-ibmi.launchDeploy`, launchDeploy),
      vscode.commands.registerCommand(`code-for-ibmi.setDeployLocation`, setDeployLocation)
    );

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
          const possibleDeployDir = path.posix.join(`/`, `home`, connection.currentUser, `builds`, workspace.name);
          vscode.window.showInformationMessage(
            `Deploy directory for Workspace not setup. Would you like to default to '${possibleDeployDir}'?`,
            `Yes`,
            `Ignore`
          ).then(async result => {
            if (result === `Yes`) {
              await connection.sendCommand({
                command: `mkdir -p "${possibleDeployDir}"`
              });

              existingPaths[workspace.uri.fsPath] = possibleDeployDir;
              try {
                await storage.setDeployment(existingPaths);
              } catch (e) {
                console.log(e);
              }
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

        vscode.window.showInformationMessage(
          `Current library is set to ${config.currentLibrary}.`,
          `Change`
        ).then(result => {
          if (result === `Change`)
            vscode.commands.executeCommand(`code-for-ibmi.changeCurrentLibrary`);
        });
      }
    }
  }

  async function launchActionsSetup() {
    const chosenWorkspace = await module.exports.getWorkspaceFolder();

    if (chosenWorkspace) {
      const types = Object.entries(LocalLanguageActions).map(([type, actions]) => ({ label: type, actions }));

      const chosenTypes = await vscode.window.showQuickPick(types, {
        canPickMany: true,
        title: `Select available pre-defined actions`
      });

      if (chosenTypes) {
        const newActions = chosenTypes.flatMap(type => type.actions);
        const localActionsUri = vscode.Uri.file(path.join(chosenWorkspace.uri.fsPath, `.vscode`, `actions.json`));
        try {
          await vscode.workspace.fs.writeFile(
            localActionsUri,
            Buffer.from(JSON.stringify(newActions, null, 2), `utf-8`)
          );

          vscode.workspace.openTextDocument(localActionsUri).then(doc => vscode.window.showTextDocument(doc));
        } catch (e) {
          console.log(e);
          vscode.window.showErrorMessage(`Unable to create actions.json file.`);
        }
      }
    }
  }

  /**
   * Deploy a workspace to a remote IFS location.
   * @param workspaceIndex if no index is provided, a prompt will be shown to pick one if there are multiple workspaces,
   * otherwise the current workspace will be used.
   * @returns the index of the deployed workspace or `undefined` if the deployment failed
   */
  export async function launchDeploy(workspaceIndex?: number): Promise<number | undefined> {
    const folder = await getWorkspaceFolder(workspaceIndex);
    if (folder) {
      const storage = instance.getStorage();

      const existingPaths = storage?.getDeployment();
      const remotePath = existingPaths ? existingPaths[folder.uri.fsPath] : '';

      // get the .gitignore file from workspace
      const gitignores = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, `**/.gitignore`), ``, 1);
      const ignoreRules = ignore({ ignorecase: true }).add(`.git`);
      if (gitignores.length > 0) {
        // get the content from the file
        const gitignoreContent = (await vscode.workspace.fs.readFile(gitignores[0])).toString().replace(new RegExp(`\\\r`, `g`), ``);
        ignoreRules.add(gitignoreContent.split(`\n`));
        ignoreRules.add('**/.gitignore');
      }

      if (remotePath) {
        const method = (await vscode.window.showQuickPick(
          [
            { method: Method.changed, label: `Changes`, description: `${changes.size} change${changes.size > 1 ? `s` : ``} detected since last upload. ${!changes.size ? `Will skip deploy step.` : ``}` },
            { method: Method.unstaged, label: `Working Changes`, description: `Unstaged changes in git` },
            { method: Method.staged, label: `Staged Changes`, description: `` },
            { method: Method.all, label: `All`, description: `Every file in the local workspace` },
          ],
          { placeHolder: `Select deployment method to ${remotePath}` }
        ))?.method;

        if (method !== undefined) { //method can be 0 (ie. "all")
          const config = instance.getConfig();
          if (remotePath.startsWith(`/`) && config && config.homeDirectory !== remotePath) {
            config.homeDirectory = remotePath;
            await ConnectionConfiguration.update(config);
            vscode.window.showInformationMessage(`Home directory set to ${remotePath} for deployment.`);
          }

          const parameters: DeploymentParameters = {
            localFolder: folder.uri,
            remotePath,
            ignoreRules,
            method
          };

          if(await deploy(parameters)){
            return folder.index;
          }
        }
      } else {
        vscode.window.showErrorMessage(`Chosen location (${folder.uri.fsPath}) is not configured for deployment.`);
      }
    } else {
      vscode.window.showErrorMessage(`No location selected for deployment.`);
    }
  }

  export async function deploy(parameters: DeploymentParameters){
    try {
      deploymentLog.clear();
      button.text = BUTTON_WORKING;
      switch (parameters.method) {
        case Method.unstaged:
          await deployGit(parameters, 'working');
          break;

        case Method.staged:
          await deployGit(parameters, 'staged');
          break;

        case Method.changed:
          await deployChanged(parameters);
          break;

        case Method.all:
          await deployAll(parameters);
          break;
      }

      deploymentLog.appendLine(`Deployment finished.`);
      vscode.window.showInformationMessage(`Deployment finished.`);
      changes.clear();
      return true;      
    }
    catch (error) {
      showErrorButton();
      deploymentLog.appendLine(`Deployment failed: ${error}`);
      return false;
    }
    finally {
      button.text = BUTTON_BASE;
    }
  }

  function getClient(): NodeSSH {
    const client = instance.getConnection()?.client;
    if (!client) {
      throw new Error("Please connect to an IBM i");
    }
    return client;
  }

  function getGitAPI() {
    const gitAPI = vscode.extensions.getExtension<GitExtension>(`vscode.git`)?.exports.getAPI(1);
    if (!gitAPI) {
      const error = `Unable to get Git API.`;
      vscode.window.showErrorMessage(error);
      throw new Error(error);
    }
    return gitAPI;
  }

  async function deployChanged(parameters: DeploymentParameters) {
    if (changes.size > 0) {
      const changedFiles = Array.from(changes.values())
        .filter(uri => {
          // We don't want stuff in the gitignore
          const relative = path.relative(parameters.localFolder.path, uri.path).replace(new RegExp(`\\\\`, `g`), `/`);
          if (relative && parameters.ignoreRules) {
            return !parameters.ignoreRules.ignores(relative);
          }

          // Bad way of checking if the file is a directory or not.
          // putFiles below does not support directory creation.
          const basename = path.basename(uri.path);
          return !basename.includes(`.`);
        });

      const uploads: Upload[] = changedFiles
        .map(uri => {
          const relative = path.relative(parameters.localFolder.path, uri.path).replace(new RegExp(`\\\\`, `g`), `/`);
          const remote = path.posix.join(parameters.remotePath, relative);
          deploymentLog.appendLine(`UPLOADING: ${uri.fsPath} -> ${remote}`);
          return {
            local: uri.fsPath,
            remote,
            uri
          };
        });

      await getClient().putFiles(uploads, {
        concurrency: 5
      });
    } else {
      // Skip upload, but still run the Action
    }
  }

  async function deployGit(parameters: DeploymentParameters, changeType: 'staged' | 'working') {
    const useStagedChanges = (changeType == 'staged');
    const gitApi = getGitAPI();

    if (gitApi.repositories.length > 0) {
      const repository = gitApi.repositories.find(r => r.rootUri.fsPath === parameters.localFolder.fsPath);

      if (repository) {
        let gitFiles;
        if (useStagedChanges) {
          gitFiles = repository.state.indexChanges;
        }
        else {
          gitFiles = repository.state.workingTreeChanges;
        }

        // Do not attempt to upload deleted files.
        // https://github.com/microsoft/vscode/blob/main/extensions/git/src/api/git.d.ts#L69
        gitFiles = gitFiles.filter(change => change.status !== 6);

        if (gitFiles.length > 0) {
          const uploads: Upload[] = gitFiles.map(change => {
            const relative = path.relative(parameters.localFolder.path, change.uri.path).replace(new RegExp(`\\\\`, `g`), `/`);
            const remote = path.posix.join(parameters.remotePath, relative);
            deploymentLog.appendLine(`UPLOADING: ${change.uri.fsPath} -> ${remote}`);
            return {
              local: change.uri.fsPath,
              remote,
              uri: change.uri
            };
          });

          vscode.window.showInformationMessage(`Deploying ${changeType} changes (${uploads.length}) to ${parameters.remotePath}`);
          if (parameters.remotePath.startsWith(`/`)) {
            await getClient().putFiles(uploads, {
              concurrency: 5
            });
          } else {
            throw new Error(`Unable to determine where to upload workspace.`)
          }
        } else {
          vscode.window.showWarningMessage(`No ${changeType} changes to deploy.`);
        }
      } else {
        throw new Error(`No repository found for ${parameters.localFolder.fsPath}`);
      }
    } else {
      throw new Error(`No repositories are open.`);
    }
  }

  async function deployAll(parameters: DeploymentParameters) {
    const name = parameters.localFolder.path.split('/').reverse().pop();
    const uploadResult = await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: `Deploying ${name}`,
    }, async (progress) => {
      progress.report({ message: `Deploying ${name}` });
      if (parameters.remotePath.startsWith(`/`)) {
        try {
          await getClient().putDirectory(parameters.localFolder.fsPath, parameters.remotePath, {
            recursive: true,
            concurrency: 5,
            tick: (localPath, remotePath, error) => {
              if(remotePath.startsWith('\\')){
                //On Windows, remotePath path separators are \
                remotePath = remotePath.replace(/\\/g, '/');
              }

              if (error) {
                progress.report({ message: `Failed to deploy ${localPath}` });
                deploymentLog.appendLine(`FAILED: ${localPath} -> ${remotePath}: ${error.message}`);
              } else {
                progress.report({ message: `Deployed ${localPath}` });
                deploymentLog.appendLine(`SUCCESS: ${localPath} -> ${remotePath}`);
              }
            },
            validate: localPath => {
              const relative = path.relative(parameters.localFolder.fsPath, localPath);
              if (relative && parameters.ignoreRules) {
                return !parameters.ignoreRules.ignores(relative);
              }
              else {
                return true;
              }
            }
          });

          progress.report({ message: `Deployment finished.` });
        } catch (e) {
          progress.report({ message: `Deployment failed.` });
          throw e;
        }
      } else {
        deploymentLog.appendLine(`Deployment cancelled. Not sure where to deploy workspace.`);
        throw new Error("Invalid deployment path");
      }
    });
  }

  async function setDeployLocation(node: any) {
    const path = node?.path || await vscode.window.showInputBox({
      prompt: `Enter IFS directory to deploy to`,
    });

    if (path) {
      const storage = instance.getStorage();
      const chosenWorkspaceFolder = await getWorkspaceFolder();

      if (storage && chosenWorkspaceFolder) {
        const existingPaths = storage.getDeployment();
        existingPaths[chosenWorkspaceFolder.uri.fsPath] = path;
        await storage.setDeployment(existingPaths);

        if (await vscode.window.showInformationMessage(`Deployment location set to ${path}`, `Deploy now`)) {
          vscode.commands.executeCommand(`code-for-ibmi.launchDeploy`, chosenWorkspaceFolder.index);
        }
      }
    }
  }

  async function buildWatcher() {
    const invalidFs = [`member`, `streamfile`];
    const watcher = vscode.workspace.createFileSystemWatcher(`**`);

    watcher.onDidChange(uri => {
      if (invalidFs.includes(uri.scheme)) return;
      if (uri.fsPath.includes(`.git`)) return;
      changes.set(uri.fsPath, uri);
    });
    watcher.onDidCreate(async uri => {
      if (invalidFs.includes(uri.scheme)) return;
      if (uri.fsPath.includes(`.git`)) return;
      const fileStat = await vscode.workspace.fs.stat(uri);

      if (fileStat.type === vscode.FileType.File) {
        changes.set(uri.fsPath, uri);
      }
    });
    watcher.onDidDelete(uri => {
      if (invalidFs.includes(uri.scheme)) return;
      if (uri.fsPath.includes(`.git`)) return;
      changes.delete(uri.fsPath);
    });

    return watcher;
  }

  async function showErrorButton() {
    if (await vscode.window.showErrorMessage(`Deployment failed.`, `View Log`)) {
      deploymentLog.show();
    }
  }

  async function getWorkspaceFolder(workspaceIndex?: number) {
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
}