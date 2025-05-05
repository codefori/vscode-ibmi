
import path from 'path';
import { getLocalActions } from '../filesystems/local/actions';
import { DeployTools } from '../filesystems/local/deployTools';
import { getBranchLibraryName, getEnvConfig } from '../filesystems/local/env';
import { getGitBranch } from '../filesystems/local/git';
import { parseFSOptions } from '../filesystems/qsys/QSysFs';
import Instance from '../Instance';
import { Action, DeploymentMethod } from '../typings';
import { EvfEventInfo, refreshDiagnosticsFromLocal, refreshDiagnosticsFromServer, registerDiagnostics } from './diagnostics';

import vscode, { CustomExecution, Pseudoterminal, TaskGroup, TaskRevealKind, WorkspaceFolder, commands, tasks } from 'vscode';
import { CompileTools } from '../api/CompileTools';
import IBMi from '../api/IBMi';
import { Tools } from '../api/Tools';
import { Variables } from '../api/variables';
import { CustomUI } from '../webviews/CustomUI';
import { BrowserItem } from './types';

interface CommandObject {
  object: string
  library?: string
}

const actionUsed: Map<string, number> = new Map;
const PARM_REGEX = /(PNLGRP|OBJ|PGM|MODULE)\((?<object>.+?)\)/;

export function registerActionTools(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    ...registerDiagnostics()
  );
}

export async function runAction(instance: Instance, uri: vscode.Uri, customAction?: Action, method?: DeploymentMethod, browserItem?: BrowserItem, workspaceFolder?: WorkspaceFolder): Promise<boolean> {
  const connection = instance.getConnection();

  const uriOptions = parseFSOptions(uri);
  if (connection) {
    const config = connection.getConfig();
    const content = connection.getContent();

    const extension = uri.path.substring(uri.path.lastIndexOf(`.`) + 1).toUpperCase();
    const fragment = uri.fragment.toUpperCase();

    const isProtected = uriOptions.readonly || config?.readOnlyMode;

    if (!workspaceFolder) {
      workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
    }
    let remoteCwd = config?.homeDirectory || `.`;

    let availableActions: { label: string; action: Action; }[] = [];
    if (!customAction) {
      // First we grab a copy the predefined Actions in the VS Code settings
      const allActions = [...IBMi.connectionManager.get<Action[]>(`actions`) || []];

      // Then, if we're being called from a local file
      // we fetch the Actions defined from the workspace.
      if (workspaceFolder && uri.scheme === `file`) {
        const localActions = await getLocalActions(workspaceFolder);
        allActions.push(...localActions);
      }

      // We make sure all extensions are uppercase
      allActions.forEach(action => {
        if (action.extensions) {
          action.extensions = action.extensions.map(ext => ext.toUpperCase());
        };
      });

      // Then we get all the available Actions for the current context
      availableActions = allActions.filter(action => action.type === uri.scheme && (!action.extensions || action.extensions.includes(extension) || action.extensions.includes(fragment) || action.extensions.includes(`GLOBAL`)) && (!isProtected || action.runOnProtected))
        .sort((a, b) => (actionUsed.get(b.name) || 0) - (actionUsed.get(a.name) || 0))
        .map(action => ({
          label: action.name,
          action
        }));
    }

    if (customAction || availableActions.length) {
      const chosenAction = customAction || ((availableActions.length === 1) ? availableActions[0] : await vscode.window.showQuickPick(availableActions))?.action;
      if (chosenAction) {
        actionUsed.set(chosenAction.name, Date.now());
        const environment = chosenAction.environment || `ile`;

        let workspaceId: number | undefined = undefined;

        // If we are running an Action for a local file, we need a deploy directory even if they are not
        // deploying the file. This is because we need to know the relative path of the file to the deploy directory.
        if (workspaceFolder && chosenAction.type === `file`) {
          if (chosenAction.deployFirst) {
            const deployResult = await DeployTools.launchDeploy(workspaceFolder.index, method);
            if (deployResult !== undefined) {
              workspaceId = deployResult.workspaceId;
              remoteCwd = deployResult.remoteDirectory;
            } else {
              vscode.window.showWarningMessage(`Action "${chosenAction.name}" was cancelled.`);
              return false;
            }
          } else {
            workspaceId = workspaceFolder.index;
            const deployPath = DeployTools.getRemoteDeployDirectory(workspaceFolder);
            if (deployPath) {
              remoteCwd = deployPath;
            } else {
              vscode.window.showWarningMessage(`No deploy directory setup for this workspace. Cancelling Action.`);
              return false;
            }
          }
        }

        let fromWorkspace: WorkspaceFolder | undefined;

        if (chosenAction.type === `file` && vscode.workspace.workspaceFolders) {
          fromWorkspace = vscode.workspace.workspaceFolders[workspaceId || 0];
        }

        const variables = new Variables(connection);
        const evfeventInfo: EvfEventInfo = {
          object: '',
          library: '',
          extension,
          workspace: fromWorkspace
        };

        if (workspaceFolder) {
          for (const [key, value] of Object.entries(await getEnvConfig(workspaceFolder))) {
            variables.set(`&${key}`, value)
          }
        }

        switch (chosenAction.type) {
          case `member`:
            const memberDetail = connection.parserMemberPath(uri.path);
            evfeventInfo.library = memberDetail.library;
            evfeventInfo.object = memberDetail.name;
            evfeventInfo.extension = memberDetail.extension;
            evfeventInfo.asp = memberDetail.asp;

            variables.set(`&OPENLIBL`, memberDetail.library.toLowerCase())
              .set(`&OPENLIB`, memberDetail.library)

              .set(`&OPENSPFL`, memberDetail.file.toLowerCase())
              .set(`&OPENSPF`, memberDetail.file)

              .set(`&OPENMBRL`, memberDetail.name.toLowerCase())
              .set(`&OPENMBR`, memberDetail.name)

              .set(`&EXTL`, memberDetail.extension.toLowerCase())
              .set(`&EXT`, memberDetail.extension);
            break;

          case `file`:
          case `streamfile`:
            const pathData = path.parse(uri.path);
            const basename = pathData.base;
            const ext = pathData.ext ? (pathData.ext.startsWith(`.`) ? pathData.ext.substring(1) : pathData.ext) : ``;
            const parent = path.parse(pathData.dir).base;
            let name = pathData.name;

            // Logic to handle second extension, caused by bob.
            const bobTypes = [`.PGM`, `.SRVPGM`];
            const secondName = path.parse(name);
            if (secondName.ext && bobTypes.includes(secondName.ext.toUpperCase())) {
              name = secondName.name;
            }

            // Remove bob text convention
            if (name.includes(`-`)) {
              name = name.substring(0, name.indexOf(`-`));
            }

            evfeventInfo.library = connection.upperCaseName(variables.get(`&CURLIB`) || config.currentLibrary);
            evfeventInfo.object = connection.upperCaseName(name);
            evfeventInfo.extension = ext;

            if (chosenAction.command.includes(`&SRCFILE`)) {
              variables.set(`&SRCLIB`, evfeventInfo.library)
                .set(`&SRCPF`, `QTMPSRC`)
                .set(`&SRCFILE`, `${evfeventInfo.library}/QTMPSRC`);
            }

            switch (chosenAction.type) {
              case `file`:
                variables.set(`&LOCALPATH`, uri.fsPath);
                if (fromWorkspace) {
                  const relativePath = path.relative(fromWorkspace.uri.path, uri.path).split(path.sep).join(path.posix.sep);
                  // We need to make sure the remote path is posix
                  const fullPath = path.posix.join(remoteCwd, relativePath);
                  variables.set(`&RELATIVEPATH`, relativePath)
                    .set(`&FULLPATH`, fullPath)
                    .set(`{path}`, fullPath)
                    .set(`&WORKDIR`, remoteCwd)
                    .set(`&FILEDIR`, path.posix.parse(fullPath).dir);

                  const branch = getGitBranch(fromWorkspace);
                  if (branch) {
                    variables.set(`&BRANCHLIB`, getBranchLibraryName(branch))
                      .set(`&BRANCH`, branch)
                      .set(`{branch}`, branch);
                  }
                }
                break;

              case `streamfile`:
                const relativePath = path.posix.relative(remoteCwd, uri.path);
                const fullName = uri.path;
                variables.set(`&RELATIVEPATH`, relativePath)
                  .set(`&FULLPATH`, fullName)
                  .set(`&FILEDIR`, path.parse(fullName).dir);
                break;
            }

            variables.set(`&PARENT`, parent)
              .set(`&BASENAME`, basename)
              .set(`{filename}`, basename)

              .set(`&NAMEL`, name.toLowerCase())
              .set(`&NAME`, name)

              .set(`&EXTL`, extension.toLowerCase())
              .set(`&EXT`, extension);
            break;

          case `object`:
            const [_, library, fullName] = uri.path.toUpperCase().split(`/`);
            const object = fullName.substring(0, fullName.lastIndexOf(`.`));

            evfeventInfo.library = library;
            evfeventInfo.object = object;

            variables.set(`&LIBRARYL`, library.toLowerCase())
              .set(`&LIBRARY`, library)

              .set(`&NAMEL`, object.toLowerCase())
              .set(`&NAME`, object)

              .set(`&TYPEL`, extension.toLowerCase())
              .set(`&TYPE`, extension)

              .set(`&EXTL`, extension.toLowerCase())
              .set(`&EXT`, extension);
            break;
        }

        const viewControl = IBMi.connectionManager.get<string>(`postActionView`) || "none";
        const outputBuffer: string[] = [];
        let actionName = chosenAction.name;
        let hasRun = false;

        const commandConfirm = async (commandString: string): Promise<string> => {
          const commands = commandString.split(`\n`).filter(command => command.trim().length > 0);
          const promptedCommands = [];
          for (let command of commands) {
            if (command.startsWith(`?`)) {
              command = await vscode.window.showInputBox({ prompt: `Run Command`, value: command.substring(1) }) || '';
            } else {
              command = await showCustomInputs(`Run Command`, command, chosenAction.name || `Command`);
            }
            promptedCommands.push(command);
            if (!command) break;
          }

          return !promptedCommands.includes(``) ? promptedCommands.join(`\n`) : ``;
        }

        const exitCode = await new Promise<number>(resolve =>
          tasks.executeTask({
            isBackground: true,
            name: chosenAction.name,
            definition: { type: `ibmi` },
            scope: workspaceFolder,
            source: 'IBM i',
            presentationOptions: {
              showReuseMessage: true,
              clear: IBMi.connectionManager.get<boolean>(`clearOutputEveryTime`),
              focus: false,
              reveal: (viewControl === `task` ? TaskRevealKind.Always : TaskRevealKind.Never),
            },
            problemMatchers: [],
            runOptions: {},
            group: TaskGroup.Build,
            execution: new CustomExecution(async (e) => {
              const writeEmitter = new vscode.EventEmitter<string>();
              const closeEmitter = new vscode.EventEmitter<number>();

              writeEmitter.event(s => outputBuffer.push(s));
              closeEmitter.event(resolve);

              const term: Pseudoterminal = {
                onDidWrite: writeEmitter.event,
                onDidClose: closeEmitter.event,
                open: async (initialDimensions: vscode.TerminalDimensions | undefined) => {
                  let successful = false;
                  let problemsFetched = false;

                  try {
                    writeEmitter.fire(`Running Action: ${chosenAction.name} (${new Date().toLocaleTimeString()})` + CompileTools.NEWLINE);

                    // If &SRCFILE is set, we need to copy the file to a temporary source file from the IFS
                    if (variables.has(`&FULLPATH`) && variables.has(`&SRCFILE`) && evfeventInfo.object) {
                      const [lib, srcpf] = variables.get(`&SRCFILE`)!.split(`/`);

                      const createSourceFile = content.toCl(`CRTSRCPF`, {
                        rcdlen: 112, //NICE: this configurable in a VS Code setting?
                        file: `${lib}/${srcpf}`,
                      });

                      const copyFromStreamfile = content.toCl(`CPYFRMSTMF`, {
                        fromstmf: variables.get(`&FULLPATH`),
                        tombr: `'${Tools.qualifyPath(lib, srcpf, evfeventInfo.object)}'`,
                        mbropt: `*REPLACE`,
                        dbfccsid: `*FILE`,
                        stmfccsid: 1208,
                      });

                      // We don't care if this fails. Usually it's because the source file already exists.
                      await CompileTools.runCommand(connection, { command: createSourceFile, environment: `ile`, noLibList: true });

                      // Attempt to copy to member
                      const copyResult = await CompileTools.runCommand(connection, { command: copyFromStreamfile, environment: `ile`, noLibList: true });

                      if (copyResult.code !== 0) {
                        writeEmitter.fire(`Failed to copy file to a temporary member.\n\t${copyResult.stderr}\n\n`);
                        closeEmitter.fire(copyResult.code || 1);
                      }
                    }

                    const commandResult = await CompileTools.runCommand(connection,
                      {
                        title: chosenAction.name,
                        environment,
                        command: chosenAction.command,
                        cwd: remoteCwd,
                        env: variables,
                      }, {
                      writeEvent: (content) => writeEmitter.fire(content),
                      commandConfirm
                    }
                    );

                    if (commandResult && commandResult.code !== CompileTools.DID_NOT_RUN) {
                      hasRun = true;
                      const isIleCommand = environment === `ile`;

                      const useLocalEvfevent =
                        fromWorkspace && chosenAction.postDownload &&
                        (chosenAction.postDownload.includes(`.evfevent`) || chosenAction.postDownload.includes(`.evfevent/`));

                      const possibleObject = getObjectFromCommand(commandResult.command);
                      if (isIleCommand && possibleObject) {
                        Object.assign(evfeventInfo, possibleObject);
                      }

                      actionName = (isIleCommand && possibleObject ? `${chosenAction.name} for ${evfeventInfo.library}/${evfeventInfo.object}` : actionName);
                      successful = (commandResult.code === 0 || commandResult.code === null);

                      writeEmitter.fire(CompileTools.NEWLINE);

                      if (useLocalEvfevent) {
                        writeEmitter.fire(`Fetching errors from .evfevent.${CompileTools.NEWLINE}`);

                      }
                      else if (evfeventInfo.object && evfeventInfo.library) {
                        if (chosenAction.command.includes(`*EVENTF`)) {
                          writeEmitter.fire(`Fetching errors for ${evfeventInfo.library}/${evfeventInfo.object}.` + CompileTools.NEWLINE);
                          refreshDiagnosticsFromServer(instance, evfeventInfo);
                          problemsFetched = true;
                        } else if (chosenAction.command.trimStart().toUpperCase().startsWith(`CRT`)) {
                          writeEmitter.fire(`*EVENTF not found in command string. Not fetching errors for ${evfeventInfo.library}/${evfeventInfo.object}.` + CompileTools.NEWLINE);
                        }
                      }

                      if (chosenAction.type === `file` && chosenAction.postDownload?.length) {
                        if (fromWorkspace) {
                          const remoteDir = remoteCwd;
                          const localDir = fromWorkspace.uri;

                          const postDownloads: { type: vscode.FileType, localPath: string, remotePath: string }[] = [];
                          const downloadDirectories = new Set<vscode.Uri>();
                          for (const download of chosenAction.postDownload) {
                            const remotePath = path.posix.join(remoteDir, download);
                            const localPath = vscode.Uri.joinPath(localDir, download).path;

                            let type: vscode.FileType;
                            if (await content.isDirectory(remotePath)) {
                              downloadDirectories.add(vscode.Uri.joinPath(localDir, download));
                              type = vscode.FileType.Directory;
                            }
                            else {
                              const directory = path.parse(download).dir;
                              if (directory) {
                                downloadDirectories.add(vscode.Uri.joinPath(localDir, directory));
                              }
                              type = vscode.FileType.File;
                            }

                            postDownloads.push({ remotePath, localPath, type })
                          }

                          //Clear and create every local download directories
                          for (const downloadPath of downloadDirectories) {
                            try {
                              const stat = await vscode.workspace.fs.stat(downloadPath); //Check if target exists
                              if (stat.type !== vscode.FileType.Directory) {
                                if (await vscode.window.showWarningMessage(`${downloadPath} exists but is a file.`, "Delete and create directory")) {
                                  await vscode.workspace.fs.delete(downloadPath);
                                  throw new Error("Create directory");
                                }
                              }
                              else if (stat.type === vscode.FileType.Directory) {
                                await vscode.workspace.fs.delete(downloadPath, { recursive: true });
                                throw new Error("Create directory");
                              }
                            }
                            catch (e) {
                              //Either fs.stat did not find the folder or it wasn't a folder and it's been deleted above
                              try {
                                await vscode.workspace.fs.createDirectory(downloadPath)
                              }
                              catch (error) {
                                vscode.window.showWarningMessage(`Failed to create download path ${downloadPath}: ${error}`);
                                console.log(error);
                                closeEmitter.fire(1);
                              }
                            }
                          }

                          // Then we download the files that is specified.
                          const downloads = postDownloads.map(
                            async (postDownload) => {
                              const content = connection.getContent();
                              if (postDownload.type === vscode.FileType.Directory) {
                                return content.downloadDirectory(postDownload.localPath, postDownload.remotePath, { recursive: true, concurrency: 5 });
                              } else {
                                return content.downloadFile(postDownload.localPath, postDownload.remotePath);
                              }
                            }
                          );

                          await Promise.all(downloads)
                            .then(async result => {
                              // Done!
                              writeEmitter.fire(`Downloaded files as part of Action: ${chosenAction.postDownload!.join(`, `)}\n`);

                              // Process locally downloaded evfevent files:
                              if (useLocalEvfevent) {
                                refreshDiagnosticsFromLocal(instance, evfeventInfo);
                                problemsFetched = true;
                              }
                            })
                            .catch(error => {
                              vscode.window.showErrorMessage(`Failed to download files as part of Action.`);
                              writeEmitter.fire(`Failed to download a file after Action: ${error.message}\n`);
                              closeEmitter.fire(1);
                            });
                        }
                      }

                      if (problemsFetched && viewControl === `problems`) {
                        commands.executeCommand(`workbench.action.problems.focus`);
                      }
                    } else {
                      writeEmitter.fire(`Command did not run.` + CompileTools.NEWLINE);
                    }

                  } catch (e) {
                    writeEmitter.fire(`${e}\n`);
                    vscode.window.showErrorMessage(`Action ${chosenAction} for ${evfeventInfo.library}/${evfeventInfo.object} failed. (internal error).`);
                    successful = false;
                  }

                  closeEmitter.fire(successful ? 0 : 1);
                },
                close: function (): void { }
              };

              return term;
            })
          })
        );

        const executionOK = (exitCode === 0);
        if (hasRun) {
          if (executionOK && browserItem) {
            switch (chosenAction.refresh) {
              case 'browser':
                if (chosenAction.type === 'streamfile') {
                  vscode.commands.executeCommand("code-for-ibmi.refreshIFSBrowser");
                }
                else if (chosenAction.type !== 'file') {
                  vscode.commands.executeCommand("code-for-ibmi.refreshObjectBrowser");
                }
                break;

              case 'filter':
                //Filter is a top level item so it has no parent (like Batman)
                let filter: BrowserItem = browserItem;
                while (filter.parent) {
                  filter = filter.parent;
                }
                filter.refresh?.();
                break;

              case 'parent':
                browserItem.parent?.refresh?.();
                break;

              default:
              //No refresh
            }
          }

          const openOutputAction = "Open output"; //TODO: will be translated in the future
          const uiPromise = executionOK ?
            vscode.window.showInformationMessage(`Action ${actionName} was successful.`, openOutputAction) :
            vscode.window.showErrorMessage(`Action ${actionName} was not successful.`, openOutputAction);

          uiPromise.then(openOutput => {
            if (openOutput) {
              const now = new Date();
              new CustomUI()
                .addParagraph(`<pre><code>${outputBuffer.join("")}</code></pre>`)
                .setOptions({ fullWidth: true })
                .loadPage(`${chosenAction.name} [${now.toLocaleString()}]`);
            }
          })
        }

        if (chosenAction.outputToFile) {
          const outputPath = variables.expand(chosenAction.outputToFile);
          let actualPath;
          if (outputPath.includes('&i')) {
            //Rolling output
            let count = 0;
            const generatePath = () => outputPath.replace("&i", `_${String(count++).padStart(3, "0")}`);
            while (await connection.getContent().testStreamFile((actualPath = generatePath()), "e"));

          }
          else {
            //Overwrite if output exists
            actualPath = outputPath;
          }
          //Replace ~ if needed
          if (actualPath.includes('~')) {
            actualPath = (await connection.sendCommand({ command: `echo ${actualPath}` })).stdout;
          }
          await connection.getContent().writeStreamfileRaw(actualPath, outputBuffer.join(""));
        }

        return executionOK;
      }
      else {
        return false;
      }
    } else if (isProtected) {
      //when a member is protected(read only)
      vscode.window.showErrorMessage(`Action cannot be applied on a read only member.`);
      return false;
    } else {
      //No compile commands
      vscode.window.showErrorMessage(`No compile commands found for ${uri.scheme}-${extension}.`);
      return false;
    }
  }
  else {
    throw new Error("Please connect to an IBM i first")
  }
}

function getObjectFromCommand(baseCommand?: string): CommandObject | undefined {
  if (baseCommand) {
    const regex = PARM_REGEX.exec(baseCommand.toUpperCase());
    if (regex) {
      const object = regex.groups?.object.split(`/`);
      if (object) {
        if (object.length === 2) {
          return {
            library: object[0],
            object: object[1]
          };
        } else {
          return {
            object: object[0]
          };
        }
      }
    }
  }
}


/**
 * @param  name action's name
 * @param command action's command string
 * @return the new command
 */
async function showCustomInputs(name: string, command: string, title?: string): Promise<string> {
  const components = [];
  let loop = true;

  let end = 0;
  while (loop) {
    const idx = command.indexOf(`\${`, end);

    if (idx >= 0) {
      const start = idx;
      end = command.indexOf(`}`, start);

      if (end >= 0) {
        let currentInput = command.substring(start + 2, end);

        const [name, label, initialValue] = currentInput.split(`|`);
        components.push({
          name,
          label,
          initialValue: initialValue || ``,
          start,
          end: end + 1
        });
      } else {
        loop = false;
      }
    } else {
      loop = false;
    }
  }

  if (components.length) {
    const commandUI = new CustomUI();

    if (title) {
      commandUI.addHeading(title, 2);
    }

    for (const component of components) {
      if (component.initialValue.includes(`,`)) {
        //Select box
        commandUI.addSelect(component.name, component.label, component.initialValue.split(`,`).map((value, index) => (
          {
            selected: index === 0,
            value,
            description: value,
            text: `Select ${value}`,
          }
        )));
      } else {
        //Input box
        commandUI.addInput(component.name, component.label, '', { default: component.initialValue });
      }
    }

    commandUI.addButtons({ id: `execute`, label: `Execute` }, { id: `cancel`, label: `Cancel` });

    const page = await commandUI.loadPage<any>(name);
    if (page) {
      page.panel.dispose();
      if (page.data && page.data.buttons !== `cancel`) {
        const dataEntries = Object.entries(page.data);
        for (const component of components.reverse()) {
          const value = dataEntries.find(([key]) => key === component.name)?.[1];
          command = command.substring(0, component.start) + value + command.substring(component.end);
        }
      } else {
        command = '';
      }
    }
  }

  return command;
}