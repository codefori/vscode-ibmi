import { ExtensionContext, WorkspaceFolder, window } from "vscode";
import { Tools } from "../Tools";
import { getBranchLibraryName } from "./env";
import { instance } from "../../instantiate";
import { GlobalConfiguration } from "../Configuration";

const lastBranch: { [workspaceUri: string]: string } = {};

export function getGitBranch(workspaceFolder: WorkspaceFolder) {
  const gitApi = Tools.getGitAPI();
  if (gitApi) {
    const repo = gitApi.getRepository(workspaceFolder.uri);
    if (repo) {
      return repo.state.HEAD?.name;
    }
  }
}

export function setupGitEventHandler(context: ExtensionContext, workspaceFolders: WorkspaceFolder[]) {
  const gitApi = Tools.getGitAPI();

  if (gitApi) {
    for (const workspaceFolder of workspaceFolders) {
      const initRepo = gitApi.getRepository(workspaceFolder.uri);
      if (initRepo) {
        const workspaceUri = workspaceFolder.uri.toString();

        context.subscriptions.push(initRepo.state.onDidChange((_e) => {
          if (GlobalConfiguration.get(`createLibraryOnBranchChange`)) {
            const repo = gitApi.getRepository(workspaceFolder.uri);
            if (repo) {
              const head = repo.state.HEAD;
              const connection = instance.getConnection();
              if (head && head.name) {
                const currentBranch = head.name;

                if (currentBranch && currentBranch !== lastBranch[workspaceUri]) {
                  if (connection) {
                    const content = instance.getContent()!;
                    if (currentBranch.includes(`/`)) {
                      const newBranchLib = getBranchLibraryName(currentBranch);
                      content.checkObject({ library: `QSYS`, name: newBranchLib, type: `*LIB` }).then(exists => {
                        if (!exists) {
                          window.showInformationMessage(`Would you like to create a new library ${newBranchLib} for this branch?`, `Yes`, `No`).then(answer => {
                            if (answer === `Yes`) {
                              const escapedText = currentBranch.replace(/'/g, `''`);
                              connection.runCommand({ command: `CRTLIB LIB(${newBranchLib}) TEXT('${escapedText}') TYPE(*TEST)`, noLibList: true })
                                .then(() => {
                                  window.showInformationMessage(`Library ${newBranchLib} created. Use '&BRANCHLIB' as a reference to it.`);
                                })
                                .catch(err => {
                                  window.showErrorMessage(`Error creating library ${newBranchLib}: ${err.message}`);
                                })
                            }
                          });
                        }
                      })
                    }
                  }
                }

                lastBranch[workspaceUri] = currentBranch;
              }
            }
          }
        }));
      }
    }
  }
}