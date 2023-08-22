
import path from 'path';
import vscode, { WorkspaceFolder, window } from 'vscode';
import { GlobalConfiguration } from './Configuration';
import { CustomUI } from './CustomUI';
import { getLocalActions } from './local/actions';
import { getEnvConfig } from './local/env';
import { parseFSOptions } from '../filesystems/qsys/QSysFs';
import { instance } from '../instantiate';
import { Action, CommandResult, DeploymentMethod, RemoteCommand, StandardIO } from '../typings';
import IBMi from './IBMi';
import Instance from './Instance';
import { Tools } from './Tools';
import { EvfEventInfo, refreshDiagnosticsFromLocal, refreshDiagnosticsFromServer, registerDiagnostics } from './errors/diagnostics';
import { DeployTools } from './local/deployTools';

export interface ILELibrarySettings {
  currentLibrary: string;
  libraryList: string[];
}

export namespace CompileTools {
  type Variables = Map<string, string>

  interface CommandObject {
    object: string
    library?: string
  }

  const PARM_REGEX = /(PNLGRP|OBJ|PGM|MODULE)\((?<object>.+?)\)/;
  const OUTPUT_BUTTON_BASE = `$(three-bars) Output`;
  const OUTPUT_BUTTON_RUNNING = `$(sync~spin) Output`;

  const outputChannel = vscode.window.createOutputChannel(`IBM i Output`);
  const outputBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);

  const actionUsed: Map<string, number> = new Map;

  export function register(context: vscode.ExtensionContext) {
    outputBarItem.text = OUTPUT_BUTTON_BASE;
    outputBarItem.command = outputBarItem.command = {
      command: `code-for-ibmi.showOutputPanel`,
      title: `Show IBM i Output`,
    };

    context.subscriptions.push(
      ...registerDiagnostics(),
      outputChannel,
      outputBarItem,
      vscode.commands.registerCommand(`code-for-ibmi.showOutputPanel`, showOutput)
    );

    instance.onEvent("connected", () => {
      if (GlobalConfiguration.get<boolean>(`logCompileOutput`)) {
        outputBarItem.show();
      }
    });

    instance.onEvent("disconnected", () => {
      outputBarItem.hide();
    });
  }

  function replaceValues(string: string, variables: Variables) {
    variables.forEach((value, key) => {
      if (value) {
        string = string.replace(new RegExp(key, `g`), value);
      }
    });

    return string;
  }

  function getDefaultVariables(instance: Instance, librarySettings: ILELibrarySettings): Variables {
    const variables: Variables = new Map;

    const connection = instance.getConnection();
    const config = instance.getConfig();
    if (connection && config) {
      variables.set(`&BUILDLIB`, librarySettings ? librarySettings.currentLibrary : config.currentLibrary);
      variables.set(`&CURLIB`, librarySettings ? librarySettings.currentLibrary : config.currentLibrary);
      variables.set(`\\*CURLIB`, librarySettings ? librarySettings.currentLibrary : config.currentLibrary);
      variables.set(`&USERNAME`, connection.currentUser);
      variables.set(`{usrprf}`, connection.currentUser);
      variables.set(`&HOME`, config.homeDirectory);

      const libraryList = buildLibraryList(librarySettings);
      variables.set(`&LIBLS`, libraryList.join(` `));

      for (const variable of config.customVariables) {
        variables.set(`&${variable.name.toUpperCase()}`, variable.value);
      }
    }

    return variables;
  }

  export async function runAction(instance: Instance, uri: vscode.Uri, customAction?: Action, method?: DeploymentMethod) {
    const connection = instance.getConnection();
    const config = instance.getConfig();
    const content = instance.getContent();

    const uriOptions = parseFSOptions(uri);

    if (uriOptions.readonly) {
      window.showWarningMessage(`Cannot run Actions against readonly objects.`);
      return;
    }

    if (config?.readOnlyMode) {
      window.showWarningMessage(`Cannot run Actions while readonly mode is enabled in the connection settings.`);
      return;
    }

    const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);

    if (connection && config && content) {
      const extension = uri.path.substring(uri.path.lastIndexOf(`.`) + 1).toUpperCase();
      const fragment = uri.fragment.toUpperCase();

      let availableActions: { label: string; action: Action; }[] = [];
      if (!customAction) {
        // First we grab a copy the predefined Actions in the VS Code settings
        const allActions = [...GlobalConfiguration.get<Action[]>(`actions`) || []];

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
        availableActions = allActions.filter(action => action.type === uri.scheme && (!action.extensions || action.extensions.includes(extension) || action.extensions.includes(fragment) || action.extensions.includes(`GLOBAL`)))
          .sort((a, b) => (actionUsed.get(b.name) || 0) - (actionUsed.get(a.name) || 0))
          .map(action => ({
            label: action.name,
            action
          }));
      }

      if (customAction || availableActions.length) {
        if (GlobalConfiguration.get<boolean>(`clearOutputEveryTime`)) {
          outputChannel.clear();
        }

        const chosenAction = customAction || ((availableActions.length === 1) ? availableActions[0] : await vscode.window.showQuickPick(availableActions))?.action;
        if (chosenAction) {
          actionUsed.set(chosenAction.name, Date.now());
          const environment = chosenAction.environment || `ile`;

          let workspaceId: number | undefined = undefined;
          if (workspaceFolder && chosenAction.type === `file` && chosenAction.deployFirst) {
            const deployResult = await DeployTools.launchDeploy(workspaceFolder.index, method);
            if (deployResult !== undefined) {
              workspaceId = deployResult;
            } else {
              vscode.window.showWarningMessage(`Action "${chosenAction.name}" was cancelled.`);
              return;
            }
          }

          let fromWorkspace: WorkspaceFolder|undefined;

          if (chosenAction.type === `file` && vscode.workspace.workspaceFolders) {
            fromWorkspace = vscode.workspace.workspaceFolders[workspaceId || 0];
          }

          const variables: Variables = new Map;
          const evfeventInfo: EvfEventInfo = {
            object: '',
            library: '',
            extension,
            workspace: fromWorkspace
          };

          if (workspaceFolder) {
            const envFileVars = await getEnvConfig(workspaceFolder);
            Object.entries(envFileVars).forEach(([key, value]) => variables.set(`&${key}`, value));
          }

          switch (chosenAction.type) {
            case `member`:
              const memberDetail = connection.parserMemberPath(uri.path);
              evfeventInfo.library = memberDetail.library;
              evfeventInfo.object = memberDetail.name;
              evfeventInfo.extension = memberDetail.extension;
              evfeventInfo.asp = memberDetail.asp;

              variables.set(`&OPENLIBL`, memberDetail.library.toLowerCase());
              variables.set(`&OPENLIB`, memberDetail.library);

              variables.set(`&OPENSPFL`, memberDetail.file.toLowerCase());
              variables.set(`&OPENSPF`, memberDetail.file);

              variables.set(`&OPENMBRL`, memberDetail.name.toLowerCase());
              variables.set(`&OPENMBR`, memberDetail.name);

              variables.set(`&EXTL`, memberDetail.extension.toLowerCase());
              variables.set(`&EXT`, memberDetail.extension);
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

              if (variables.has(`&CURLIB`)) {
                evfeventInfo.library = variables.get(`&CURLIB`)!;

              } else {
                evfeventInfo.library = config.currentLibrary;
              }

              evfeventInfo.object = name;
              evfeventInfo.extension = ext;

              let relativePath;
              let fullPath

              switch (chosenAction.type) {
                case `file`:
                  variables.set(`&LOCALPATH`, uri.fsPath);

                  let baseDir = config.homeDirectory;

                  if (fromWorkspace) {
                    baseDir = fromWorkspace.uri.path;

                    relativePath = path.posix.relative(baseDir, uri.path).split(path.sep).join(path.posix.sep);
                    variables.set(`&RELATIVEPATH`, relativePath);

                    // We need to make sure the remote path is posix
                    fullPath = path.posix.join(config.homeDirectory, relativePath).split(path.sep).join(path.posix.sep);
                    variables.set(`&FULLPATH`, fullPath);
                    variables.set(`{path}`, fullPath);

                    try {
                      const gitApi = Tools.getGitAPI();
                      if (gitApi && gitApi.repositories?.length) {
                        const repo = gitApi.repositories[0];
                        const branch = repo.state.HEAD?.name;

                        if (branch) {
                          variables.set(`&BRANCH`, branch);
                          variables.set(`{branch}`, branch);
                        }
                      }
                    } catch (e) {
                      outputChannel.appendLine(`Error occurred while getting branch name: ${e}`);
                    }
                  }
                  break;

                case `streamfile`:
                  relativePath = path.posix.relative(config.homeDirectory, uri.fsPath).split(path.sep).join(path.posix.sep);
                  variables.set(`&RELATIVEPATH`, relativePath);

                  const fullName = uri.path;
                  variables.set(`&FULLPATH`, fullName);
                  break;
              }

              variables.set(`&PARENT`, parent);

              variables.set(`&BASENAME`, basename);
              variables.set(`{filename}`, basename);

              variables.set(`&NAMEL`, name.toLowerCase());
              variables.set(`&NAME`, name);

              variables.set(`&EXTL`, extension.toLowerCase());
              variables.set(`&EXT`, extension);
              break;

            case `object`:
              const [_, library, fullName] = uri.path.toUpperCase().split(`/`);
              const object = fullName.substring(0, fullName.lastIndexOf(`.`));

              evfeventInfo.library = library;
              evfeventInfo.object = object;

              variables.set(`&LIBRARYL`, library.toLowerCase());
              variables.set(`&LIBRARY`, library);

              variables.set(`&NAMEL`, object.toLowerCase());
              variables.set(`&NAME`, object);

              variables.set(`&TYPEL`, extension.toLowerCase());
              variables.set(`&TYPE`, extension);

              variables.set(`&EXTL`, extension.toLowerCase());
              variables.set(`&EXT`, extension);
              break;
          }

          outputBarItem.text = OUTPUT_BUTTON_RUNNING;

          const command = replaceValues(chosenAction.command, variables);
          try {
            const commandResult = await runCommand(instance, {
              environment,
              command,
              env: Object.fromEntries(variables)
            },
              chosenAction.name);

            const useLocalEvfevent = fromWorkspace && chosenAction.postDownload && chosenAction.postDownload.includes(`.evfevent`);

            if (commandResult) {
              const isIleCommand = environment === `ile`;

              if (isIleCommand) {
                const possibleObject = getObjectFromCommand(commandResult.command);
                if (possibleObject) {
                  Object.assign(evfeventInfo, possibleObject);
                }
              }

              const actionName = (isIleCommand ? `${chosenAction.name} for ${evfeventInfo.library}/${evfeventInfo.object}` : chosenAction.name);

              if (commandResult.code === 0 || commandResult.code === null) {
                vscode.window.showInformationMessage(`Action ${actionName} was successful.`);
              } else {
                vscode.window.showErrorMessage(
                  `Action ${actionName} was not successful.`,
                  GlobalConfiguration.get<boolean>(`logCompileOutput`) ? `Show Output` : ''
                ).then(async (item) => {
                  if (item === `Show Output`) {
                    showOutput();
                  }
                });
              }

              outputChannel.append(`\n`);

              if (useLocalEvfevent) {
                outputChannel.appendLine(`Fetching errors from .evfevent.`);

              }
              else if (isIleCommand) {
                if (command.includes(`*EVENTF`)) {
                  outputChannel.appendLine(`Fetching errors for ${evfeventInfo.library}/${evfeventInfo.object}.`);
                  refreshDiagnosticsFromServer(instance, evfeventInfo);
                } else {
                  outputChannel.appendLine(`*EVENTF not found in command string. Not fetching errors for ${evfeventInfo.library}/${evfeventInfo.object}.`);
                }
              }
            }

            if (chosenAction.type === `file` && chosenAction.postDownload?.length) {
              if (fromWorkspace) {
                const client = connection.client;
                const remoteDir = config.homeDirectory;
                const localDir = fromWorkspace.uri.path;

                // First, we need to create or clear the relative directories in the workspace
                // in case they don't exist. For example, if the path is `.logs/joblog.json`
                // then we would need to create `.logs`.
                const downloadDirectories = chosenAction.postDownload.map(path.parse)
                  .map(pathInfo => pathInfo.dir || pathInfo.base) //Get directories or files' parent directory
                  .filter(Tools.distinct) //Remove duplicates
                  .map(downloadDirectory => vscode.Uri.parse((path.posix.join(localDir, downloadDirectory)))); //Create local Uri path

                for (const downloadPath of downloadDirectories) {
                  try {
                    const stat = await vscode.workspace.fs.stat(downloadPath); //Check if target exists
                    if (stat.type !== vscode.FileType.Directory) {
                      if (await vscode.window.showWarningMessage(`${downloadPath} exists but is a file.`, "Delete and create directory")) {
                        await vscode.workspace.fs.delete(downloadPath);
                        throw new Error("Create directory");
                      }
                    }
                    else if (stat.type !== vscode.FileType.Directory) {
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
                    }
                  }
                }

                // Then we download the files that is specified.
                const downloads = chosenAction.postDownload.map(
                  async (downloadPath) => {
                    const localPath = vscode.Uri.parse(path.posix.join(localDir, downloadPath)).fsPath;
                    const remotePath = path.posix.join(remoteDir, downloadPath);

                    if (await content.isDirectory(remotePath)) {
                      return client.getDirectory(localPath, remotePath);
                    } else {
                      return client.getFile(localPath, remotePath);
                    }
                  }
                );

                Promise.all(downloads)
                  .then(async result => {
                    // Done!
                    outputChannel.appendLine(`Downloaded files as part of Action: ${chosenAction.postDownload!.join(`, `)}`);

                    // Process locally downloaded evfevent files:
                    if (useLocalEvfevent) {
                      refreshDiagnosticsFromLocal(instance, evfeventInfo);
                    }
                  })
                  .catch(error => {
                    vscode.window.showErrorMessage(`Failed to download files as part of Action.`);
                    outputChannel.appendLine(`Failed to download a file after Action: ${error.message}`);
                  });
              }
            }

          } catch (e) {
            outputChannel.appendLine(`${e}`);
            vscode.window.showErrorMessage(`Action ${chosenAction} for ${evfeventInfo.library}/${evfeventInfo.object} failed. (internal error).`);
          }

          outputBarItem.text = OUTPUT_BUTTON_BASE;
        }

      } else {
        //No compile commands
        vscode.window.showErrorMessage(`No compile commands found for ${uri.scheme}-${extension}.`);
      }
    }
    else {
      throw new Error("Please connect to an IBM i first")
    }
  }

  /**
   * Execute a command
   */
  export async function runCommand(instance: Instance, options: RemoteCommand, title?: string): Promise<CommandResult | null> {
    const connection = instance.getConnection();
    const config = instance.getConfig();
    if (config && connection) {
      const cwd = options.cwd;

      let ileSetup: ILELibrarySettings = {
        currentLibrary: config.currentLibrary,
        libraryList: config.libraryList,
      };

      if (options.env) {
        const libl: string | undefined = options.env[`&LIBL`];
        const curlib: string | undefined = options.env[`&CURLIB`];
        
        if (libl) ileSetup.libraryList = libl.split(` `);
        if (curlib) ileSetup.currentLibrary = curlib;
      }

      let commandString = replaceValues(
        options.command,
        getDefaultVariables(instance, ileSetup)
      );

      if (commandString) {
        const commands = commandString.split(`\n`).filter(command => command.trim().length > 0);
        const promptedCommands = [];
        for (let command of commands) {
          if (command.startsWith(`?`)) {
            command = await vscode.window.showInputBox({ prompt: `Run Command`, value: command.substring(1) }) || '';
          } else {
            command = await showCustomInputs(`Run Command`, command, title);
          }
          promptedCommands.push(command);
          if (!command) break;
        }
        commandString = !promptedCommands.includes(``) ? promptedCommands.join(`\n`) : ``;
      }

      if (commandString) {
        const commands = commandString.split(`\n`).filter(command => command.trim().length > 0);

        outputChannel.append(`\n\n`);
        if (options.environment === `ile`) {
          outputChannel.append(`Current library: ` + ileSetup.currentLibrary + `\n`);
          outputChannel.append(`Library list: ` + ileSetup.libraryList.join(` `) + `\n`);
        }
        outputChannel.append(`Commands:\n${commands.map(command => `\t\t${command}\n`).join(``)}\n`);

        const callbacks: StandardIO = {
          onStdout: (data) => {
            outputChannel.append(data.toString());
          },
          onStderr: (data) => {
            outputChannel.append(data.toString());
          }
        }

        let commandResult;
        switch (options.environment) {
          case `pase`:
            // We build environment variables for the environment to be ready
            const paseVars: Variables = new Map;

            // Get default variable
            getDefaultVariables(instance, ileSetup).forEach((value: string, key: string) => {
              if ((/^[A-Za-z\&]/i).test(key)) {
                paseVars.set(key.startsWith('&') ? key.substring(1) : key, value);
              }
            });

            // Append any variables passed into the API
            Object.entries(options.env || {}).forEach(([key, value]) => {
              if ((/^[A-Za-z\&]/i).test(key)) {
                paseVars.set(key.startsWith('&') ? key.substring(1) : key, value);
              }
            });

            commandResult = await connection.sendCommand({
              command: commands.join(` && `),
              directory: cwd,
              env: Object.fromEntries(paseVars),
              ...callbacks
            });
            break;

          case `qsh`:
            commandResult = await connection.sendQsh({
              command: [
                ...buildLiblistCommands(connection, ileSetup),
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
                ...buildLiblistCommands(connection, ileSetup),
                ...commands.map(command =>
                  `${`system ${GlobalConfiguration.get(`logCompileOutput`) ? `` : `-s`} "${command.replace(/[$]/g, `\\$&`)}"; if [[ $? -ne 0 ]]; then exit 1; fi`}`,
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

    return null;
  }

  function showOutput() {
    outputChannel.show();
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
    return config.libraryList
      .map(library => {
        //We use this for special variables in the libl
        switch (library) {
          case `&BUILDLIB`:
          case `&CURLIB`:
            return config.currentLibrary;
          default: return library;
        }
      }).reverse();
  }

  function buildLiblistCommands(connection: IBMi, config: ILELibrarySettings): string[] {
    return [
      `liblist -d ${connection.defaultUserLibraries.join(` `).replace(/\$/g, `\\$`)}`,
      `liblist -c ${config.currentLibrary.replace(/\$/g, `\\$`)}`,
      `liblist -a ${buildLibraryList(config).join(` `).replace(/\$/g, `\\$`)}`
    ];
  }
}
