
const vscode = require(`vscode`);
const path = require(`path`);

const gitExtension = vscode.extensions.getExtension(`vscode.git`).exports;

const errorHandlers = require(`./errors/index`);
const IBMi = require(`./IBMi`);
const Configuration = require(`./Configuration`);
const { CustomUI, Field } = require(`./CustomUI`);

const diagnosticSeverity = {
  0: vscode.DiagnosticSeverity.Information,
  10: vscode.DiagnosticSeverity.Information,
  20: vscode.DiagnosticSeverity.Warning,
  30: vscode.DiagnosticSeverity.Error,
  40: vscode.DiagnosticSeverity.Error,
  50: vscode.DiagnosticSeverity.Error
}

/** @type {vscode.DiagnosticCollection} */
let ileDiagnostics;

/** @type {vscode.OutputChannel} */
let outputChannel;

/** @type {vscode.StatusBarItem} */
let actionsBarItem;

/** @type {vscode.StatusBarItem} */
let outputBarItem;

const ACTION_BUTTON_BASE = `$(file-binary) Actions`;
const ACTION_BUTTON_RUNNING = `$(sync~spin) Actions`;

/** @type {{[key: string]: number}} Timestamp of when an action was last used. */
let actionUsed = {};

module.exports = class CompileTools {

  /**
   * @param {vscode.ExtensionContext} context
   */
  static register(context) {
    if (!ileDiagnostics) {
      ileDiagnostics = vscode.languages.createDiagnosticCollection(`ILE`);
      context.subscriptions.push(ileDiagnostics);
    }

    if (!outputChannel) {
      outputChannel = vscode.window.createOutputChannel(`IBM i Output`);
      context.subscriptions.push(outputChannel);
    }

    if (!actionsBarItem) {
      actionsBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
      actionsBarItem.command = {
        command: `code-for-ibmi.showActionsMaintenance`,
        title: `Show IBM i Actions`,
      };
      context.subscriptions.push(actionsBarItem);

      actionsBarItem.text = ACTION_BUTTON_BASE;
    }

    actionsBarItem.show();

    if (!outputBarItem) {
      vscode.commands.registerCommand(`code-for-ibmi.showOutputPanel`, () => {
        this.showOutput();
      })

      outputBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
      outputBarItem.command = {
        command: `code-for-ibmi.showOutputPanel`,
        title: `Show IBM i Output`,
      };
      context.subscriptions.push(outputBarItem);

      outputBarItem.text = `$(three-bars) Output`;
    }

    if (Configuration.get(`logCompileOutput`)) {
      outputBarItem.show();
    }
  }

  /**
   * Does what it says on the tin.
   */
  static clearDiagnostics() {
    ileDiagnostics.clear();
  }
  
  /**
   * @param {*} instance
   * @param {{asp?: string, lib: string, object: string, ext?: string, workspace?: number}} evfeventInfo
   */
  static async refreshDiagnostics(instance, evfeventInfo) {
    const content = instance.getContent();

    /** @type {Configuration} */
    const config = instance.getConfig();

    const tableData = await content.getTable(evfeventInfo.lib, `EVFEVENT`, evfeventInfo.object);
    const lines = tableData.map(row => row.EVFEVENT);

    const asp = evfeventInfo.asp ? `${evfeventInfo.asp}/` : ``;

    let errors;
    if (Configuration.get(`tryNewErrorParser`)) {
      errors = errorHandlers.new(lines);
    } else {
      errors = errorHandlers.old(lines);
    }

    ileDiagnostics.clear();

    /** @type {vscode.Diagnostic[]} */
    let diagnostics = [];

    /** @type {vscode.Diagnostic} */
    let diagnostic;

    if (Object.keys(errors).length > 0) {
      for (const file in errors) {
        diagnostics = [];
        
        for (const error of errors[file]) {

          error.column = Math.max(error.column-1, 0);
          error.linenum = Math.max(error.linenum-1, 0);

          if (error.column === 0 && error.toColumn === 0) {
            error.column = 0;
            error.toColumn = 100;
          }

          if (!config.hideCompileErrors.includes(error.code)) {
            diagnostic = new vscode.Diagnostic(
              new vscode.Range(error.linenum, error.column, error.linenum, error.toColumn),
              `${error.code}: ${error.text} (${error.sev})`,
              diagnosticSeverity[error.sev]
            );

            diagnostics.push(diagnostic);
          }
        }

        if (vscode.workspace && evfeventInfo.workspace !== undefined && evfeventInfo.workspace >= 0) {
          const baseInfo = path.parse(file);
          const parentInfo = path.parse(baseInfo.dir);

          let possibleFiles = await vscode.workspace.findFiles(`**/${parentInfo.name}/${baseInfo.name}*`);
          if (possibleFiles.length > 0) {
            ileDiagnostics.set(possibleFiles[0], diagnostics);
          } else {
            // Look in active text documents...
            const upperParent = parentInfo.name.toUpperCase();
            const upperName = baseInfo.name.toUpperCase();
            possibleFiles = vscode.workspace.textDocuments
              .filter(doc => doc.uri.scheme !== `git` && doc.uri.fsPath.toUpperCase().includes(`${upperParent}/${upperName}`))
              .map(doc => doc.uri);

            if (possibleFiles.length > 0) {
              ileDiagnostics.set(possibleFiles[0], diagnostics);
            }
          }
        } else {
          if (file.startsWith(`/`))
            ileDiagnostics.set(vscode.Uri.parse(`streamfile:${file}`), diagnostics);
          else
            ileDiagnostics.set(vscode.Uri.parse(`member:/${asp}${file}${evfeventInfo.ext ? `.` + evfeventInfo.ext : ``}`), diagnostics);
        }
      }

    } else {
      ileDiagnostics.clear();
    }
  }

  /**
   * 
   * @param {string} string 
   * @param {{[name: string]: string}} variables 
   */
  static replaceValues(string, variables) {
    Object.keys(variables).forEach(key => {
      if (variables[key])
        string = string.replace(new RegExp(key, `g`), variables[key]);
    })

    return string;
  }

  static getDefaultVariables(instance) {
    /** @type {IBMi} */
    const connection = instance.getConnection();

    /** @type {Configuration} */
    const config = instance.getConfig();
    
    /** @type {{[name: string]: string}} */
    const variables = {};

    variables[`&BUILDLIB`] = config.currentLibrary;
    variables[`&CURLIB`] = config.currentLibrary;
    variables[`\\*CURLIB`] = config.currentLibrary;
    variables[`&USERNAME`] = connection.currentUser;
    variables[`{usrprf}`] = connection.currentUser;
    variables[`&HOME`] = config.homeDirectory;

    //We have to reverse it because `liblist -a` adds the next item to the top always 
    let libl = config.libraryList.slice(0).reverse();

    libl = libl.map(library => {
      //We use this for special variables in the libl
      switch (library) {
      case `&BUILDLIB`:
      case `&CURLIB`: 
        return config.currentLibrary;
      default: return library;
      }
    });

    variables[`&LIBLC`] = libl.join(`,`);
    variables[`&LIBLS`] = libl.join(` `);

    for (const variable of config.customVariables) {
      variables[`&${variable.name.toUpperCase()}`] = variable.value;
    }

    return variables;
  }

  /**
   * @param {*} instance
   * @param {vscode.Uri} uri 
   */
  static async RunAction(instance, uri) {
    /** @type {{asp?: string, lib: string, object: string, ext?: string, workspace?: number}} */
    let evfeventInfo = {asp: undefined, lib: ``, object: ``, workspace: undefined};

    /** @type {IBMi} */
    const connection = instance.getConnection();

    /** @type {Configuration} */
    const config = instance.getConfig();

    const extension = uri.path.substring(uri.path.lastIndexOf(`.`)+1).toUpperCase();
    const fragement = uri.fragment.toUpperCase();

    const allActions = [];

    // First we grab the predefined Actions in the VS Code settings
    const allDefinedActions = Configuration.get(`actions`);
    allActions.push(...allDefinedActions);

    // Then, if we're being called from a local file
    // we fetch the Actions defined from the workspace.
    if (uri.scheme === `file`) {
      const [localActions, iProjActions] = await Promise.all([this.getLocalActions(), this.getiProjActions()]);
      allActions.push(...localActions, ...iProjActions);
    }

    // We make sure all extensions are uppercase
    allActions.forEach(action => {
      if (action.extensions) action.extensions = action.extensions.map(ext => ext.toUpperCase());
    });

    // Then we get all the available Actions for the current context
    /** @type {Action[]} */
    const availableActions = allActions.filter(action => action.type === uri.scheme && (action.extensions.includes(extension) || action.extensions.includes(fragement) || action.extensions.includes(`GLOBAL`)));

    if (availableActions.length > 0) {
      if (Configuration.get(`clearOutputEveryTime`)) {
        outputChannel.clear();
      }

      const options = availableActions.map(item => ({
        name: item.name,
        time: actionUsed[item.name] || 0
      })).sort((a, b) => b.time - a.time).map(item => item.name);
    
      let chosenOptionName, command, environment;
    
      if (options.length === 1) {
        chosenOptionName = options[0]
      } else {
        chosenOptionName = await vscode.window.showQuickPick(options);
      }
    
      if (chosenOptionName) {
        actionUsed[chosenOptionName] = Date.now();
        const action = availableActions.find(action => action.name === chosenOptionName);
        command = action.command;
        environment = action.environment || `ile`;

        if (action.type === `file` && action.deployFirst) {
          /** @type {number|false} */
          const deployResult = await vscode.commands.executeCommand(`code-for-ibmi.launchDeploy`);

          if (deployResult !== false) {
            evfeventInfo.workspace = deployResult;
          } else {
            vscode.window.showWarningMessage(`Action ${chosenOptionName} was cancelled.`);
            return;
          }
        }

        let basename, name, ext, parent;

        /** @type {{[name: string]: string}} */
        const variables = {};

        switch (action.type) {
        case `member`:
          const memberDetail = connection.parserMemberPath(uri.path);

          evfeventInfo = {
            asp: memberDetail.asp,
            lib: memberDetail.library,
            object: memberDetail.member,
            ext: memberDetail.extension
          };

          variables[`&OPENLIBL`] = memberDetail.library.toLowerCase();
          variables[`&OPENLIB`] = memberDetail.library;

          variables[`&OPENSPFL`] = memberDetail.file.toLowerCase();
          variables[`&OPENSPF`] = memberDetail.file;

          variables[`&OPENMBRL`] = memberDetail.member.toLowerCase();
          variables[`&OPENMBR`] = memberDetail.member;

          variables[`&EXTL`] = memberDetail.extension.toLowerCase();
          variables[`&EXT`] = memberDetail.extension;
          break;

        case `file`:
        case `streamfile`:
          const pathData = path.parse(uri.path);
          basename = pathData.base;
          name = pathData.name;
          ext = pathData.ext ? (pathData.ext.startsWith(`.`) ? pathData.ext.substring(1) : pathData.ext) : ``;
          parent = path.parse(pathData.dir).base;

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

          evfeventInfo = {
            ...evfeventInfo,
            asp: undefined,
            lib: config.currentLibrary,
            object: name,
            ext
          };

          let relativePath;
          let fullPath

          switch (action.type) {
          case `file`:
            variables[`&LOCALPATH`] = uri.fsPath;

            let baseDir = config.homeDirectory;
            let currentWorkspace;

            /** @type {vscode.WorkspaceFolder} *///@ts-ignore We know it's a number
            currentWorkspace = vscode.workspace.workspaceFolders[evfeventInfo.workspace || 0];

            if (currentWorkspace) {
              baseDir = currentWorkspace.uri.fsPath;
              
              relativePath = path.posix.relative(baseDir, uri.fsPath).split(path.sep).join(path.posix.sep);
              variables[`&RELATIVEPATH`] = relativePath;
  
              // We need to make sure the remote path is posix
              fullPath = path.posix.join(config.homeDirectory, relativePath).split(path.sep).join(path.posix.sep);
              variables[`&FULLPATH`] = fullPath;
              variables[`{path}`] = fullPath;

              try {
                const gitApi = gitExtension.getAPI(1);
                if (gitApi.repositories && gitApi.repositories.length > 0) {
                  const repo = await gitApi.repositories[0];
                  const branch = repo.state.HEAD.name;

                  variables[`&BRANCH`] = branch;
                  variables[`{branch}`] = branch;
                }
              } catch (e) {}
            }
            break;

          case `streamfile`:
            relativePath = path.posix.relative(config.homeDirectory, uri.fsPath).split(path.sep).join(path.posix.sep);
            variables[`&RELATIVEPATH`] = relativePath;

            const fullName = uri.path;
            variables[`&FULLPATH`] = fullName;
            break;
          }

          variables[`&PARENT`] = parent;

          variables[`&BASENAME`] = basename;
          variables[`{filename}`] = basename;

          variables[`&NAMEL`] = name.toLowerCase();
          variables[`&NAME`] = name;

          variables[`&EXTL`] = ext.toLowerCase();
          variables[`&EXT`] = ext;
          break;

        case `object`:
          const [_, lib, fullName] = uri.path.split(`/`);
          name = fullName.substring(0, fullName.lastIndexOf(`.`));

          evfeventInfo = {
            asp: undefined,
            lib,
            object: name,
            ext: extension
          };

          variables[`&LIBRARYL`] = lib.toLowerCase();
          variables[`&LIBRARY`] = lib;

          variables[`&NAMEL`] = name.toLowerCase();
          variables[`&NAME`] = name;

          variables[`&TYPEL`] = extension.toLowerCase();
          variables[`&TYPE`] = extension;

          variables[`&EXTL`] = extension.toLowerCase();
          variables[`&EXT`] = extension;
          break;
        }

        if (command) {
          /** @type {any} */
          let commandResult;
          let executed = false;

          actionsBarItem.text = ACTION_BUTTON_RUNNING;

          command = this.replaceValues(command, variables);

          try {
            commandResult = await this.runCommand(instance, {
              environment,
              command
            });

            if (commandResult) {
              command = commandResult.command;
              const possibleObject = this.getObjectFromCommand(command);

              if (possibleObject) {
                evfeventInfo = {
                  ...evfeventInfo,
                  ...possibleObject
                };
              }

              if (commandResult.code === 0 || commandResult.code === null) {
                executed = true;
                vscode.window.showInformationMessage(`Action ${chosenOptionName} for ${evfeventInfo.lib}/${evfeventInfo.object} was successful.`);
              
              } else {
                executed = false;
                vscode.window.showErrorMessage(
                  `Action ${chosenOptionName} for ${evfeventInfo.lib}/${evfeventInfo.object} was not successful.`,
                  Configuration.get(`logCompileOutput`) ? `Show Output` : undefined
                ).then(async (item) => {
                  if (item === `Show Output`) {
                    this.showOutput();
                  }
                });
              }

              outputChannel.append(`\n`);
              if (command.includes(`*EVENTF`)) {
                outputChannel.appendLine(`Fetching errors from ${evfeventInfo.lib}/${evfeventInfo.object}.`);
                this.refreshDiagnostics(instance, evfeventInfo);
              } else {
                outputChannel.appendLine(`*EVENTF not found in command string. Not fetching errors from ${evfeventInfo.lib}/${evfeventInfo.object}.`);
              }
            }

            if (action.type === `file` && action.postDownload && action.postDownload.length) {
              let currentWorkspace;

              /** @type {vscode.WorkspaceFolder} *///@ts-ignore We know it's a number
              currentWorkspace = vscode.workspace.workspaceFolders[evfeventInfo.workspace || 0];

              if (currentWorkspace) {
                const clinet = connection.client;
                const remoteDir = config.homeDirectory;
                const localDir = currentWorkspace.uri.fsPath;

                // First, we need to create the relative directories in the workspace
                // incase they don't exist. For example, if the path is `.logs/joblog.json`
                // then we would need to create `.logs`.
                try {
                  const directories = action.postDownload.map(downloadPath => {
                    const pathInfo = path.parse(downloadPath);
                    return vscode.workspace.fs.createDirectory(vscode.Uri.parse(path.join(localDir, pathInfo.dir)));
                  });

                  await Promise.all(directories);
                } catch (e) {
                  // We don't really care if it errors. The directories might already exist.
                }

                // Then we download the files that is specified.
                const downloads = action.postDownload.map(
                  downloadPath => clinet.getFile(path.join(localDir, downloadPath), path.posix.join(remoteDir, downloadPath))
                );

                Promise.all(downloads)
                  .then(result => {
                    // Done!
                    outputChannel.appendLine(`Downloaded files as part of Action: ${action.postDownload.join(`, `)}`);
                  })
                  .catch(error => {
                    vscode.window.showErrorMessage(`Failed to download files as part of Action.`);
                    outputChannel.appendLine(`Failed to download a file after Action: ${error.message}`);
                  });
              }
            }

          } catch (e) {
            outputChannel.append(`${e}\n`);
            executed = false;

            vscode.window.showErrorMessage(`Action ${chosenOptionName} for ${evfeventInfo.lib}/${evfeventInfo.object} failed. (internal error).`);
          }

          actionsBarItem.text = ACTION_BUTTON_BASE;

        }
      }

    } else {
      //No compile commands
      vscode.window.showErrorMessage(`No compile commands found for ${uri.scheme}-${extension}.`);
    }
  }

  /**
   * Execute command
   * @param {*} instance
   * @param {{environment?: "ile"|"qsh"|"pase", command: string, cwd?: string}} options 
   * @returns {Promise<{stdout: string, stderr: string, code?: number, command: string}|null>}
   */
  static async runCommand(instance, options) {
    /** @type {IBMi} */
    const connection = instance.getConnection();

    /** @type {Configuration} */
    const config = instance.getConfig();
    
    const cwd = options.cwd;
    let commandString = options.command;
    let commandResult;

    //We have to reverse it because `liblist -a` adds the next item to the top always 
    let libl = config.libraryList.slice(0).reverse();

    libl = libl.map(library => {
      //We use this for special variables in the libl
      switch (library) {
      case `&BUILDLIB`:
      case `&CURLIB`: 
        return config.currentLibrary;
      default: return library;
      }
    });

    commandString = this.replaceValues(
      commandString, 
      this.getDefaultVariables(instance)
    );

    if (commandString.startsWith(`?`)) {
      commandString = await vscode.window.showInputBox({prompt: `Run Command`, value: commandString.substring(1)})
    } else {
      commandString = await CompileTools.showCustomInputs(`Run Command`, commandString);
    }

    if (commandString) {

      const commands = commandString.split(`\n`).filter(command => command.trim().length > 0);

      outputChannel.append(`\n\n`);
      outputChannel.append(`Current library: ` + config.currentLibrary + `\n`);
      outputChannel.append(`Library list: ` + config.libraryList.join(` `) + `\n`);
      outputChannel.append(`Commands:\n${commands.map(command => `\t\t${command}\n`).join(``)}\n`);

      const callbacks = {
        /** @param {Buffer} data */
        onStdout: (data) => {
          outputChannel.append(data.toString());
        },
        /** @param {Buffer} data */
        onStderr: (data) => {
          outputChannel.append(data.toString());
        }
      }

      switch (options.environment) {
      case `pase`:
        commandResult = await connection.sendCommand({
          command: commands.join(` && `), 
          directory: cwd,
          ...callbacks
        });
        break;

      case `qsh`:
        commandResult = await connection.sendQsh({
          command: [
            `liblist -d ` + connection.defaultUserLibraries.join(` `),
            `liblist -c ` + config.currentLibrary,
            `liblist -a ` + libl.join(` `),
            ...commands,
          ],
          directory: cwd,
          ...callbacks
        });
        break;

      case `ile`:
      default:
        // escape $ and # in commands

        commandResult = await connection.sendQsh({
          command: [
            `liblist -d ` + connection.defaultUserLibraries.join(` `),
            `liblist -c ` + config.currentLibrary,
            `liblist -a ` + libl.join(` `),
            ...commands.map(command => 
              `${`system ${Configuration.get(`logCompileOutput`) ? `` : `-s`} "${command.replace(/[$]/g, `\\$&`)}"; if [[ $? -ne 0 ]]; then exit 1; fi`}`
            ),
          ],
          directory: cwd,
          ...callbacks
        });
        break;
      }

      //@ts-ignore We know it is an object
      commandResult.command = commandString;

      //@ts-ignore We know it is an object
      return commandResult;
    } else {
      return null;
    }
  }

  static showOutput() {
    outputChannel.show();
  }

  static appendOutput(output) {
    outputChannel.append(output);
  }

  /**
   * @param {string} name Name of action 
   * @param {string} command Command string
   * @return {Promise<string>} new command
   */
  static async showCustomInputs(name, command) {
    let loop = true, idx, start, end = 0, currentInput;

    let components = [];

    while (loop) {
      idx = command.indexOf(`\${`, end);

      if (idx >= 0) {
        start = idx;
        end = command.indexOf(`}`, start);

        if (end >= 0) {
          currentInput = command.substring(start+2, end);

          const [name, label, initalValue] = currentInput.split(`|`);
          components.push({
            name,
            label,
            initalValue: initalValue || ``,
            positions: [start, end+1]
          });
        } else {
          loop = false;
        }
      } else {
        loop = false;
      }
    }

    if (components.length > 0) {
      let commandUI = new CustomUI();
      let field;

      for (const component of components) {
        if (component.initalValue.includes(`,`)) {
          //Select box
          field = new Field(`select`, component.name, component.label);
          field.items = component.initalValue.split(`,`).map((value, index) => (
            {
              selected: index === 0,
              value,
              description: value,
              text: `Select ${value}`,
            }
          ));

        } else {
          //Input box
          field = new Field(`input`, component.name, component.label);
          field.default = component.initalValue;
        }

        commandUI.addField(field);

      }

      commandUI.addField(new Field(`submit`, `execute`, `Execute`));

      const {panel, data} = await commandUI.loadPage(name);

      panel.dispose();
      if (data) {
        for (const component of components.reverse()) {
          command = command.substring(0, component.positions[0]) + data[component.name] + command.substring(component.positions[1]);
        }
      } else {
        command = undefined;
      }

    }

    return command;
  }

  /**
   * 
   * @param {string} baseCommand 
   * @returns {{lib?: string, object: string}}
   */
  static getObjectFromCommand(baseCommand) {
    const parmRegex = /(PNLGRP|OBJ|PGM|MODULE)\((?<object>.+?)\)/;
    const command = baseCommand.toUpperCase();
    const regex = parmRegex.exec(command);

    if (regex) {
      const object = parmRegex.exec(command).groups.object.split(`/`);

      if (object.length === 2) {
        return {
          lib: object[0],
          object: object[1],
        };
      } else {
        return {
          object: object[0],
        };
      }
    }
  }

  /**
   * @returns {Promise<Action[]>}
   */
  static async getLocalActions() {
    const workspaces = vscode.workspace.workspaceFolders;
    const actions = [];

    if (workspaces && workspaces.length > 0) {
      const actionsFiles = await vscode.workspace.findFiles(`**/.vscode/actions.json`);

      for (const file of actionsFiles) {
        const actionsContent = await vscode.workspace.fs.readFile(file);
        try {
          /** @type {Action[]} */
          const actionsJson = JSON.parse(actionsContent.toString());

          // Maybe one day replace this with real schema validation
          if (Array.isArray(actionsJson)) {
            actionsJson.forEach((action, index) => {
              if (
                typeof action.name === `string` &&
                typeof action.command === `string` &&
                [`ile`, `pase`, `qsh`].includes(action.environment) &&
                Array.isArray(action.extensions)
              ) {
                actions.push({
                  ...action,
                  type: `file`
                });
              } else {
                throw new Error(`Invalid Action defined at index ${index}.`);
              }
            })
          }
        } catch (e) {
          // ignore
          this.appendOutput(`Error parsing ${file.fsPath}: ${e.message}\n`);
        }
      };
    }

    return actions;
  }

  /**
   * Gets actions from the `iproj.json` file
   * @returns {Promise<Action[]>}
   */
  static async getiProjActions() {
    const workspaces = vscode.workspace.workspaceFolders;

    /** @type {Action[]} */
    const actions = [];

    if (workspaces && workspaces.length > 0) {
      const iprojectFiles = await vscode.workspace.findFiles(`**/iproj.json`);

      for (const file of iprojectFiles) {
        const iProjectContent = await vscode.workspace.fs.readFile(file);
        try {
          const iProject = JSON.parse(iProjectContent.toString());

          const description = iProject.description || `iproj.json`

          if (iProject.buildCommand) {
            actions.push({
              name: `${description} (build)`,
              command: iProject.buildCommand,
              environment: `pase`,
              extensions: [`GLOBAL`],
              deployFirst: true,
              type: `file`,
            });
          }

          if (iProject.compileCommand) {
            actions.push({
              name: `${description} (compile)`,
              command: `ERR=*EVENTF ${iProject.compileCommand}`,
              environment: `pase`,
              extensions: [`GLOBAL`],
              deployFirst: true,
              type: `file`,
            });
          }
        } catch (e) {
          // ignore
          this.appendOutput(`Error parsing ${file.fsPath}: ${e.message}\n`);
        }
      };
    }

    return actions;
  }
}