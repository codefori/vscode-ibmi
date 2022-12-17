
const vscode = require(`vscode`);
const path = require(`path`);

const gitExtension = vscode.extensions.getExtension(`vscode.git`).exports;

const { default: IBMi } = require(`./IBMi`);
const { GlobalConfiguration, ConnectionConfiguration } = require(`./Configuration`);
const { CustomUI, Field } = require(`./CustomUI`);
const { getEnvConfig } = require(`./local/env`);
const { getLocalActions, getiProjActions } = require(`./local/actions`);
const { Deployment } = require(`./local/deployment`);
const { parseErrors } = require(`./errors/handler`);

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

const OUTPUT_BUTTON_BASE = `$(three-bars) Output`;
const OUTPUT_BUTTON_RUNNING = `$(sync~spin) Output`;

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

      actionsBarItem.text = `$(file-binary) Actions`;
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

    if (GlobalConfiguration.get(`logCompileOutput`)) {
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
   * @param {Instance} instance
   * @param {{asp?: string, lib: string, object: string, ext?: string, workspace?: number}} evfeventInfo
   */
  static async refreshDiagnostics(instance, evfeventInfo) {
    const content = instance.getContent();

    /** @type {ConnectionConfiguration.Parameters} */
    const config = instance.getConfig();

    const tableData = await content.getTable(evfeventInfo.lib, `EVFEVENT`, evfeventInfo.object);
    /** @type {string[]} */
    const lines = tableData.map(row => row.EVFEVENT);

    const asp = evfeventInfo.asp ? `${evfeventInfo.asp}/` : ``;

    const errorsByFiles = parseErrors(lines);

    ileDiagnostics.clear();

    /** @type {vscode.Diagnostic[]} */
    const diagnostics = [];

    if (errorsByFiles.size > 0) {
      for (const errorsByFile of errorsByFiles.entries()) {
        const file = errorsByFile[0];
        const errors = errorsByFile[1];
        diagnostics.length = 0;

        for (const error of errors) {
          error.column = Math.max(error.column - 1, 0);
          error.linenum = Math.max(error.linenum - 1, 0);

          if (error.column === 0 && error.toColumn === 0) {
            error.column = 0;
            error.toColumn = 100;
          }

          if (!config.hideCompileErrors.includes(error.code)) {
            const diagnostic = new vscode.Diagnostic(
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
            ileDiagnostics.set(possibleFiles.find(uri => uri.path.includes(baseInfo.base)), diagnostics);
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
            ileDiagnostics.set(vscode.Uri.from({ scheme: `streamfile`, path: file }), diagnostics);
          else
            ileDiagnostics.set(vscode.Uri.from({ scheme: `member`, path: `/${asp}${file}${evfeventInfo.ext ? `.` + evfeventInfo.ext : ``}` }), diagnostics);
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

    /** @type {ConnectionConfiguration.Parameters} */
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
   * @param {Instance} instance
   * @param {vscode.Uri} uri 
   */
  static async RunAction(instance, uri) {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);

    /** @type {{asp?: string, lib: string, object: string, ext?: string, workspace?: number}} */
    let evfeventInfo = { asp: undefined, lib: ``, object: ``, workspace: undefined };

    /** @type {IBMi} */
    const connection = instance.getConnection();

    /** @type {ConnectionConfiguration.Parameters} */
    const config = instance.getConfig();

    const extension = uri.path.substring(uri.path.lastIndexOf(`.`) + 1).toUpperCase();
    const fragement = uri.fragment.toUpperCase();

    const allActions = [];

    // First we grab the predefined Actions in the VS Code settings
    const allDefinedActions = GlobalConfiguration.get(`actions`);
    allActions.push(...allDefinedActions);

    // Then, if we're being called from a local file
    // we fetch the Actions defined from the workspace.
    if (workspaceFolder && uri.scheme === `file`) {
      const [localActions, iProjActions] = await Promise.all([
        getLocalActions(workspaceFolder), 
        getiProjActions(workspaceFolder)
      ]);
      allActions.push(...localActions, ...iProjActions);
    }

    // We make sure all extensions are uppercase
    allActions.forEach(action => {
      if (action.extensions) action.extensions = action.extensions.map(ext => ext.toUpperCase());
    });

    // Then we get all the available Actions for the current context
    /** @type {import("../typings").Action[]} */
    const availableActions = allActions.filter(action => action.type === uri.scheme && (action.extensions.includes(extension) || action.extensions.includes(fragement) || action.extensions.includes(`GLOBAL`)));

    if (availableActions.length > 0) {
      if (GlobalConfiguration.get(`clearOutputEveryTime`)) {
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

        if (workspaceFolder && action.type === `file` && action.deployFirst) {
          const deployResult = await Deployment.launchDeploy(workspaceFolder.index);
          if (deployResult !== undefined) {
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
              baseDir = currentWorkspace.uri.path;

              relativePath = path.posix.relative(baseDir, uri.path).split(path.sep).join(path.posix.sep);
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
              } catch (e) { }
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
          /** @type {import("../typings").CommandResult} */
          let commandResult;
          let executed = false;

          outputBarItem.text = OUTPUT_BUTTON_RUNNING;

          if (workspaceFolder) {
            const envFileVars = await getEnvConfig(workspaceFolder);
            Object.entries(envFileVars).forEach(item => {
              variables[`&` + item[0]] = item[1];
            });
          }

          command = this.replaceValues(command, variables);

          try {
            commandResult = await this.runCommand(instance, {
              environment,
              command,
              env: variables
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
                  GlobalConfiguration.get(`logCompileOutput`) ? `Show Output` : undefined
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

          outputBarItem.text = OUTPUT_BUTTON_BASE;

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
   * @param {RemoteCommand} options 
   * @returns {Promise<CommandResult|null>}
   */
  static async runCommand(instance, options) {
    /** @type {IBMi} */
    const connection = instance.getConnection();

    /** @type {ConnectionConfiguration.Parameters} */
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
      commandString = await vscode.window.showInputBox({ prompt: `Run Command`, value: commandString.substring(1) })
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
        // We build environment variables for the environment to be ready
        /** @type {{[name: string]: string}} */
        const envVars = {};
        Object
          .entries({ ...(options.env ? options.env : {}), ...this.getDefaultVariables(instance) })
          .filter(item => (new RegExp(`^[A-Za-z\&]`, `i`).test(item[0])))
          .forEach(item => {
            envVars[item[0][0] === `&` ? item[0].substring(1) : item[0]] = item[1];
          });

        commandResult = await connection.sendCommand({
          command: commands.join(` && `),
          directory: cwd,
          env: envVars,
          ...callbacks
        });
        break;

      case `qsh`:
        commandResult = await connection.sendQsh({
          command: [
            `liblist -d ` + connection.defaultUserLibraries.join(` `).replace(/\$/g, `\\$`),
            `liblist -c ` + config.currentLibrary.replace(/\$/g, `\\$`),
            `liblist -a ` + libl.join(` `).replace(/\$/g, `\\$`),
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
            `liblist -d ` + connection.defaultUserLibraries.join(` `).replace(/\$/g, `\\$`),
            `liblist -c ` + config.currentLibrary.replace(/\$/g, `\\$`),
            `liblist -a ` + libl.join(` `).replace(/\$/g, `\\$`),
            ...commands.map(command =>
              `${`system ${GlobalConfiguration.get(`logCompileOutput`) ? `` : `-s`} "${command.replace(/[$]/g, `\\$&`)}"; if [[ $? -ne 0 ]]; then exit 1; fi`}`
            ),
          ].join(` && `),
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
          currentInput = command.substring(start + 2, end);

          const [name, label, initalValue] = currentInput.split(`|`);
          components.push({
            name,
            label,
            initalValue: initalValue || ``,
            positions: [start, end + 1]
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

      const { panel, data } = await commandUI.loadPage(name);

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
}