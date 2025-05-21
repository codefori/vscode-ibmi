import path from 'path';
import vscode, { CustomExecution, Pseudoterminal, TaskGroup, TaskRevealKind, WorkspaceFolder, commands, l10n, tasks } from 'vscode';
import { CompileTools } from '../api/CompileTools';
import IBMi from '../api/IBMi';
import { Tools } from '../api/Tools';
import { Variables } from '../api/variables';
import { getLocalActions } from '../filesystems/local/actions';
import { DeployTools } from '../filesystems/local/deployTools';
import { getBranchLibraryName, getEnvConfig } from '../filesystems/local/env';
import { getGitBranch } from '../filesystems/local/git';
import { parseFSOptions } from '../filesystems/qsys/QSysFs';
import Instance from '../Instance';
import { Action, DeploymentMethod } from '../typings';
import { CustomUI, TreeListItem } from '../webviews/CustomUI';
import { EvfEventInfo, refreshDiagnosticsFromLocal, refreshDiagnosticsFromServer, registerDiagnostics } from './diagnostics';

import { BrowserItem } from './types';

type CommandObject = {
  object: string
  library?: string
}

type ActionTarget = {
  uri: vscode.Uri
  extension: string
  fragment: string
  protected: boolean
  workspaceFolder: vscode.WorkspaceFolder
  executionOK: boolean,
  hasRun: boolean,
  processed: boolean,
  output: string[]
}

const actionUsed: Map<string, number> = new Map;
const PARM_REGEX = /(PNLGRP|OBJ|PGM|MODULE)\((?<object>.+?)\)/;

export function registerActionTools(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    ...registerDiagnostics()
  );
}

export async function runAction(instance: Instance, uris: vscode.Uri | vscode.Uri[], customAction?: Action, method?: DeploymentMethod, browserItems?: BrowserItem[], workspaceFolder?: WorkspaceFolder): Promise<boolean> {
  uris = Array.isArray(uris) ? uris : [uris];
  //Global scheme: all URIs share the same
  const scheme = uris[0].scheme;
  if (!uris.every(uri => uri.scheme === scheme)) {
    vscode.window.showWarningMessage(l10n.t("Actions can't be run on multiple items of different natures. ({0})", uris.map(uri => uri.scheme).filter(Tools.distinct).join(", ")));
    return false;
  }

  const connection = instance.getConnection();
  if (connection) {
    const config = connection.getConfig();
    const content = connection.getContent();

    const targets = uris.map(uri => ({
      uri,
      extension: uri.path.substring(uri.path.lastIndexOf(`.`) + 1).toUpperCase(),
      fragment: uri.fragment.toUpperCase(),
      protected: parseFSOptions(uri).readonly || config?.readOnlyMode,
      workspaceFolder: workspaceFolder || vscode.workspace.getWorkspaceFolder(uri),
      executionOK: false,
      hasRun: false,
      processed: false,
      output: []
    }) as ActionTarget);

    workspaceFolder = targets[0].workspaceFolder;
    if (!targets.every(target => target.workspaceFolder === workspaceFolder)) {
      vscode.window.showErrorMessage(l10n.t("Actions can only be run on files from the same workspace"));
      return false;
    }

    let remoteCwd = config?.homeDirectory || `.`;

    let availableActions: { label: string; action: Action; }[] = [];
    if (!customAction) {
      // First we grab a copy the predefined Actions in the VS Code settings
      const allActions = [...IBMi.connectionManager.get<Action[]>(`actions`) || []];

      // Then, if we're being called from a local file
      // we fetch the Actions defined from the workspace.
      if (targets[0].workspaceFolder && scheme === `file`) {
        const localActions = await getLocalActions(targets[0].workspaceFolder);
        allActions.push(...localActions);
      }

      // We make sure all extensions are uppercase
      allActions.forEach(action => {
        if (action.extensions) {
          action.extensions = action.extensions.map(ext => ext.toUpperCase());
        };
      });

      // Then we get all the available Actions for the current context
      availableActions = allActions.filter(action => action.type === scheme)
        .filter(action => !action.extensions || action.extensions.every(e => !e) || targets.every(t => action.extensions!.includes(t.extension) || action.extensions!.includes(t.fragment)) || action.extensions.includes(`GLOBAL`))
        .filter(action => action.runOnProtected || !targets.some(t => t.protected))
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

        const fromWorkspace = (chosenAction.type === `file` && vscode.workspace.workspaceFolders) ? vscode.workspace.workspaceFolders[workspaceId || 0] : undefined;
        const envFileVars = workspaceFolder ? await getEnvConfig(workspaceFolder) : {};

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

        let cancelled = false;

        //Prompt once now in case of multiple targets
        const promptOnce = targets.length > 1;
        const command = promptOnce ? await commandConfirm(chosenAction.command) : chosenAction.command;

        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, cancellable: true, title: l10n.t("Running action {0} on", chosenAction.name, targets.length) }, async (task, canceled) => {
          const increment = 100 / targets.length;
          let done = 1;
          for (const target of targets) {
            if (canceled.isCancellationRequested) {
              cancelled = true;
              return;
            }

            target.processed = true;
            const variables = new Variables(connection);
            if (target.workspaceFolder) {
              for (const [key, value] of Object.entries(await getEnvConfig(target.workspaceFolder))) {
                variables.set(`&${key}`, value)
              }
            }

            Object.entries(envFileVars).forEach(([key, value]) => variables.set(`&${key}`, value));
            const evfeventInfo: EvfEventInfo = {
              object: '',
              library: '',
              extension: target.extension,
              workspace: fromWorkspace
            };

            let processedPath = "";
            switch (chosenAction.type) {
              case `member`:
                const memberDetail = connection.parserMemberPath(target.uri.path);
                evfeventInfo.library = memberDetail.library;
                evfeventInfo.object = memberDetail.name;
                evfeventInfo.extension = memberDetail.extension;
                evfeventInfo.asp = memberDetail.asp;

                processedPath = `${memberDetail.library}/${memberDetail.file}/${memberDetail.basename}`;

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
                processedPath = target.uri.path;

                const pathData = path.parse(target.uri.path);
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
                    variables.set(`&LOCALPATH`, target.uri.fsPath);
                    if (fromWorkspace) {
                      const relativePath = path.relative(fromWorkspace.uri.path, target.uri.path).split(path.sep).join(path.posix.sep);
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
                    const relativePath = path.posix.relative(remoteCwd, target.uri.path);
                    const fullName = target.uri.path;
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

                  .set(`&EXTL`, target.extension.toLowerCase())
                  .set(`&EXT`, target.extension);
                break;

              case `object`:
                const [_, library, fullName] = connection.upperCaseName(target.uri.path).split(`/`);
                const object = fullName.substring(0, fullName.lastIndexOf(`.`));

                evfeventInfo.library = library;
                evfeventInfo.object = object;

                processedPath = `${library}/${object}.${target.extension}`;

                variables.set(`&LIBRARYL`, library.toLowerCase())
                  .set(`&LIBRARY`, library)

                  .set(`&NAMEL`, object.toLowerCase())
                  .set(`&NAME`, object)

                  .set(`&TYPEL`, target.extension.toLowerCase())
                  .set(`&TYPE`, target.extension)

                  .set(`&EXTL`, target.extension.toLowerCase())
                  .set(`&EXT`, target.extension);
                break;
            }

            task.report({ message: `${processedPath} (${done++}/${targets.length})`, increment })

            const viewControl = IBMi.connectionManager.get<string>(`postActionView`) || "none";
            let actionName = chosenAction.name;

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

                  writeEmitter.event(s => target.output.push(s));
                  closeEmitter.event(resolve);

                  const term: Pseudoterminal = {
                    onDidWrite: writeEmitter.event,
                    onDidClose: closeEmitter.event,
                    open: async () => {
                      let successful = false;
                      let problemsFetched = false;

                      try {
                        writeEmitter.fire(`Running Action: ${chosenAction.name} (${new Date().toLocaleTimeString()})` + CompileTools.NEWLINE);

                        // If &SRCFILE is set, we need to copy the file to a temporary source file from the IFS
                        const fullPath = variables.get(`&FULLPATH`);
                        const srcFile = variables.get(`&SRCFILE`);
                        if (fullPath && srcFile && evfeventInfo.object) {
                          const [lib, srcpf] = srcFile.split(`/`);

                          const createSourceFile = content.toCl(`CRTSRCPF`, {
                            rcdlen: 112, //NICE: this configurable in a VS Code setting?
                            file: `${lib}/${srcpf}`,
                          });

                          const copyFromStreamfile = content.toCl(`CPYFRMSTMF`, {
                            fromstmf: fullPath,
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
                            command,
                            cwd: remoteCwd,
                            env: variables,
                          }, {
                          writeEvent: (content) => writeEmitter.fire(content),
                          commandConfirm: promptOnce ? undefined : commandConfirm
                        }
                        );

                        if (commandResult && commandResult.code !== CompileTools.DID_NOT_RUN) {
                          target.hasRun = true;
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

                          if (chosenAction.outputToFile) {
                            await outputToFile(connection, chosenAction.outputToFile, variables, target.output);
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
                                .then(async () => {
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

            target.executionOK = (exitCode === 0);

            if (target.hasRun && target.executionOK && target.executionOK) {
              doRefresh(chosenAction, browserItems?.find(item => item.resourceUri?.path === target.uri.path));
            }
          }
        });

        const openOutputAction = l10n.t("Open output(s)");
        let uiPromise;
        if (cancelled) {
          uiPromise = vscode.window.showWarningMessage(l10n.t(`Action {0} was cancelled; ({1} processed).`, chosenAction.name, targets.filter(target => target.processed).length), openOutputAction);
        }
        else if (targets.every(target => target.executionOK)) {
          uiPromise = vscode.window.showInformationMessage(l10n.t(`Action {0} was successful.`, chosenAction.name), openOutputAction);
        }
        else {
          uiPromise = vscode.window.showErrorMessage(l10n.t(`Action {0} was not successful ({1}/{2} failed).`, chosenAction.name, targets.filter(target => !target.executionOK).length, targets.length), openOutputAction);
        }

        uiPromise.then(openOutput => {
          if (openOutput) {
            const now = new Date();
            const resultsPanel = new CustomUI();
            if (targets.length === 1) {
              resultsPanel.addParagraph(`<pre><code>${targets[0].output.join("")}</code></pre>`)
                .setOptions({ fullPage: true });
            }
            else {
              resultsPanel.addBrowser("results", targets.filter(target => target.processed).map(target => ({ label: `${getTargetResultIcon(target)} ${path.basename(target.uri.path)}`, value: `<pre><code>${target.output.join("")}</code></pre>` } as TreeListItem)))
                .setOptions({
                  fullPage: true,
                  css: /* css */ `
                  body{
                    margin: 0;
                    padding: 0;
                    overflow: hidden;
                  }

                  pre {
                    margin: 1em;
                  }                  
                `
                });
            }
            resultsPanel.loadPage(`${chosenAction.name} [${now.toLocaleString()}]`);
          }
        })
      }
      return targets.every(target => target.executionOK);
    }
    else {
      vscode.window.showErrorMessage(l10n.t(`No suitable actions found for {0} - {1}`, scheme, targets.map(t => t.extension).filter(Tools.distinct).join(", ")));
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

function doRefresh(chosenAction: Action, browserItem?: BrowserItem) {
  if (browserItem) {
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
}

function getTargetResultIcon(target: ActionTarget) {
  if (target.hasRun) {
    return target.executionOK ? '✔️' : '❌';
  }
  else {
    return '❔';
  }
}

async function outputToFile(connection: IBMi, outputPattern: string, variables: Variables, output: string[]) {
  const outputPath = variables.expand(outputPattern);
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
  await connection.getContent().writeStreamfileRaw(actualPath, output.join(""));
}