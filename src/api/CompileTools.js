
const vscode = require(`vscode`);
const path = require(`path`);

const errorHandler = require(`./errorHandle`);
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
  }

  /**
   * Does what it says on the tin.
   */
  static clearDiagnostics() {
    ileDiagnostics.clear();
  }
  
  /**
   * @param {*} instance
   * @param {{asp?: string, lib: string, object: string, ext?: string}} evfeventInfo
   */
  static async refreshDiagnostics(instance, evfeventInfo) {
    const content = instance.getContent();

    /** @type {Configuration} */
    const config = instance.getConfig();

    const tableData = await content.getTable(evfeventInfo.lib, `EVFEVENT`, evfeventInfo.object);
    const lines = tableData.map(row => row.EVFEVENT);

    const asp = evfeventInfo.asp ? `${evfeventInfo.asp}/` : ``;

    const errors = errorHandler(lines);

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

        if (file.startsWith(`/`))
          ileDiagnostics.set(vscode.Uri.parse(`streamfile:${file}`), diagnostics);
        else
          ileDiagnostics.set(vscode.Uri.parse(`member:/${asp}${file}${evfeventInfo.ext ? `.` + evfeventInfo.ext : ``}`), diagnostics);
        
      }

    } else {
      ileDiagnostics.clear();
    }


  }

  /**
   * @param {*} instance
   * @param {vscode.Uri} uri 
   */
  static async RunAction(instance, uri) {
    let evfeventInfo = {asp: undefined, lib: ``, object: ``};

    /** @type {IBMi} */
    const connection = instance.getConnection();

    /** @type {Configuration} */
    const config = instance.getConfig();

    const allActions = Configuration.get(`actions`);

    const extension = uri.path.substring(uri.path.lastIndexOf(`.`)+1).toUpperCase();

    //We do this for backwards compatability.
    //Can be removed in a few versions.
    for (let action of allActions) {
      if (action.extension) action.extensions = [action.extension];
      if (action.extensions) action.extensions = action.extensions.map(ext => ext.toUpperCase());
    }

    const availableActions = allActions.filter(action => action.type === uri.scheme && (action.extensions.includes(extension) || action.extensions.includes(`GLOBAL`)));

    if (availableActions.length > 0) {
      const options = availableActions.map(item => item.name);
    
      let chosenOptionName, command, environment;
    
      if (options.length === 1) {
        chosenOptionName = options[0]
      } else {
        chosenOptionName = await vscode.window.showQuickPick(options);
      }
    
      if (chosenOptionName) {
        command = availableActions.find(action => action.name === chosenOptionName).command;
        environment = availableActions.find(action => action.name === chosenOptionName).environment || `ile`;

        command = command.replace(new RegExp(`&BUILDLIB`, `g`), config.buildLibrary);
        command = command.replace(new RegExp(`&USERNAME`, `g`), connection.currentUser);
        command = command.replace(new RegExp(`&HOME`, `g`), config.homeDirectory);

        let blank, asp, lib, file, fullName;
        let basename, name, ext;

        switch (uri.scheme) {
        case `member`:
          const memberPath = uri.path.split(`/`);
      
          if (memberPath.length === 4) {
            lib = memberPath[1];
            file = memberPath[2];
            fullName = memberPath[3];
          } else {
            asp = memberPath[1]
            lib = memberPath[2];
            file = memberPath[3];
            fullName = memberPath[4];
          }
          name = fullName.substring(0, fullName.lastIndexOf(`.`));

          ext = (fullName.includes(`.`) ? fullName.substring(fullName.lastIndexOf(`.`) + 1) : undefined);

          evfeventInfo = {
            asp,
            lib: lib,
            object: name,
            ext
          };

          command = command.replace(new RegExp(`&OPENLIBL`, `g`), lib.toLowerCase());
          command = command.replace(new RegExp(`&OPENLIB`, `g`), lib);

          command = command.replace(new RegExp(`&OPENSPFL`, `g`), file.toLowerCase());
          command = command.replace(new RegExp(`&OPENSPF`, `g`), file);

          command = command.replace(new RegExp(`&OPENMBRL`, `g`), name.toLowerCase());
          command = command.replace(new RegExp(`&OPENMBR`, `g`), name);

          command = command.replace(new RegExp(`&EXTL`, `g`), ext.toLowerCase());
          command = command.replace(new RegExp(`&EXT`, `g`), ext);

          break;

        case `streamfile`:
          basename = path.posix.basename(uri.path);
          name = basename.substring(0, basename.lastIndexOf(`.`)).toUpperCase();
          ext = (basename.includes(`.`) ? basename.substring(basename.lastIndexOf(`.`) + 1) : undefined);

          evfeventInfo = {
            asp: undefined,
            lib: config.buildLibrary,
            object: name,
            ext
          };

          command = command.replace(new RegExp(`&FULLPATH`, `g`), uri.path);

          command = command.replace(new RegExp(`&NAMEL`, `g`), name.toLowerCase());
          command = command.replace(new RegExp(`&NAME`, `g`), name);

          command = command.replace(new RegExp(`&EXTL`, `g`), ext.toLowerCase());
          command = command.replace(new RegExp(`&EXT`, `g`), ext);

          break;

        case `object`:
          [blank, lib, fullName] = uri.path.split(`/`);
          name = fullName.substring(0, fullName.lastIndexOf(`.`));

          evfeventInfo = {
            asp: undefined,
            lib,
            object: name,
            extension
          };

          command = command.replace(new RegExp(`&LIBRARYL`, `g`), lib.toLowerCase());
          command = command.replace(new RegExp(`&LIBRARY`, `g`), lib);

          command = command.replace(new RegExp(`&NAMEL`, `g`), name.toLowerCase());
          command = command.replace(new RegExp(`&NAME`, `g`), name);

          command = command.replace(new RegExp(`&TYPEL`, `g`), extension.toLowerCase());
          command = command.replace(new RegExp(`&TYPE`, `g`), extension);

          command = command.replace(new RegExp(`&EXTL`, `g`), extension.toLowerCase());
          command = command.replace(new RegExp(`&EXT`, `g`), extension);
          break;
        }

        if (command.startsWith(`?`)) {
          command = await vscode.window.showInputBox({prompt: `Run action`, value: command.substring(1)})
        } else {
          command = await CompileTools.showCustomInputs(chosenOptionName, command);
        }

        if (command) {
          /** @type {any} */
          let commandResult, output;
          let executed = false;

          //We have to reverse it because `liblist -a` adds the next item to the top always 
          let libl = config.libraryList.slice(0).reverse();

          libl = libl.map(library => {
            //We use this for special variables in the libl
            switch (library) {
            case `&BUILDLIB`: return config.buildLibrary;
            default: return library;
            }
          });

          outputChannel.append(`Library list: ` + libl.reverse().join(` `) + `\n`);
          outputChannel.append(`Command: ` + command + `\n`);

          try {

            switch (environment) {
            case `pase`:
              commandResult = await connection.paseCommand(command, undefined, 1);
              break;

            case `qsh`:
              commandResult = await connection.qshCommand([
                `liblist -d ` + connection.defaultUserLibraries.join(` `),
                `liblist -a ` + libl.join(` `),
                command,
              ], undefined, 1);
              break;

            case `ile`:
            default:
              command = `system ${Configuration.get(`logCompileOutput`) ? `` : `-s`} "${command}"`;
              commandResult = await connection.qshCommand([
                `liblist -d ` + connection.defaultUserLibraries.join(` `),
                `liblist -a ` + libl.join(` `),
                command,
              ], undefined, 1);
              break;
            }

            if (commandResult.code === 0 || commandResult.code === null) {
              executed = true;
              vscode.window.showInformationMessage(`Action ${chosenOptionName} for ${evfeventInfo.lib}/${evfeventInfo.object} was successful.`);
              if (Configuration.get(`autoRefresh`)) vscode.commands.executeCommand(`code-for-ibmi.refreshObjectList`, evfeventInfo.lib);
              
            } else {
              executed = false;
              vscode.window.showErrorMessage(`Action ${chosenOptionName} for ${evfeventInfo.lib}/${evfeventInfo.object} was not successful.`);
            }
            
            output = ``;
            if (commandResult.stderr.length > 0) output += `${commandResult.stderr}\n\n`;
            if (commandResult.stdout.length > 0) output += `${commandResult.stdout}\n\n`;

          } catch (e) {
            output = `${e}\n`;
            executed = false;

            vscode.window.showErrorMessage(`Action ${chosenOptionName} for ${evfeventInfo.lib}/${evfeventInfo.object} failed. (internal error).`);
          }

          outputChannel.append(output);

          if (command.includes(`*EVENTF`)) {
            this.refreshDiagnostics(instance, evfeventInfo);
          }

        }
      }

    } else {
      //No compile commands
      vscode.window.showErrorMessage(`No compile commands found for ${uri.scheme}-${extension}.`);
    }
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
        field = new Field(`input`, component.name, component.label);
        field.default = component.initalValue;
        commandUI.addField(field);
      }

      commandUI.addField(new Field(`submit`, `execute`, `Execute`));

      const {panel, data} = await commandUI.loadPage(name);

      panel.dispose();
      if (data) {
        for (const component of components.reverse()) {
          command = command.substr(0, component.positions[0]) + data[component.name] + command.substr(component.positions[1]);
        }
      } else {
        command = undefined;
      }

    }

    return command;
  
  }
}