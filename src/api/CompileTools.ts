
import path from 'path';
import vscode, { CustomExecution, EventEmitter, Pseudoterminal, TaskGroup, TaskRevealKind, WorkspaceFolder, commands, tasks } from 'vscode';
import { parseFSOptions } from '../filesystems/qsys/QSysFs';
import { Action, BrowserItem, CommandResult, DeploymentMethod, RemoteCommand, StandardIO } from '../typings';
import { GlobalConfiguration } from './Configuration';
import { CustomUI } from './CustomUI';
import IBMi from './IBMi';
import Instance from './Instance';
import { Tools } from './Tools';
import { EvfEventInfo, refreshDiagnosticsFromLocal, refreshDiagnosticsFromServer, registerDiagnostics } from './errors/diagnostics';
import { DeployTools } from './local/deployTools';
import { getBranchLibraryName, getEnvConfig } from './local/env';
import { getGitBranch } from './local/git';

const NEWLINE = `\r\n`;

export interface ILELibrarySettings {
  currentLibrary: string;
  libraryList: string[];
}

export namespace CompileTools {
  type Variable = Record<string, string>;

  interface CommandObject {
    object: string
    library?: string
  }

  const PARM_REGEX = /(PNLGRP|OBJ|PGM|MODULE)\((?<object>.+?)\)/;

  const actionUsed: Map<string, number> = new Map;

  export function register(context: vscode.ExtensionContext) {
    context.subscriptions.push(
      ...registerDiagnostics()
    );
  }

  function expandVariables(variables: Variable) {
    for (const key in variables) {
      for (const key2 in variables) {
        if (key !== key2) { // Do not expand one self
          variables[key] = variables[key].replace(new RegExp(key2, `g`), variables[key2]);
        }
      }
    }
  }

  function expandCommand(inputValue: string, variables: Variable, currentVar?: string) {
    for (const key in variables) {
      if (variables[key]) {
        inputValue = inputValue.replace(new RegExp(key, `g`), variables[key]);
      }
    };

    return inputValue;
  }

  function applyDefaultVariables(connection: IBMi, variables: Variable) {
    const config = connection.getConfig();
    variables[`&BUILDLIB`] = variables[`CURLIB`] || config.currentLibrary;
    if (!variables[`&CURLIB`]) variables[`&CURLIB`] = config.currentLibrary;
    if (!variables[`\\*CURLIB`]) variables[`\\*CURLIB`] = config.currentLibrary;
    variables[`&USERNAME`] = connection.currentUser;
    variables[`{usrprf}`] = connection.currentUser;
    variables[`&HOST`] = connection.currentHost;
    variables[`{host}`] = connection.currentHost;
    variables[`&HOME`] = config.homeDirectory;
    variables[`&WORKDIR`] = config.homeDirectory;

    for (const variable of config.customVariables) {
      variables[`&${variable.name.toUpperCase()}`] = variable.value;
    }
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
    
      if(!workspaceFolder) {
        workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
      }
      let remoteCwd = config?.homeDirectory || `.`;

      let availableActions: { label: string; action: Action; }[] = [];
      if (!customAction) {
        // First we grab a copy the predefined Actions in the VS Code settings
        const allActions = [...GlobalConfiguration.get<Action[]>(`actions`) || []];

        // Then, if we're being called from a local file
        // we fetch the Actions defined from the workspace.
        if (workspaceFolder && uri.scheme === `file`) {
          const localActions = await connection.getConfigFile<Action[]>(`actions`).get(workspaceFolder);
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

          const variables: Variable = {};
          const evfeventInfo: EvfEventInfo = {
            object: '',
            library: '',
            extension,
            workspace: fromWorkspace
          };

          if (workspaceFolder) {
            const envFileVars = await getEnvConfig(workspaceFolder);
            Object.entries(envFileVars).forEach(([key, value]) => variables[`&${key}`] = value);
          }

          switch (chosenAction.type) {
            case `member`:
              const memberDetail = connection.parserMemberPath(uri.path);
              evfeventInfo.library = memberDetail.library;
              evfeventInfo.object = memberDetail.name;
              evfeventInfo.extension = memberDetail.extension;
              evfeventInfo.asp = memberDetail.asp;

              variables[`&OPENLIBL`] =  memberDetail.library.toLowerCase();
              variables[`&OPENLIB`] =  memberDetail.library;

              variables[`&OPENSPFL`] =  memberDetail.file.toLowerCase();
              variables[`&OPENSPF`] =  memberDetail.file;

              variables[`&OPENMBRL`] =  memberDetail.name.toLowerCase();
              variables[`&OPENMBR`] =  memberDetail.name;

              variables[`&EXTL`] =  memberDetail.extension.toLowerCase();
              variables[`&EXT`] =  memberDetail.extension;
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

              if (variables[`&CURLIB`]) {
                evfeventInfo.library = variables[`&CURLIB`];

              } else {
                evfeventInfo.library = config.currentLibrary;
              }

              evfeventInfo.library = evfeventInfo.library.toUpperCase();
              evfeventInfo.object = name.toUpperCase();
              evfeventInfo.extension = ext;

              if (chosenAction.command.includes(`&SRCFILE`)) {
                variables[`&SRCLIB`] = evfeventInfo.library;
                variables[`&SRCPF`] = `QTMPSRC`;
                variables[`&SRCFILE`] =  `${evfeventInfo.library}/QTMPSRC`;
              }

              switch (chosenAction.type) {
                case `file`:
                  variables[`&LOCALPATH`] = uri.fsPath;
                  if (fromWorkspace) {
                    const relativePath = path.relative(fromWorkspace.uri.path, uri.path).split(path.sep).join(path.posix.sep);
                    variables[`&RELATIVEPATH`] =  relativePath;

                    // We need to make sure the remote path is posix
                    const fullPath = path.posix.join(remoteCwd, relativePath);
                    variables[`&FULLPATH`] =  fullPath;
                    variables[`{path}`] = fullPath;
                    variables[`&WORKDIR`] = remoteCwd;
                    variables[`&FILEDIR`] =  path.posix.parse(fullPath).dir;

                    const branch = getGitBranch(fromWorkspace);
                    if (branch) {
                      variables[`&BRANCHLIB`] = getBranchLibraryName(branch);
                      variables[`&BRANCH`] =  branch;
                      variables[`{branch}`] = branch;
                    }
                  }
                  break;

                case `streamfile`:
                  const relativePath = path.posix.relative(remoteCwd, uri.path);
                  variables[`&RELATIVEPATH`] =  relativePath;

                  const fullName = uri.path;
                  variables[`&FULLPATH`] =  fullName;
                  variables[`&FILEDIR`] =  path.parse(fullName).dir;
                  break;
              }

              variables[`&PARENT`] =  parent;

              variables[`&BASENAME`] =  basename;
              variables[`{filename}`] = basename;

              variables[`&NAMEL`] =  name.toLowerCase();
              variables[`&NAME`] =  name;

              variables[`&EXTL`] =  extension.toLowerCase();
              variables[`&EXT`] =  extension;
              break;

            case `object`:
              const [_, library, fullName] = uri.path.toUpperCase().split(`/`);
              const object = fullName.substring(0, fullName.lastIndexOf(`.`));

              evfeventInfo.library = library;
              evfeventInfo.object = object;

              variables[`&LIBRARYL`] =  library.toLowerCase();
              variables[`&LIBRARY`] =  library;

              variables[`&NAMEL`] =  object.toLowerCase();
              variables[`&NAME`] =  object;

              variables[`&TYPEL`] =  extension.toLowerCase();
              variables[`&TYPE`] =  extension;

              variables[`&EXTL`] =  extension.toLowerCase();
              variables[`&EXT`] =  extension;
              break;
          }

          const viewControl = GlobalConfiguration.get<string>(`postActionView`) || "none";
          const outputBuffer: string[] = [];
          let actionName = chosenAction.name;
          let hasRun = false;

          const exitCode = await new Promise<number>(resolve =>
            tasks.executeTask({
              isBackground: true,
              name: chosenAction.name,
              definition: { type: `ibmi` },
              scope: workspaceFolder,
              source: 'IBM i',
              presentationOptions: {
                showReuseMessage: true,
                clear: GlobalConfiguration.get<boolean>(`clearOutputEveryTime`),
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
                      writeEmitter.fire(`Running Action: ${chosenAction.name} (${new Date().toLocaleTimeString()})` + NEWLINE);

                      // If &SRCFILE is set, we need to copy the file to a temporary source file from the IFS
                      if (variables[`&FULLPATH`] && variables[`&SRCFILE`] && evfeventInfo.object) {
                        const [lib, srcpf] = variables[`&SRCFILE`].split(`/`);

                        const createSourceFile = content.toCl(`CRTSRCPF`, {
                          rcdlen: 112, //NICE: this configurable in a VS Code setting?
                          file: `${lib}/${srcpf}`,
                        });

                        const copyFromStreamfile = content.toCl(`CPYFRMSTMF`, {
                          fromstmf: variables[`&FULLPATH`],
                          tombr: `'${Tools.qualifyPath(lib, srcpf, evfeventInfo.object)}'`,
                          mbropt: `*REPLACE`,
                          dbfccsid: `*FILE`,
                          stmfccsid: 1208,
                        });
 
                        // We don't care if this fails. Usually it's because the source file already exists.
                        await runCommand(connection, {command: createSourceFile, environment: `ile`, noLibList: true});

                        // Attempt to copy to member
                        const copyResult = await runCommand(connection, {command: copyFromStreamfile, environment: `ile`, noLibList: true});

                        if (copyResult.code !== 0) {
                          writeEmitter.fire(`Failed to copy file to a temporary member.\n\t${copyResult.stderr}\n\n`);
                          closeEmitter.fire(copyResult.code || 1);
                        }
                      }

                      const commandResult = await runCommand(connection, {
                        title: chosenAction.name,
                        environment,
                        command: chosenAction.command,
                        cwd: remoteCwd,
                        env: variables,
                      }, writeEmitter);

                      const useLocalEvfevent = 
                        fromWorkspace && chosenAction.postDownload && 
                        (chosenAction.postDownload.includes(`.evfevent`) || chosenAction.postDownload.includes(`.evfevent/`));

                      if (commandResult) {
                        hasRun = true;
                        const isIleCommand = environment === `ile`;

                        const possibleObject = getObjectFromCommand(commandResult.command);
                        if (isIleCommand && possibleObject) {
                          Object.assign(evfeventInfo, possibleObject);
                        }

                        actionName = (isIleCommand && possibleObject ? `${chosenAction.name} for ${evfeventInfo.library}/${evfeventInfo.object}` : actionName);
                        successful = (commandResult.code === 0 || commandResult.code === null);

                        writeEmitter.fire(NEWLINE);

                        if (useLocalEvfevent) {
                          writeEmitter.fire(`Fetching errors from .evfevent.${NEWLINE}`);

                        }
                        else if (evfeventInfo.object && evfeventInfo.library) {
                          if (chosenAction.command.includes(`*EVENTF`)) {
                            writeEmitter.fire(`Fetching errors for ${evfeventInfo.library}/${evfeventInfo.object}.` + NEWLINE);
                            refreshDiagnosticsFromServer(instance, evfeventInfo);
                            problemsFetched = true;
                          } else {
                            writeEmitter.fire(`*EVENTF not found in command string. Not fetching errors for ${evfeventInfo.library}/${evfeventInfo.object}.` + NEWLINE);
                          }
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

                    } catch (e) {
                      writeEmitter.fire(`${e}\n`);
                      vscode.window.showErrorMessage(`Action ${chosenAction} for ${evfeventInfo.library}/${evfeventInfo.object} failed. (internal error).`);
                      closeEmitter.fire(1);
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

  /**
   * Execute a command
   */
  export async function runCommand(connection: IBMi, options: RemoteCommand, writeEvent?: EventEmitter<string>): Promise<CommandResult> {
    const config = connection.getConfig();
    if (config && connection) {
      const cwd = options.cwd;
      const variables = options.env || {};

      applyDefaultVariables(connection, variables);
      expandVariables(variables);

      const ileSetup: ILELibrarySettings = {
        currentLibrary: variables[`&CURLIB`] || config.currentLibrary,
        libraryList: variables[`&LIBL`]?.split(` `) || config.libraryList,
      };
      // Remove any duplicates from the library list
      ileSetup.libraryList = ileSetup.libraryList.filter(Tools.distinct);

      const libraryList = buildLibraryList(ileSetup);
      variables[`&LIBLS`] = libraryList.join(` `);

      let commandString = expandCommand(
        options.command,
        variables
      );

      if (commandString) {
        const commands = commandString.split(`\n`).filter(command => command.trim().length > 0);
        const promptedCommands = [];
        for (let command of commands) {
          if (command.startsWith(`?`)) {
            command = await vscode.window.showInputBox({ prompt: `Run Command`, value: command.substring(1) }) || '';
          } else {
            command = await showCustomInputs(`Run Command`, command, options.title || `Command`);
          }
          promptedCommands.push(command);
          if (!command) break;
        }
        commandString = !promptedCommands.includes(``) ? promptedCommands.join(`\n`) : ``;
      }

      if (commandString) {
        const commands = commandString.split(`\n`).filter(command => command.trim().length > 0);

        if (writeEvent) {
          if (options.environment === `ile` && !options.noLibList) {
            writeEvent.fire(`Current library: ` + ileSetup.currentLibrary + NEWLINE);
            writeEvent.fire(`Library list: ` + ileSetup.libraryList.join(` `) + NEWLINE);
          }
          if (options.cwd) {
            writeEvent.fire(`Working directory: ` + options.cwd + NEWLINE);
          }
          writeEvent.fire(`Commands:\n${commands.map(command => `\t${command}\n`).join(``)}` + NEWLINE);
        }

        const callbacks: StandardIO = writeEvent ? {
          onStdout: (data) => {
            writeEvent.fire(data.toString().replaceAll(`\n`, NEWLINE));
          },
          onStderr: (data) => {
            writeEvent.fire(data.toString().replaceAll(`\n`, NEWLINE));
          }
        } : {};

        let commandResult;
        switch (options.environment) {
          case `pase`:
            // We build environment variables for the environment to be ready
            const paseVars: Variable = {};

            // Append any variables passed into the API
            Object.entries(variables).forEach(([key, value]) => {
              if ((/^[A-Za-z\&]/i).test(key)) {
                paseVars[key.startsWith('&') ? key.substring(1) : key] = value;
              }
            });

            commandResult = await connection.sendCommand({
              command: commands.join(` && `),
              directory: cwd,
              env: paseVars,
              ...callbacks
            });
            break;

          case `qsh`:
            commandResult = await connection.sendQsh({
              command: [
                ...options.noLibList? [] : buildLiblistCommands(connection, ileSetup),
                ...commands,
              ].join(` && `),
              directory: cwd,
              ...callbacks
            });
            break;

          case `ile`:
          default:
            // escape $ and # in commands
            commandResult = await connection.sendQsh({
              command: [
                ...options.noLibList? [] : buildLiblistCommands(connection, ileSetup),
                ...commands.map(command =>
                  `${`system "${IBMi.escapeForShell(command)}"`}`,
                )
              ].join(` && `),
              directory: cwd,
              ...callbacks
            });
            break;
        }

        commandResult.command = commandString;
        return commandResult;
      }
    }
    else {
      throw new Error("Please connect to an IBM i");
    }

    return {
      code: 1,
      command: options.command,
      stdout: ``,
      stderr: `Command execution failed. (Internal)`,
    };
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

  function buildLibraryList(config: ILELibrarySettings): string[] {
    //We have to reverse it because `liblist -a` adds the next item to the top always 
    return config.libraryList.slice(0).reverse();
  }

  function buildLiblistCommands(connection: IBMi, config: ILELibrarySettings): string[] {
    return [
      `liblist -d ${IBMi.escapeForShell(Tools.sanitizeObjNamesForPase(connection.defaultUserLibraries).join(` `))}`,
      `liblist -c ${IBMi.escapeForShell(Tools.sanitizeObjNamesForPase([config.currentLibrary])[0])}`,
      `liblist -a ${IBMi.escapeForShell(Tools.sanitizeObjNamesForPase(buildLibraryList(config)).join(` `))}`
    ];
  }
}
