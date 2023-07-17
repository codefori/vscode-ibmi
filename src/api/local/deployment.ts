import createIgnore, { Ignore } from 'ignore';
import path, { basename } from 'path';
import tar from 'tar';
import tmp from 'tmp';
import vscode, { WorkspaceFolder } from 'vscode';
import { instance } from '../../instantiate';
import { LocalLanguageActions } from './LocalLanguageActions';
import { DeploymentMethod, DeploymentParameters } from '../../typings';
import { ConnectionConfiguration } from '../Configuration';
import IBMi from '../IBMi';
import { Tools } from '../Tools';
import { getLocalActions } from './actions';

export namespace Deployment {
  interface MD5Entry {
    path: string
    md5: string
  }

  const BUTTON_BASE = `$(cloud-upload) Deploy`;
  const BUTTON_WORKING = `$(sync~spin) Deploying`;

  const deploymentLog = vscode.window.createOutputChannel(`IBM i Deployment`);
  const button = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
  const workspaceChanges: Map<vscode.WorkspaceFolder, Map<string, vscode.Uri>> = new Map;

  export function initialize(context: vscode.ExtensionContext) {
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
            const possibleDeployDir = buildPossibleDeploymentDirectory(workspace);
            vscode.window.showInformationMessage(
              `Deploy directory for Workspace not setup. Would you like to default to '${possibleDeployDir}'?`,
              `Yes`,
              `Ignore`
            ).then(async result => {
              if (result === `Yes`) {
                setDeployLocation({ path: possibleDeployDir }, workspace);
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
    });

    instance.onEvent("disconnected", () => {
      button.hide();
    })
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

      if (remotePath) {
        const methods = [];
        if (getConnection().remoteFeatures.md5sum) {
          methods.push({ method: "compare" as DeploymentMethod, label: `Compare`, description: `Synchronizes using MD5 hash comparison` });
        }

        const changes = workspaceChanges.get(folder)?.size || 0;
        methods.push({ method: "changed" as DeploymentMethod, label: `Changes`, description: `${changes} change${changes > 1 ? `s` : ``} detected since last upload. ${!changes ? `Will skip deploy step.` : ``}` });

        if (Tools.getGitAPI()) {
          methods.push(
            { method: "unstaged" as DeploymentMethod, label: `Working Changes`, description: `Unstaged changes in git` },
            { method: "staged" as DeploymentMethod, label: `Staged Changes`, description: `` }
          );
        }

        methods.push({ method: "all" as DeploymentMethod, label: `All`, description: `Every file in the local workspace` });

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
            workspaceFolder: folder,
            remotePath,
            method
          };

          if (await deploy(parameters)) {
            instance.fire(`deploy`);
            return folder.index;
          }
        }
      } else {
        if (await vscode.window.showErrorMessage(`Chosen location (${folder.uri.fsPath}) is not configured for deployment.`, 'Set deploy location')) {
          setDeployLocation(undefined, folder, buildPossibleDeploymentDirectory(folder));
        }
      }
    }
  }

  export async function deploy(parameters: DeploymentParameters) {
    try {
      deploymentLog.clear();
      deploymentLog.appendLine(`Deployment started using method "${parameters.method}"`);
      deploymentLog.appendLine(``);
      button.text = BUTTON_WORKING;

      parameters.ignoreRules = parameters.ignoreRules || await getDefaultIgnoreRules(parameters.workspaceFolder);

      const name = basename(parameters.workspaceFolder.uri.path);
      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `Deploying ${name}`,
      }, async (progress) => {
        if (parameters.remotePath.startsWith(`/`)) {
          progress.report({ message: `creating remote folder ${parameters.remotePath}...` });
          await createRemoteDirectory(parameters.remotePath);

          progress.report({ message: `gathering files ("${parameters.method}" method)...` });
          const files: vscode.Uri[] = [];
          switch (parameters.method) {
            case "unstaged":
              files.push(...await deployGit(parameters, 'working'));
              break;

            case "staged":
              files.push(...await deployGit(parameters, 'staged'));
              break;

            case "changed":
              files.push(...await deployChanged(parameters));
              break;

            case "compare":
              files.push(...await deployCompare(parameters, progress));
              break;

            case "all":
              files.push(...await deployAll(parameters));
              break;
          }

          if (files.length) {
            await sendCompressed(parameters, files, progress);
          }
          else {
            deploymentLog.appendLine('No files to upload');
          }
        } else {
          deploymentLog.appendLine(`Deployment cancelled. Not sure where to deploy workspace.`);
          throw new Error("Invalid deployment path");
        }
      })
      deploymentLog.appendLine('');
      deploymentLog.appendLine(`Deployment finished`);
      vscode.window.showInformationMessage(`Deployment finished.`);
      workspaceChanges.get(parameters.workspaceFolder)?.clear();
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

  async function deployChanged(parameters: DeploymentParameters): Promise<vscode.Uri[]> {
    const changes = workspaceChanges.get(parameters.workspaceFolder);
    if (changes && changes.size) {
      return Array.from(changes.values())
        .filter(uri => {
          // We don't want stuff in the gitignore
          const relative = toRelative(parameters.workspaceFolder.uri, uri);
          if (relative && parameters.ignoreRules) {
            return !parameters.ignoreRules.ignores(relative);
          }
          else {
            return true;
          }
        });
    } else {
      // Skip upload, but still run the Action
      return [];
    }
  }

  async function deployGit(parameters: DeploymentParameters, changeType: 'staged' | 'working'): Promise<vscode.Uri[]> {
    const useStagedChanges = (changeType == 'staged');
    const gitApi = Tools.getGitAPI();

    if (gitApi && gitApi.repositories.length > 0) {
      const repository = gitApi.repositories.find(r => r.rootUri.fsPath === parameters.workspaceFolder.uri.fsPath);

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
          return gitFiles.map(change => change.uri);
        } else {
          vscode.window.showWarningMessage(`No ${changeType} changes to deploy.`);
          return [];
        }
      } else {
        throw new Error(`No repository found for ${parameters.workspaceFolder.uri.fsPath}`);
      }
    } else {
      throw new Error(`No repositories are open.`);
    }
  }

  async function deployCompare(parameters: DeploymentParameters, progress: vscode.Progress<{ message?: string }>): Promise<vscode.Uri[]> {
    if (getConnection().remoteFeatures.md5sum) {
      const isEmpty = (await getConnection().sendCommand({ directory: parameters.remotePath, command: `ls | wc -l` })).stdout === "0";
      if (isEmpty) {
        deploymentLog.appendLine("Remote directory is empty; switching to 'deploy all'");
        return await deployAll(parameters);
      }
      else {
        deploymentLog.appendLine("Starting MD5 synchronization transfer");
        progress.report({ message: `creating remote MD5 hash list` });
        const md5sumOut = await getConnection().sendCommand({
          directory: parameters.remotePath,
          command: `/QOpenSys/pkgs/bin/md5sum $(find . -type f)`
        });

        const remoteMD5: MD5Entry[] = md5sumOut.stdout.split(`\n`).map(line => toMD5Entry(line.trim()));

        progress.report({ message: `creating transfer list` });
        const localRoot = `${parameters.workspaceFolder.uri.fsPath}${parameters.workspaceFolder.uri.fsPath.startsWith('/') ? '/' : '\\'}`;
        const localFiles = (await findFiles(parameters, "**/*", "**/.git*"))
          .map(file => ({ uri: file, path: file.fsPath.replace(localRoot, '').replace(/\\/g, '/') }));

        const uploads: vscode.Uri[] = [];
        for await (const file of localFiles) {
          const remote = remoteMD5.find(e => e.path === file.path);
          const md5 = Tools.md5Hash(file.uri);
          if (!remote || remote.md5 !== md5) {
            uploads.push(file.uri);
          }
        }

        const toDelete: string[] = remoteMD5.filter(remote => !localFiles.some(local => remote.path === local.path))
          .map(remote => remote.path);
        if (toDelete.length) {
          progress.report({ message: `deleting ${toDelete.length} remote file(s)`, });
          deploymentLog.appendLine(`\nDeleted:\n\t${toDelete.join('\n\t')}\n`);
          await getConnection().sendCommand({ directory: parameters.remotePath, command: `rm -f ${toDelete.join(' ')}` });
        }

        progress.report({ message: `removing empty folders under ${parameters.remotePath}` });
        //PASE's find doesn't support the -empty flag so rmdir is run on every directory; not very clean, but it works
        await getConnection().sendCommand({ command: "find . -depth -type d -exec rmdir {} + 2>/dev/null", directory: parameters.remotePath });

        return uploads;
      }
    }
    else {
      throw new Error("Cannot synchronize using MD5 comparison: 'md5sum' command not availabe on host.");
    }
  }

  async function deployAll(parameters: DeploymentParameters): Promise<vscode.Uri[]> {
    return (await findFiles(parameters, "**/*", "**/.git*"));
  }

  async function setDeployLocation(node: any, workspaceFolder?: WorkspaceFolder, value?: string) {
    const path = node?.path || await vscode.window.showInputBox({
      prompt: `Enter IFS directory to deploy to`,
      value
    });

    if (path) {
      const storage = instance.getStorage();
      const chosenWorkspaceFolder = workspaceFolder || await getWorkspaceFolder();

      if (storage && chosenWorkspaceFolder) {
        await createRemoteDirectory(path);

        const existingPaths = storage.getDeployment();
        existingPaths[chosenWorkspaceFolder.uri.fsPath] = path;
        await storage.setDeployment(existingPaths);

        instance.fire(`deployLocation`);

        if (await vscode.window.showInformationMessage(`Deployment location set to ${path}`, `Deploy now`)) {
          vscode.commands.executeCommand(`code-for-ibmi.launchDeploy`, chosenWorkspaceFolder.index);
        }
      }
    }
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

  function toRelative(root: vscode.Uri, file: vscode.Uri) {
    return path.relative(root.path, file.path).replace(/\\/g, `/`);
  }

  async function findFiles(parameters: DeploymentParameters, includePattern: string, excludePattern?: string) {
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

  function buildPossibleDeploymentDirectory(workspace: vscode.WorkspaceFolder) {
    const user = instance.getConnection()?.currentUser;
    //User should not be empty but we'll keep tmp as a fallback location
    return user ? path.posix.join('/', 'home', user, 'builds', workspace.name) : path.posix.join('/', 'tmp', 'builds', workspace.name);
  }

  async function sendCompressed(parameters: DeploymentParameters, files: vscode.Uri[], progress: vscode.Progress<{ message?: string }>) {
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

async function getDefaultIgnoreRules(workspaceFolder: vscode.WorkspaceFolder): Promise<Ignore> {
  const ignoreRules = createIgnore({ ignorecase: true }).add(`.git`);
  // get the .gitignore file from workspace
  const gitignores = await vscode.workspace.findFiles(new vscode.RelativePattern(workspaceFolder, `.gitignore`), ``, 1);
  if (gitignores.length > 0) {
    // get the content from the file
    const gitignoreContent = (await vscode.workspace.fs.readFile(gitignores[0])).toString().replace(new RegExp(`\\\r`, `g`), ``);
    ignoreRules.add(gitignoreContent.split(`\n`));
    ignoreRules.add('**/.gitignore');
  }

  return ignoreRules;
}