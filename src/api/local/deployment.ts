
import path, { basename, dirname } from 'path';
import vscode from 'vscode';
import { getLocalActions } from './actions';
import { ConnectionConfiguration } from '../Configuration';
import { LocalLanguageActions } from '../../schemas/LocalLanguageActions';
import { GitExtension } from '../import/git';
import { instance } from '../../instantiate';
import Instance from '../Instance';
import ignore from 'ignore'
import { NodeSSH } from 'node-ssh';
import { readFileSync } from 'fs';
import Crypto from 'crypto';
import IBMi from '../IBMi';
import { DeploymentMethod, DeploymentParameters } from '../../typings';
import { Tools } from '../Tools';

export namespace Deployment {
  interface Upload {
    local: string
    remote: string
    uri: vscode.Uri
  }

  interface MD5Entry {
    path: string
    md5: string
  }

  const BUTTON_BASE = `$(cloud-upload) Deploy`;
  const BUTTON_WORKING = `$(sync~spin) Deploying`;

  const deploymentLog = vscode.window.createOutputChannel(`IBM i Deployment`);
  const button = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
  const changes: Map<string, vscode.Uri> = new Map;

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
              await createRemoteDirectory(possibleDeployDir);

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
    const chosenWorkspace = await getWorkspaceFolder();

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
        const methods = [];
        if (getConnection().remoteFeatures.md5sum) {
          methods.push({ method: DeploymentMethod.compare, label: `Compare`, description: `Synchronizes using MD5 hash comparison` });
        }
        methods.push(
          { method: DeploymentMethod.changed, label: `Changes`, description: `${changes.size} change${changes.size > 1 ? `s` : ``} detected since last upload. ${!changes.size ? `Will skip deploy step.` : ``}` },
          { method: DeploymentMethod.unstaged, label: `Working Changes`, description: `Unstaged changes in git` },
          { method: DeploymentMethod.staged, label: `Staged Changes`, description: `` },
          { method: DeploymentMethod.all, label: `All`, description: `Every file in the local workspace` }
        );

        const method = (await vscode.window.showQuickPick(methods,
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

          if (await deploy(parameters)) {
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

  export async function deploy(parameters: DeploymentParameters) {
    try {
      deploymentLog.clear();
      button.text = BUTTON_WORKING;

      await createRemoteDirectory(parameters.remotePath);

      switch (parameters.method) {
        case DeploymentMethod.unstaged:
          await deployGit(parameters, 'working');
          break;

        case DeploymentMethod.staged:
          await deployGit(parameters, 'staged');
          break;

        case DeploymentMethod.changed:
          await deployChanged(parameters);
          break;

        case DeploymentMethod.compare:
          await deployCompare(parameters);
          break;

        case DeploymentMethod.all:
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
    const client = getConnection().client;
    if (!client) {
      throw new Error("Please connect to an IBM i");
    }
    return client;
  }

  function getConnection(): IBMi {
    const connection = instance.getConnection();
    if (!connection) {
      throw new Error("Please connect to an IBM i");
    }
    return connection;
  }

  async function createRemoteDirectory(remotePath: string) {
    return await getConnection().sendCommand({
      command: `mkdir -p "${remotePath}"`
    });
  }

  async function deployChanged(parameters: DeploymentParameters) {
    if (changes.size > 0) {
      const changedFiles = Array.from(changes.values())
        .filter(uri => {
          // We don't want stuff in the gitignore
          const relative = toRelative(parameters.localFolder, uri);
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
          const relative = toRelative(parameters.localFolder, uri);
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
    const gitApi = Tools.getGitAPI();

    if (gitApi && gitApi.repositories.length > 0) {
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
            const relative = toRelative(parameters.localFolder, change.uri);
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

  async function deployCompare(parameters: DeploymentParameters) {
    if (getConnection().remoteFeatures.md5sum) {
      const isEmpty = (await getConnection().sendCommand({ directory: parameters.remotePath, command: `ls | wc -l` })).stdout === "0";
      if (isEmpty) {
        deploymentLog.appendLine("Remote directory is empty; switching to 'deploy all' DeploymentMethod.");
        await deployAll(parameters);
      }
      else {
        const name = basename(parameters.localFolder.path);
        await vscode.window.withProgress({
          location: vscode.ProgressLocation.Notification,
          title: `Synchronizing ${name}`,
        }, async (progress) => {
          deploymentLog.appendLine("Starting MD5 synchronization transfer");
          progress.report({ message: `creating remote MD5 hash list` });
          const md5sumOut = await getConnection().sendCommand({
            directory: parameters.remotePath,
            command: `/QOpenSys/pkgs/bin/md5sum $(find . -type f)`
          });

          const remoteMD5: MD5Entry[] = md5sumOut.stdout.split(`\n`).map(line => toMD5Entry(line.trim()));

          progress.report({ message: `creating transfer list`, increment: 25 });
          const localRoot = `${parameters.localFolder.fsPath}${parameters.localFolder.fsPath.startsWith('/') ? '/' : '\\'}`;
          const localFiles = (await findFiles(parameters, "**/*", "**/.git*"))
            .map(file => ({ uri: file, path: file.fsPath.replace(localRoot, '').replace(/\\/g, '/') }));

          const uploads: { local: string, remote: string }[] = [];
          for await (const file of localFiles) {
            const remote = remoteMD5.find(e => e.path === file.path);
            const md5 = md5Hash(file.uri);
            if (!remote || remote.md5 !== md5) {
              uploads.push({ local: file.uri.fsPath, remote: `${parameters.remotePath}/${file.path}` });
            }
          }

          const toDelete: string[] = remoteMD5.filter(remote => !localFiles.some(local => remote.path === local.path))
            .map(remote => remote.path);
          if (toDelete.length) {
            progress.report({ message: `deleting ${toDelete.length} remote file(s)`, increment: 25 });
            deploymentLog.appendLine(`\nDeleted:\n\t${toDelete.join('\n\t')}\n`);
            await getConnection().sendCommand({ directory: parameters.remotePath, command: `rm -f ${toDelete.join(' ')}` });
          }
          else {
            progress.report({ increment: 25 });
          }

          if (uploads.length) {
            //Create all missing folders at once
            progress.report({ message: `creating remote folders`, increment: 10 });
            const mkdirs = [...new Set(uploads.map(u => dirname(u.remote)))].map(folder => `[ -d ${folder} ] || mkdir -p ${folder}`).join(';');
            await getConnection().sendCommand({ command: mkdirs });

            progress.report({ message: `uploading ${uploads.length} file(s)`, increment: 15 });
            deploymentLog.appendLine(`\nUploaded:\n\t${uploads.map(file => file.remote).join('\n\t')}\n`);
            await getClient().putFiles(uploads, { concurrency: 5 });
          }
          else {
            progress.report({ increment: 25 });
          }

          progress.report({ message: `removing empty folders under ${parameters.remotePath}`, increment: 20 });
          //PASE's find doesn't support the -empty flag so rmdir is run on every directory; not very clean, but it works
          await getConnection().sendCommand({ command: "find . -depth -type d -exec rmdir {} + 2>/dev/null", directory: parameters.remotePath });

          progress.report({ increment: 5 });
        });
      }
    }
    else {
      throw new Error("Cannot synchronize using MD5 comparison: 'md5sum' command not availabe on host.");
    }
  }

  async function deployAll(parameters: DeploymentParameters) {
    const name = basename(parameters.localFolder.path);
    await vscode.window.withProgress({
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
              if (remotePath.startsWith('\\')) {
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

  function toMD5Entry(line: string): MD5Entry {
    const parts = line.split(/\s+/);
    return {
      md5: parts[0].trim(),
      path: parts[1].trim().substring(2) //these path starts with ./
    };
  }

  function md5Hash(file: vscode.Uri): string {
    const bytes = readFileSync(file.fsPath);
    return Crypto.createHash("md5")
      .update(bytes)
      .digest("hex")
      .toLowerCase();
  }

  function toRelative(root: vscode.Uri, file: vscode.Uri) {
    return path.relative(root.path, file.path).replace(/\\/g, `/`);
  }

  async function findFiles(parameters: DeploymentParameters, includePattern: string, excludePattern?: string) {
    const root = parameters.localFolder.fsPath;
    return (await vscode.workspace.findFiles(new vscode.RelativePattern(root, includePattern),
      excludePattern ? new vscode.RelativePattern(root, excludePattern) : null))
      .filter(file => {
        if (parameters.ignoreRules) {
          const relative = toRelative(parameters.localFolder, file);
          return !parameters.ignoreRules.ignores(relative);
        }
        else {
          return true;
        }
      });
  }
}
