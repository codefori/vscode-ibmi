
const path = require(`path`);
const vscode = require(`vscode`);

const {default: IBMi} = require(`./IBMi`);
const CompileTools = require(`./CompileTools`);


const { ConnectionConfiguration } = require(`./Configuration`);
const {LocalLanguageActions} = require(`../schemas/LocalLanguageActions`);
const { Storage } = require(`./Storage`);

const ignore = require(`ignore`).default;

const gitExtension = vscode.extensions.getExtension(`vscode.git`).exports;

const BUTTON_BASE = `$(cloud-upload) Deploy`;
const BUTTON_WORKING = `$(sync~spin) Deploying`;

module.exports = class Deployment {
  /**
   * 
   * @param {vscode.ExtensionContext} context 
   * @param {*} instance 
   */
  constructor(context, instance) {
    this.instance = instance;
    
    this.deploymentLog = vscode.window.createOutputChannel(`IBM i Deployment`);

    /** @type {vscode.StatusBarItem} */
    this.button = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
    this.button.command = {
      command: `code-for-ibmi.launchDeploy`,
      title: `Launch Deploy`
    }
    this.button.text = BUTTON_BASE;

    /** @type {{[id: string]: vscode.Uri}} */
    this.changes = {};

    context.subscriptions.push(
      this.button, 
      this.deploymentLog
    );

    if (vscode.workspace.workspaceFolders) {
      if (vscode.workspace.workspaceFolders.length > 0) {
        context.subscriptions.push(this.buildWatcher());
        this.button.show();
      }
    }

    context.subscriptions.push(
      vscode.commands.registerCommand(`code-for-ibmi.launchActionsSetup`, async () => {
        const chosenWorkspace = await module.exports.getWorkspaceFolder();

        if (chosenWorkspace) {
          const types = Object.keys(LocalLanguageActions);
        
          const chosenTypes = await vscode.window.showQuickPick(types, {
            canPickMany: true,
            title: `Select available pre-defined actions`
          });

          if (chosenTypes) {
            /** @type {Action[]} */
            const newActions = chosenTypes.map(type => LocalLanguageActions[type]).flat();

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
      }),

      /**
       * @param {number} document
       * @returns {Promise<{false|number}>}
       */
      vscode.commands.registerCommand(`code-for-ibmi.launchDeploy`, async (workspaceIndex) => {
        /** @type {Storage} */
        const storage = instance.getStorage();
        
        /** @type {vscode.WorkspaceFolder} */
        let folder;

        if (workspaceIndex >= 0) {
          folder = vscode.workspace.workspaceFolders.find(dir => dir.index === workspaceIndex);
        } else {
          folder = await Deployment.getWorkspaceFolder();
        }

        if (folder) {
          const existingPaths = storage.getDeployment();
          const remotePath = existingPaths[folder.uri.fsPath];

          // get the .gitignore file from workspace
          const gitignores = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, `**/.gitignore`), ``, 1);
          let ignoreRules = ignore({ignorecase: true}).add(`.git`);
          if (gitignores.length > 0) {
            // get the content from the file
            const gitignoreContent = (await vscode.workspace.fs.readFile(gitignores[0])).toString().replace(new RegExp(`\\\r`, `g`), ``);
            ignoreRules.add(gitignoreContent.split(`\n`));
          }

          const changedFiles = Object.values(this.changes)                    
            .filter(uri => {
            // We don't want stuff in the gitignore
              if (ignoreRules) {
                const relative = path.relative(folder.uri.path, uri.path).replace(new RegExp(`\\\\`, `g`), `/`);
                if (relative) {
                  return !ignoreRules.ignores(relative);
                }
              }

              // Bad way of checking if the file is a directory or not.
              // putFiles below does not support directory creation.
              const basename = path.basename(uri.path);
              if (!basename.includes(`.`)) {
                return false;
              }

              return true;
            });

          if (remotePath) {
            const chosen = await vscode.window.showQuickPick(
              [
                { label: `Changes`, description: `${changedFiles.length} change${changedFiles.length !== 1 ? `s` : ``} detected since last upload. ${changedFiles.length === 0 ? `Will skip deploy step.` : ``}` },
                { label: `Working Changes`, description: `Unstaged changes in git` },
                { label: `Staged Changes`, description: `` },
                { label: `All`, description: `Every file in the local workspace` },
              ],
              { placeHolder: `Select deployment method to ${remotePath}` }
            );

            if (chosen) {
              const method = chosen.label;
              /** @type {IBMi} */
              const ibmi = instance.getConnection();

              /** @type {ConnectionConfiguration.Parameters} */
              const config = instance.getConfig();

              const isIFS = remotePath.startsWith(`/`);

              if (isIFS && config && config.homeDirectory !== remotePath) {
                config.homeDirectory = remotePath;
                await ConnectionConfiguration.update(config);
                vscode.window.showInformationMessage(`Home directory set to ${remotePath} for deployment.`);
              }

              const client = ibmi.client;
              this.deploymentLog.clear();

              let useStagedChanges = true;
              let changeType = `staged`;
              switch (method) {
              case `Working Changes`:
                useStagedChanges = false;
                changeType = `working`;
              case `Staged Changes`: // Uses git
                let gitApi;

                try {
                  gitApi = gitExtension.getAPI(1);
                } catch (e) {
                  vscode.window.showErrorMessage(`Unable to get git API.`);
                  return false;
                }

                if (gitApi.repositories.length > 0) {
                  const repository = gitApi.repositories.find(r => r.rootUri.fsPath === folder.uri.fsPath);

                  if (repository) {
                    let changes;
                    if (useStagedChanges) {
                      changes = await repository.state.indexChanges;
                    }
                    else {
                      changes = await repository.state.workingTreeChanges;
                    }

                    // Do not attempt to upload deleted files.
                    // https://github.com/microsoft/vscode/blob/main/extensions/git/src/api/git.d.ts#L69
                    changes = changes.filter(change => change.status !== 6);
                    
                    if (changes.length > 0) {
                      const uploads = changes.map(change => {
                        const relative = path.relative(folder.uri.path, change.uri.path).replace(new RegExp(`\\\\`, `g`), `/`);
                        const remote = path.posix.join(remotePath, relative);
                        this.deploymentLog.appendLine(`UPLOADING: ${change.uri.fsPath} -> ${remote}`);
                        return {
                          local: change.uri._fsPath,
                          remote: remote,
                          uri: change.uri
                        };
                      });
                    
                      this.button.text = BUTTON_WORKING;

                      vscode.window.showInformationMessage(`Deploying ${changeType} changes (${uploads.length}) to ${remotePath}`);

                      try {
                        if (isIFS) {
                          await client.putFiles(uploads, {
                            concurrency: 5
                          });
                        } else {
                          throw new Error(`Unable to determine where to upload workspace.`)
                        }
                        this.button.text = BUTTON_BASE;
                        this.deploymentLog.appendLine(`Deployment finished.`);
                        vscode.window.showInformationMessage(`Deployment finished.`);

                        this.changes = {};

                        return folder.index;
                      } catch (e) {
                        this.button.text = BUTTON_BASE;
                        this.showErrorButton();
                      
                        this.deploymentLog.appendLine(`Deployment failed.`);
                        this.deploymentLog.appendLine(e);
                      }

                    } else {
                      vscode.window.showWarningMessage(`No ${changeType} changes to deploy.`);
                    }

                  } else {
                    vscode.window.showErrorMessage(`No repository found for ${folder.uri.fsPath}`);
                  }
                } else {
                  vscode.window.showErrorMessage(`No repositories are open.`);
                }

                break;

              case `Changes`:
                if (changedFiles.length > 0) {

                  const uploads = changedFiles
                    .map(fileUri => {
                      const relative = path.relative(folder.uri.path, fileUri.path).replace(new RegExp(`\\\\`, `g`), `/`);
                      const remote = path.posix.join(remotePath, relative);
                      this.deploymentLog.appendLine(`UPLOADING: ${fileUri.fsPath} -> ${remote}`);
                      return {
                        local: fileUri._fsPath,
                        remote: remote,
                        uri: fileUri
                      };
                    });

                  this.button.text = BUTTON_WORKING;

                  try {
                    await client.putFiles(uploads, {
                      concurrency: 5
                    });

                    this.button.text = BUTTON_BASE;
                    this.deploymentLog.appendLine(`Deployment finished.`);
                    vscode.window.showInformationMessage(`Deployment finished.`);
                    this.changes = {};

                    return folder.index;
                  } catch (e) {
                    this.button.text = BUTTON_BASE;
                    this.showErrorButton();
                    this.deploymentLog.appendLine(`Deployment failed.`);
                    this.deploymentLog.appendLine(e);
                  }
                } else {
                  // Skip upload, but still run the Action
                  return folder.index;
                }
                break;

              case `All`: // Uploads entire directory
                this.button.text = BUTTON_WORKING;

                const uploadResult = await vscode.window.withProgress({
                  location: vscode.ProgressLocation.Notification,
                  title: `Deploying to ${folder.name}`,
                }, async (progress) => {
                  progress.report({ message: `Deploying to ${folder.name}` });
                  if (isIFS) {
                    try {
                      await client.putDirectory(folder.uri.fsPath, remotePath, {
                        recursive: true,
                        concurrency: 5,
                        tick: (localPath, remotePath, error) => {
                          if (error) {
                            progress.report({ message: `Failed to deploy ${localPath}` });
                            this.deploymentLog.appendLine(`FAILED: ${localPath} -> ${remotePath}: ${error.message}`);
                          } else {
                            progress.report({ message: `Deployed ${localPath}` });
                            this.deploymentLog.appendLine(`SUCCESS: ${localPath} -> ${remotePath}`);
                          }
                        },
                        validate: (localPath, remotePath) => {
                          if (ignoreRules) {
                            const relative = path.relative(folder.uri.fsPath, localPath);
                            return !ignoreRules.ignores(relative);
                          }

                          return true;
                        }
                      });

                      progress.report({ message: `Deployment finished.` });
                      this.deploymentLog.appendLine(`Deployment finished.`);
                      this.changes = {};

                      return true;
                    } catch (e) {
                      progress.report({ message: `Deployment failed.` });
                      this.deploymentLog.appendLine(`Deployment failed`);
                      this.deploymentLog.appendLine(e);

                      return false;
                    }
                  } else {
                    this.deploymentLog.appendLine(`Deployment cancelled. Not sure where to deploy workspace.`);
                    return false;
                  }
                });

                this.button.text = BUTTON_BASE;
                if (uploadResult) {
                  vscode.window.showInformationMessage(`Deployment finished.`);
                  return folder.index;
                  
                } else {
                  this.showErrorButton();
                }

                break;
              }
            }
          } else {
            vscode.window.showErrorMessage(`Chosen location (${folder.uri.fsPath}) is not configured for deployment.`);
          }
        } else {
          vscode.window.showErrorMessage(`No location selected for deployment.`);
        }

        return false;
      }),

      vscode.commands.registerCommand(`code-for-ibmi.setDeployLocation`, async (node) => {
        let path;
        if (node) {
          // Directory or filter can be chosen
          path = node.path;
        } else {
          path = await vscode.window.showInputBox({
            prompt: `Enter IFS directory to deploy to`,
          });
        }

        if (path) {
          /** @type {Storage} */
          const storage = instance.getStorage();

          const chosenWorkspaceFolder = await Deployment.getWorkspaceFolder();

          if (chosenWorkspaceFolder) {
            const existingPaths = storage.getDeployment();
            existingPaths[chosenWorkspaceFolder.uri.fsPath] = path;
            await storage.setDeployment(existingPaths);

            vscode.window.showInformationMessage(`Deployment location set to ${path}`, `Deploy now`).then(async (choice) => {
              if (choice === `Deploy now`) {
                vscode.commands.executeCommand(`code-for-ibmi.launchDeploy`, chosenWorkspaceFolder.index);
              }
            });
          }
        }
      }),
    );
  }

  async buildWatcher() {
    const invalidFs = [`member`, `streamfile`];
    const watcher = vscode.workspace.createFileSystemWatcher(`**`);

    watcher.onDidChange(uri => {
      if (invalidFs.includes(uri.scheme)) return;
      if (uri.fsPath.includes(`.git`)) return;
      this.changes[uri.fsPath] = uri;
    });
    watcher.onDidCreate(async uri => {
      if (invalidFs.includes(uri.scheme)) return;
      if (uri.fsPath.includes(`.git`)) return;
      const fileStat = await vscode.workspace.fs.stat(uri);

      if (fileStat.type === vscode.FileType.File) {
        this.changes[uri.fsPath] = uri;
      }
    });
    watcher.onDidDelete(uri => {
      if (invalidFs.includes(uri.scheme)) return;
      if (uri.fsPath.includes(`.git`)) return;
      delete this.changes[uri.fsPath];
    });

    return watcher;
  }

  initialise(instance) {
    const workspaces = vscode.workspace.workspaceFolders;

    /** @type {IBMi} */
    const connection = instance.getConnection();
    /** @type {ConnectionConfiguration.Parameters} */
    const config = instance.getConfig();
    /** @type {Storage} */
    const storage = instance.getStorage();

    const existingPaths = storage.getDeployment();

    if (workspaces && workspaces.length === 1) {
      const workspace = workspaces[0];

      if (!existingPaths[workspace.uri.fsPath]) {
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

      CompileTools.getLocalActions(workspace).then(result => {
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

  async showErrorButton() {
    vscode.window.showErrorMessage(`Deployment failed.`, `View Log`).then(async (action) => {
      if (action === `View Log`) {
        this.deploymentLog.show();
      }
    });
  }

  static async getWorkspaceFolder() {
    const workspaces = vscode.workspace.workspaceFolders;

    if (workspaces.length > 0) {
      if (workspaces.length === 1) {
        return workspaces[0];
      } else {
        const chosen = await vscode.window.showQuickPick(workspaces.map(dir => dir.name), {
          placeHolder: `Select workspace to deploy`
        });

        if (chosen) {
          return workspaces.find(dir => dir.name === chosen);
        }

        return null;
      }
    }

    return null;
  }
}