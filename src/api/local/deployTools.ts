import createIgnore, { Ignore } from 'ignore';
import path, { basename } from 'path';
import vscode, { WorkspaceFolder } from 'vscode';
import { instance } from '../../instantiate';
import { LocalLanguageActions } from './LocalLanguageActions';
import { DeploymentMethod, DeploymentParameters } from '../../typings';
import { ConnectionConfiguration } from '../Configuration';
import { Tools } from '../Tools';
import { Deployment } from './deployment';

export namespace DeployTools {
  export async function launchActionsSetup(workspaceFolder?: WorkspaceFolder) {
    const chosenWorkspace = workspaceFolder || await Deployment.getWorkspaceFolder();

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
   * @param method if no method is provided, a prompt will be shown to pick the deployment method.
   * @returns the index of the deployed workspace or `undefined` if the deployment failed
   */
  export async function launchDeploy(workspaceIndex?: number, method?: DeploymentMethod): Promise<number | undefined> {
    const folder = await Deployment.getWorkspaceFolder(workspaceIndex);
    if (folder) {
      const storage = instance.getStorage();

      const existingPaths = storage?.getDeployment();
      const remotePath = existingPaths ? existingPaths[folder.uri.fsPath] : '';

      if (remotePath) {
        if (!method) {
          const methods = [];
          if (Deployment.getConnection().remoteFeatures.md5sum) {
            methods.push({ method: "compare" as DeploymentMethod, label: `Compare`, description: `Synchronizes using MD5 hash comparison` });
          }

          const changes = Deployment.workspaceChanges.get(folder)?.size || 0;
          methods.push({ method: "changed" as DeploymentMethod, label: `Changes`, description: `${changes} change${changes > 1 ? `s` : ``} detected since last upload. ${!changes ? `Will skip deploy step.` : ``}` });

          if (Tools.getGitAPI()) {
            methods.push(
              { method: "unstaged" as DeploymentMethod, label: `Working Changes`, description: `Unstaged changes in git` },
              { method: "staged" as DeploymentMethod, label: `Staged Changes`, description: `` }
            );
          }

          methods.push({ method: "all" as DeploymentMethod, label: `All`, description: `Every file in the local workspace` });

          const defaultDeploymentMethod = instance.getConfig()?.defaultDeploymentMethod as DeploymentMethod

          if (methods.find((element) => element.method === defaultDeploymentMethod)) { // default deploy method is usable
            method = defaultDeploymentMethod
          
          } else { 
            if (defaultDeploymentMethod as string !== '') {
              vscode.window.showWarningMessage('Default deployment method is set but not usable in your environment.')
            }

            method = (await vscode.window.showQuickPick(methods,
              { placeHolder: `Select deployment method to ${remotePath}` }
            ))?.method;
          }
        }

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
      Deployment.deploymentLog.clear();
      Deployment.deploymentLog.appendLine(`Deployment started using method "${parameters.method}"`);
      Deployment.deploymentLog.appendLine(``);
      Deployment.button.text = Deployment.BUTTON_WORKING;

      parameters.ignoreRules = parameters.ignoreRules || await getDefaultIgnoreRules(parameters.workspaceFolder);

      const name = basename(parameters.workspaceFolder.uri.path);
      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `Deploying ${name}`,
      }, async (progress) => {
        if (parameters.remotePath.startsWith(`/`)) {
          progress.report({ message: `creating remote folder ${parameters.remotePath}...` });
          await Deployment.createRemoteDirectory(parameters.remotePath);

          progress.report({ message: `gathering files ("${parameters.method}" method)...` });
          const files: vscode.Uri[] = [];
          switch (parameters.method) {
            case "unstaged":
              files.push(...await getDeployGitFiles(parameters, 'working'));
              break;

            case "staged":
              files.push(...await getDeployGitFiles(parameters, 'staged'));
              break;

            case "changed":
              files.push(...await getDeployChangedFiles(parameters));
              break;

            case "compare":
              files.push(...await getDeployCompareFiles(parameters, progress));
              break;

            case "all":
              files.push(...await getDeployAllFiles(parameters));
              break;
          }

          if (files.length) {
            await Deployment.sendCompressed(parameters, files, progress);
          }
          else {
            Deployment.deploymentLog.appendLine('No files to upload');
          }
        } else {
          Deployment.deploymentLog.appendLine(`Deployment cancelled. Not sure where to deploy workspace.`);
          throw new Error("Invalid deployment path");
        }
      })
      Deployment.deploymentLog.appendLine('');
      Deployment.deploymentLog.appendLine(`Deployment finished`);
      vscode.window.showInformationMessage(`Deployment finished.`);
      Deployment.workspaceChanges.get(parameters.workspaceFolder)?.clear();
      return true;
    }
    catch (error) {
      Deployment.showErrorButton();
      Deployment.deploymentLog.appendLine(`Deployment failed: ${error}`);
      return false;
    }
    finally {
      Deployment.button.text = Deployment.BUTTON_BASE;
    }
  }

  export async function getDeployChangedFiles(parameters: DeploymentParameters): Promise<vscode.Uri[]> {
    const changes = Deployment.workspaceChanges.get(parameters.workspaceFolder);
    if (changes && changes.size) {
      return Array.from(changes.values())
        .filter(uri => {
          // We don't want stuff in the gitignore
          const relative = Deployment.toRelative(parameters.workspaceFolder.uri, uri);
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

  export async function getDeployGitFiles(parameters: DeploymentParameters, changeType: 'staged' | 'working'): Promise<vscode.Uri[]> {
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

  export async function getDeployCompareFiles(parameters: DeploymentParameters, progress?: vscode.Progress<{ message?: string }>): Promise<vscode.Uri[]> {
    if (Deployment.getConnection().remoteFeatures.md5sum) {
      const isEmpty = (await Deployment.getConnection().sendCommand({ directory: parameters.remotePath, command: `ls | wc -l` })).stdout === "0";
      if (isEmpty) {
        Deployment.deploymentLog.appendLine("Remote directory is empty; switching to 'deploy all'");
        return await getDeployAllFiles(parameters);
      }
      else {
        Deployment.deploymentLog.appendLine("Starting MD5 synchronization transfer");
        progress?.report({ message: `creating remote MD5 hash list` });
        const md5sumOut = await Deployment.getConnection().sendCommand({
          directory: parameters.remotePath,
          command: `/QOpenSys/pkgs/bin/md5sum $(find . -type f)`
        });

        const remoteMD5: Deployment.MD5Entry[] = md5sumOut.stdout.split(`\n`).map(line => Deployment.toMD5Entry(line.trim()));

        progress?.report({ message: `creating transfer list` });
        const localRoot = `${parameters.workspaceFolder.uri.fsPath}${parameters.workspaceFolder.uri.fsPath.startsWith('/') ? '/' : '\\'}`;
        const localFiles = (await Deployment.findFiles(parameters, "**/*", "**/.git*"))
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
          progress?.report({ message: `deleting ${toDelete.length} remote file(s)`, });
          Deployment.deploymentLog.appendLine(`\nDeleted:\n\t${toDelete.join('\n\t')}\n`);
          await Deployment.getConnection().sendCommand({ directory: parameters.remotePath, command: `rm -f ${toDelete.join(' ')}` });
        }

        progress?.report({ message: `removing empty folders under ${parameters.remotePath}` });
        //PASE's find doesn't support the -empty flag so rmdir is run on every directory; not very clean, but it works
        await Deployment.getConnection().sendCommand({ command: "find . -depth -type d -exec rmdir {} + 2>/dev/null", directory: parameters.remotePath });

        return uploads;
      }
    }
    else {
      throw new Error("Cannot synchronize using MD5 comparison: 'md5sum' command not availabe on host.");
    }
  }

  export async function getDeployAllFiles(parameters: DeploymentParameters): Promise<vscode.Uri[]> {
    return (await Deployment.findFiles(parameters, "**/*", "**/.git*"));
  }

  export async function setDeployLocation(node: any, workspaceFolder?: WorkspaceFolder, value?: string) {
    const path = node?.path || await vscode.window.showInputBox({
      prompt: `Enter IFS directory to deploy to`,
      value
    });

    if (path) {
      const storage = instance.getStorage();
      const chosenWorkspaceFolder = workspaceFolder || await Deployment.getWorkspaceFolder();

      if (storage && chosenWorkspaceFolder) {
        await Deployment.createRemoteDirectory(path);

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

  export function buildPossibleDeploymentDirectory(workspace: vscode.WorkspaceFolder) {
    const user = instance.getConnection()?.currentUser;
    //User should not be empty but we'll keep tmp as a fallback location
    return user ? path.posix.join('/', 'home', user, 'builds', workspace.name) : path.posix.join('/', 'tmp', 'builds', workspace.name);
  }

  export async function getDefaultIgnoreRules(workspaceFolder: vscode.WorkspaceFolder): Promise<Ignore> {
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
}