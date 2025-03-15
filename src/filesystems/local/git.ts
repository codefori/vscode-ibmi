import { ExtensionContext, WorkspaceFolder, commands, window } from "vscode";
import { getBranchLibraryName } from "./env";
import { instance } from "../../instantiate";
import IBMi from "../../api/IBMi";
import IBMiContent from "../../api/IBMiContent";
import { VscodeTools } from "../../ui/Tools";
import { ConnectionConfig } from "../../typings";

const lastBranch: { [workspaceUri: string]: string } = {};

export function getGitBranch(workspaceFolder: WorkspaceFolder) {
  const gitApi = VscodeTools.getGitAPI();
  if (gitApi) {
    const repo = gitApi.getRepository(workspaceFolder.uri);
    if (repo) {
      return repo.state.HEAD?.name;
    }
  }
}

export function setupGitEventHandler(context: ExtensionContext) {
  const gitApi = VscodeTools.getGitAPI();

  if (gitApi) {
    gitApi.onDidOpenRepository((repo) => {
      const workspaceUri = repo.rootUri.toString();

      const changeEvent = repo.state.onDidChange((_e) => {
        if (IBMi.connectionManager.get(`createLibraryOnBranchChange`)) {
          if (repo) {
            const head = repo.state.HEAD;
            const connection = instance.getConnection();
            if (head && head.name) {
              const currentBranch = head.name;

              if (currentBranch && currentBranch !== lastBranch[workspaceUri]) {
                if (connection) {
                  const content = connection.getContent();
                  const config = connection.getConfig();

                  if (currentBranch.includes(`/`)) {
                    setupBranchLibrary(currentBranch, content, connection, config);
                  }
                }
              }

              lastBranch[workspaceUri] = currentBranch;
            }
          }
        }
      });

      context.subscriptions.push(changeEvent);
    });
  }
}

function setupBranchLibrary(currentBranch: string, content: IBMiContent, connection: IBMi, config: ConnectionConfig) {
  const filters = config.objectFilters;
  const newBranchLib = getBranchLibraryName(currentBranch);
  content.checkObject({ library: `QSYS`, name: newBranchLib, type: `*LIB` }).then(exists => {
    if (exists) {
      if (!filters.some(filter => filter.library.toUpperCase() === newBranchLib)) {
        window.showInformationMessage(`The branch library ${newBranchLib} exists for this branch. Do you want to create a filter?`, `Yes`, `No`).then(answer => {
          if (answer === `Yes`) {
            filters.push({
              name: currentBranch,
              filterType: `simple`,
              library: newBranchLib,
              object: `*ALL`,
              types: [`*ALL`],
              member: `*`,
              memberType: `*`,
              protected: false
            });

            config.objectFilters = filters;
            IBMi.connectionManager.update(config).then(() => {
              commands.executeCommand(`code-for-ibmi.refreshObjectBrowser`);
            });
          }
        });
      }
    } else {
      window.showInformationMessage(`Would you like to create a new library ${newBranchLib} for this branch?`, `Yes`, `No`).then(answer => {
        if (answer === `Yes`) {
          const escapedText = currentBranch.replace(/'/g, `''`);
          connection.runCommand({ command: `CRTLIB LIB(${newBranchLib}) TEXT('${escapedText}') TYPE(*TEST)`, noLibList: true })
            .then((createResult) => {
              if (createResult && createResult.code === 0) {
                window.showInformationMessage(`Library ${newBranchLib} created. Use '&BRANCHLIB' as a reference to it.`, `Create filter`).then(answer => {
                  if (answer === `Create filter`) {
                    filters.push({
                      name: currentBranch,
                      filterType: `simple`,
                      library: newBranchLib,
                      object: `*ALL`,
                      types: [`*ALL`],
                      member: `*`,
                      memberType: `*`,
                      protected: false
                    });
  
                    config.objectFilters = filters;
                    IBMi.connectionManager.update(config).then(() => {
                      commands.executeCommand(`code-for-ibmi.refreshObjectBrowser`);
                    });
                  }
                });
              } else {
                window.showErrorMessage(`Error creating library ${newBranchLib}: ${createResult ? createResult.stderr : `Unknown error`}`);
              }
            });
        }
      });
    }
  });
}
