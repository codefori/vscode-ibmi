
const path = require(`path`);
const vscode = require(`vscode`);

const IBMi = require(`./IBMi`);
const Storage = require(`./Storage`);

const gitExtension = vscode.extensions.getExtension(`vscode.git`).exports;
const gitApi = gitExtension.getAPI(1);

const DEPLOYMENT_KEY = `deployment`;

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

    context.subscriptions.push(this.button, this.deploymentLog);

    if (vscode.workspace.workspaceFolders.length > 0) {
      vscode.commands.executeCommand(`setContext`, `code-for-ibmi:workspace`, true);
      this.button.show();
    }

    context.subscriptions.push(
      vscode.commands.registerCommand(`code-for-ibmi.launchDeploy`, async (workspaceIndex) => {
        /** @type {Storage} */
        const storage = instance.getStorage();

        let folder;

        if (workspaceIndex) {
          folder = vscode.workspace.workspaceFolders.find(dir => dir.index === workspaceIndex);
        } else {
          folder = await Deployment.getWorkspaceFolder();
        }

        if (folder) {
          const existingPaths = storage.get(DEPLOYMENT_KEY) || {};
          const remotePath = existingPaths[folder.uri.fsPath];

          if (remotePath) {
            const method = await vscode.window.showQuickPick(
              [`Staged Changes`, `All`],
              { placeHolder: `Select deployment method to ${remotePath}` }
            );

            if (method) {
              /** @type {IBMi} */
              const ibmi = instance.getConnection();
              const client = ibmi.client;
              this.deploymentLog.clear();

              switch (method) {
              case `Staged Changes`: // Uses git
                if (gitApi.repositories.length > 0) {
                  const repository = gitApi.repositories.find(r => r.rootUri.fsPath === folder.uri.fsPath);

                  if (repository) {
                    const changes = await repository.state.indexChanges;
                    const uploads = changes.map(change => {
                      const relative = change.uri.fsPath.replace(folder.uri.fsPath, ``);
                      const remote = path.posix.join(remotePath, relative);
                      return {
                        local: change.uri.path,
                        remote: remote
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

                      return true;
                    } catch (e) {
                      this.button.text = BUTTON_BASE;
                      vscode.window.showErrorMessage(`Deployment failed.`, `View Log`).then(async (action) => {
                        if (action === `View Log`) {
                          this.deploymentLog.show();
                        }
                      });
                      
                      this.deploymentLog.appendLine(`Deployment failed.`);
                      this.deploymentLog.appendLine(e);
                    }


                  } else {
                    vscode.window.showErrorMessage(`No repository found for ${folder.uri.fsPath}`);
                  }
                } else {
                  vscode.window.showErrorMessage(`No repositories are open.`);
                }

                break;

              case `All`: // Uploads entire directory
                this.button.text = BUTTON_WORKING;

                const uploadResult = await vscode.window.withProgress({
                  location: vscode.ProgressLocation.Notification,
                  title: `Deploying to ${folder.name}`,
                }, async (progress) => {
                  progress.report({ message: `Deploying to ${folder.name}` });
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
                      }
                    });

                    progress.report({ message: `Deployment finished.` });
                    this.deploymentLog.appendLine(`Deployment finished.`);

                    return true;
                  } catch (e) {
                    progress.report({ message: `Deployment failed.` });
                    this.deploymentLog.appendLine(`Deployment failed`);
                    this.deploymentLog.appendLine(e);

                    return false;
                  }
                });

                this.button.text = BUTTON_BASE;
                if (uploadResult) {
                  vscode.window.showInformationMessage(`Deployment finished.`);
                  return true;
                } else {
                  vscode.window.showErrorMessage(`Deployment failed.`, `View Log`).then(async (action) => {
                    if (action === `View Log`) {
                      this.deploymentLog.show();
                    }
                  });
                }

                break;
              }
            }
          } else {
            vscode.window.showErrorMessage(`Chosen folder (${folder.uri.fsPath}) is not configured for deployment.`);
          }
        } else {
          vscode.window.showErrorMessage(`No folder selected for deployment.`);
        }

        return false;
      }),

      vscode.commands.registerCommand(`code-for-ibmi.setDeployDirectory`, async (directory) => {
        let path;
        if (directory) {
          path = directory.path;
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
            const existingPaths = storage.get(DEPLOYMENT_KEY) || {};
            existingPaths[chosenWorkspaceFolder.uri.fsPath] = path;
            await storage.set(DEPLOYMENT_KEY, existingPaths);

            vscode.window.showInformationMessage(`Deployment directory set to ${path}`, `Deploy now`).then(async (choice) => {
              if (choice === `Deploy now`) {
                vscode.commands.executeCommand(`code-for-ibmi.launchDeploy`, chosenWorkspaceFolder.index);
              }
            });
          }
        }
      }),
    );
  }

  static async getWorkspaceFolder() {
    const workspaces = vscode.workspace.workspaceFolders;

    if (workspaces.length > 0) {
      if (workspaces.length === 1) {
        return workspaces[0];
      } else {
        const chosen = await vscode.window.showQuickPick(workspaces.map(dir => dir.name), {
          placeHolder: `Select workspace to deploy to`
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