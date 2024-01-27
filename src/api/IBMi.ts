
import * as node_ssh from "node-ssh";
import * as vscode from "vscode";
import { ConnectionConfiguration } from "./Configuration";

import path from 'path';
import { instance } from "../instantiate";
import { CommandData, CommandResult, ConnectionData, MemberParts, RemoteCommand } from "../typings";
import { CompileTools } from "./CompileTools";
import { CachedServerSettings, GlobalStorage } from './Storage';
import { Tools } from './Tools';
import IBMiSettings from "./IBMiSettings";
import * as configVars from './configVars';

export default class IBMi {
  client: node_ssh.NodeSSH;
  currentHost: string;
  currentPort: number;
  currentUser: string;
  currentConnectionName: string;
  tempRemoteFiles: { [name: string]: string };
  defaultUserLibraries: string[];
  outputChannel?: vscode.OutputChannel;
  aspInfo: { [id: number]: string };
  qccsid: number | null;
  remoteFeatures: { [name: string]: string | undefined };
  variantChars: { american: string, local: string };
  lastErrors: object[];
  config?: ConnectionConfiguration.Parameters;

  commandsExecuted: number = 0;

  constructor() {
    this.client = new node_ssh.NodeSSH;
    this.currentHost = ``;
    this.currentPort = 22;
    this.currentUser = ``;
    this.currentConnectionName = ``;

    this.tempRemoteFiles = {};
    this.defaultUserLibraries = [];

    /**
     * Used to store ASP numbers and their names
     * THeir names usually maps up to a directory in
     * the root of the IFS, thus why we store it.
     */
    this.aspInfo = {};

    this.qccsid = null;

    this.remoteFeatures = {
      git: undefined,
      grep: undefined,
      tn5250: undefined,
      setccsid: undefined,
      md5sum: undefined,
      bash: undefined,
      chsh: undefined,
      stat: undefined,
      sort: undefined,
      'GENCMDXML.PGM': undefined,
      'GETNEWLIBL.PGM': undefined,
      'QZDFMDB2.PGM': undefined,
      'startDebugService.sh': undefined,
      attr: undefined,
      iconv: undefined,
      tar: undefined,
      ls: undefined,
    };

    this.variantChars = {
      american: `#@$`,
      local: `#@$`
    };

    /** 
     * Strictly for storing errors from sendCommand.
     * Used when creating issues on GitHub.
     * */
    this.lastErrors = [];

  }

  /**
   * @returns {Promise<{success: boolean, error?: any}>} Was succesful at connecting or not.
   */
  async connect(connectionObject: ConnectionData, reconnecting?: boolean, reloadServerSettings: boolean = false): Promise<{ success: boolean, error?: any }> {
    try {
      connectionObject.keepaliveInterval = 35000;

      configVars.replaceAll(connectionObject);

      return await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `Connecting`,
      }, async progress => {
        progress.report({
          message: `Connecting via SSH.`
        });

        let delayedOperations: Function[] = [];

        await this.client.connect(connectionObject as node_ssh.Config);

        //Check settings
        let checkSettings = new IBMiSettings(this,progress,connectionObject,delayedOperations,reconnecting);
        
        //Check Shell output
        try{
          checkSettings.CheckShellOutput();
        }
        catch(error) {
          throw error;
        }

        this.currentConnectionName = connectionObject.name;
        this.currentHost = connectionObject.host;
        this.currentPort = connectionObject.port;
        this.currentUser = connectionObject.username;

        if (!reconnecting) {
          this.outputChannel = vscode.window.createOutputChannel(`Code for IBM i: ${this.currentConnectionName}`);
        }

        const disconnected = async () => {
          const choice = await vscode.window.showWarningMessage(`Connection lost`, {
            modal: true,
            detail: `Connection to ${this.currentConnectionName} has dropped. Would you like to reconnect?`
          }, `Yes`);

          let disconnect = true;
          if (choice === `Yes`) {
            disconnect = !(await this.connect(connectionObject, true)).success;
          }

          if (disconnect) {
            this.end();
          };
        };

        progress.report({
          message: `Loading configuration.`
        });

        //Load existing config
        this.config = await ConnectionConfiguration.load(this.currentConnectionName);

        // Load cached server settings.
        const cachedServerSettings: CachedServerSettings = GlobalStorage.get().getServerSettingsCache(this.currentConnectionName);
        // Reload server settings?
        const quickConnect = (this.config.quickConnect === true && reloadServerSettings === false);

        // Register handlers after we might have to abort due to bad configuration.
        this.client.connection!.once(`timeout`, disconnected);
        this.client.connection!.once(`end`, disconnected);
        this.client.connection!.once(`error`, disconnected);

        if (!reconnecting) {
          instance.setConnection(this);
        }

        //Checking home directory
        checkSettings.checkHomeDirectory();

        //Checking library list configuration
        checkSettings.checkLibraryList();

        //Checking temporary library configuration
        checkSettings.checkTempLibConfig();
        
        //Checking temporary directory configuration
        checkSettings.checkTempDirectoryConfig();

        //Clear temporary data
        checkSettings.clearTempData();

        // Check for bad data areas?
        if (quickConnect === true && cachedServerSettings?.badDataAreasChecked === true) {
          // Do nothing, bad data areas are already checked.
        } else {
          checkSettings.checkBadDataAreas();
        }

        // Check for installed components?
        // For Quick Connect to work here, 'remoteFeatures' MUST have all features defined and no new properties may be added!
        if (quickConnect === true && cachedServerSettings?.remoteFeaturesKeys && cachedServerSettings.remoteFeaturesKeys === Object.keys(this.remoteFeatures).sort().toString()) {
          Object.assign(this.remoteFeatures, cachedServerSettings.remoteFeatures);
        } else {
          checkSettings.checkInstalledComponents();
        }

        if (this.remoteFeatures[`QZDFMDB2.PGM`]) {
          let statement;
          let output;

          // Check for ASP information?
          if (quickConnect === true && cachedServerSettings?.aspInfo) {
            this.aspInfo = cachedServerSettings.aspInfo;
          } else {
            checkSettings.checkASPInfo();
          }

          // Fetch conversion values?
          if (quickConnect === true && cachedServerSettings?.qccsid !== null && cachedServerSettings?.variantChars) {
            this.qccsid = cachedServerSettings.qccsid;
            this.variantChars = cachedServerSettings.variantChars;
          } else {
            checkSettings.checkCCSID();
            checkSettings.checkLocalEncoding();
          }
        } else {
          // Disable it if it's not found

          if (this.config.enableSQL) {
            progress.report({
              message: `SQL program not installed. Disabling SQL.`
            });
            this.config.enableSQL = false;
          }
        }

        // give user option to set bash as default shell.
        if (this.remoteFeatures[`bash`]) {
          checkSettings.checkBash();
          if(this.config?.usesBash) {
              if ((!quickConnect || !cachedServerSettings?.pathChecked)) {
                //Ensure /QOpenSys/pkgs/bin is found in $PATH
                checkSettings.checkOpenSrcPath();
              }
          }
        }

        if (this.config.autoConvertIFSccsid) {
          if (this.remoteFeatures.attr === undefined || this.remoteFeatures.iconv === undefined) {
            this.config.autoConvertIFSccsid = false;
            vscode.window.showWarningMessage(`EBCDIC streamfiles will not be rendered correctly since \`attr\` or \`iconv\` is not installed on the host. They should both exist in \`\\usr\\bin\`.`);
          }
        }

        if (this.config.homeDirectory) {
          if (!this.config.tempDir) {
            vscode.window.showWarningMessage(`Code for IBM i will not function correctly until the temporary library has been corrected in the settings.`, `Open Settings`)
              .then(result => {
                switch (result) {
                  case `Open Settings`:
                    vscode.commands.executeCommand(`code-for-ibmi.showAdditionalSettings`);
                    break;
                }
              });
          }
        } else {
          vscode.window.showWarningMessage(`Code for IBM i may not function correctly until your user has a home directory.`);
        }

        // Validate configured library list.
        if (quickConnect === true && cachedServerSettings?.libraryListValidated === true) {
          // Do nothing, library list is already checked.
        } else {
          if (this.config.libraryList) {
            checkSettings.validateLibraryList();
          }
        }

        if (!reconnecting) {
          vscode.workspace.getConfiguration().update(`workbench.editor.enablePreview`, false, true);
          await vscode.commands.executeCommand(`setContext`, `code-for-ibmi:connected`, true);
          delayedOperations.forEach(func => func());
          instance.fire("connected");
        }

        GlobalStorage.get().setServerSettingsCache(this.currentConnectionName, {
          aspInfo: this.aspInfo,
          qccsid: this.qccsid,
          remoteFeatures: this.remoteFeatures,
          remoteFeaturesKeys: Object.keys(this.remoteFeatures).sort().toString(),
          variantChars: {
            american: this.variantChars.american,
            local: this.variantChars.local,
          },
          badDataAreasChecked: true,
          libraryListValidated: true,
          pathChecked: true
        });

        return {
          success: true
        };
      });

    } catch (e) {

      if (this.client.isConnected()) {
        this.client.dispose();
      }

      if (reconnecting && await vscode.window.showWarningMessage(`Could not reconnect`, {
        modal: true,
        detail: `Reconnection to ${this.currentConnectionName} has failed. Would you like to try again?\n\n${e}`
      }, `Yes`)) {
        return this.connect(connectionObject, true);
      }

      return {
        success: false,
        error: e
      };
    }
    finally {
      ConnectionConfiguration.update(this.config!);
    }
  }

  /**
   * - Send PASE/QSH/ILE commands simply
   * - Commands sent here end in the 'IBM i Output' channel
   * - When sending `ile` commands:
   *   By default, it will use the library list of the connection,
   *   but `&LIBL` and `&CURLIB` can be passed in the property
   *   `env` to customise them.
   */
  runCommand(data: RemoteCommand) {
    return CompileTools.runCommand(instance, data);
  }

  async sendQsh(options: CommandData) {
    options.stdin = options.command;

    return this.sendCommand({
      ...options,
      command: `/QOpenSys/usr/bin/qsh`
    });
  }

  /**
   * Send commands to pase through the SSH connection.
   * Commands sent here end up in the 'Code for IBM i' output channel.
   */
  async sendCommand(options: CommandData): Promise<CommandResult> {
    let commands: string[] = [];
    if (options.env) {
      commands.push(...Object.entries(options.env).map(([key, value]) => `export ${key}="${value?.replace(/\$/g, `\\$`).replace(/"/g, `\\"`) || ``
        }"`))
    }

    commands.push(options.command);

    const command = commands.join(` && `);
    const directory = options.directory || this.config?.homeDirectory;

    this.determineClear()

    if (this.outputChannel) {
      this.appendOutput(`${directory}: ${command}\n`);
      if (options && options.stdin) {
        this.appendOutput(`${options.stdin}\n`);
      }
    }

    const result = await this.client.execCommand(command, {
      cwd: directory,
      stdin: options.stdin,
      onStdout: options.onStdout,
      onStderr: options.onStderr,
    });

    // Some simplification
    if (result.code === null) result.code = 0;

    // Store the error
    if (result.code && result.stderr) {
      this.lastErrors.push({
        command,
        code: result.code,
        stderr: result.stderr,
        cwd: directory
      });

      // We don't want it to fill up too much.
      if (this.lastErrors.length > 3)
        this.lastErrors.shift();
    }

    this.appendOutput(JSON.stringify(result, null, 4) + `\n\n`);

    return result;
  }

  private appendOutput(content: string) {
    if (this.outputChannel) {
      this.outputChannel.append(content);
    }
  }

  private determineClear() {
    if (this.commandsExecuted > 150) {
      if (this.outputChannel) this.outputChannel.clear();
      this.commandsExecuted = 0;
    }

    this.commandsExecuted += 1;
  }

  async end() {
    this.client.connection?.removeAllListeners();
    this.client.dispose();

    if (this.outputChannel) {
      this.outputChannel.hide();
      this.outputChannel.dispose();
    }

    await Promise.all([
      vscode.commands.executeCommand("code-for-ibmi.refreshObjectBrowser"),
      vscode.commands.executeCommand("code-for-ibmi.refreshLibraryListView"),
      vscode.commands.executeCommand("code-for-ibmi.refreshIFSBrowser")
    ]);

    instance.setConnection(undefined);
    instance.fire(`disconnected`);
    await vscode.commands.executeCommand(`setContext`, `code-for-ibmi:connected`, false);
    vscode.window.showInformationMessage(`Disconnected from ${this.currentHost}.`);
  }

  /**
   * Generates path to a temp file on the IBM i
   * @param {string} key Key to the temp file to be re-used
   */
  getTempRemote(key: string) {
    if (this.tempRemoteFiles[key] !== undefined) {
      console.log(`Using existing temp: ${this.tempRemoteFiles[key]}`);
      return this.tempRemoteFiles[key];
    } else
      if (this.config) {
        let value = path.posix.join(this.config.tempDir, `vscodetemp-${Tools.makeid()}`);
        console.log(`Using new temp: ${value}`);
        this.tempRemoteFiles[key] = value;
        return value;
      }
  }

  parserMemberPath(string: string): MemberParts {
    const variant_chars_local = this.variantChars.local;
    const validQsysName = new RegExp(`^[A-Z0-9${variant_chars_local}][A-Z0-9_${variant_chars_local}.]{0,9}$`);

    // Remove leading slash
    const path = string.startsWith(`/`) ? string.substring(1).toUpperCase().split(`/`) : string.toUpperCase().split(`/`);

    const basename = path[path.length - 1];
    const file = path[path.length - 2];
    const library = path[path.length - 3];
    const asp = path[path.length - 4];

    if (!library || !file || !basename) {
      throw new Error(`Invalid path: ${string}. Use format LIB/SPF/NAME.ext`);
    }
    if (asp && !validQsysName.test(asp)) {
      throw new Error(`Invalid ASP name: ${asp}`);
    }
    if (!validQsysName.test(library)) {
      throw new Error(`Invalid Library name: ${library}`);
    }
    if (!validQsysName.test(file)) {
      throw new Error(`Invalid Source File name: ${file}`);
    }

    //Having a blank extension is allowed but the . in the path is required
    if (!basename.includes(`.`)) {
      throw new Error(`Source Type extension is required.`);
    }
    const name = basename.substring(0, basename.lastIndexOf(`.`));
    const extension = basename.substring(basename.lastIndexOf(`.`) + 1).trim();

    if (!validQsysName.test(name)) {
      throw new Error(`Invalid Source Member name: ${name}`);
    }
    // The extension/source type has nearly the same naming rules as
    // the objects, except that a period is not allowed.  We can reuse
    // the existing RegExp because result.extension is everything after
    // the final period (so we know it won't contain a period).
    // But, a blank extension is valid.
    if (extension && !validQsysName.test(extension)) {
      throw new Error(`Invalid Source Member Extension: ${extension}`);
    }

    return {
      library,
      file,
      extension,
      basename,
      name,
      asp
    };
  }

  /**
   * @param {string} string
   * @returns {string} result
   */
  sysNameInLocal(string: string) {
    const fromChars = this.variantChars.american;
    const toChars = this.variantChars.local;

    let result = string;

    for (let i = 0; i < fromChars.length; i++) {
      result = result.replace(new RegExp(`[${fromChars[i]}]`, `g`), toChars[i]);
    };

    return result;
  }

  /**
   * @param {string} string
   * @returns {string} result
   */
  sysNameInAmerican(string: string) {
    const fromChars = this.variantChars.local;
    const toChars = this.variantChars.american;

    let result = string;

    for (let i = 0; i < fromChars.length; i++) {
      result = result.replace(new RegExp(`[${fromChars[i]}]`, `g`), toChars[i]);
    };

    return result;
  }
  async uploadFiles(files: { local: string | vscode.Uri, remote: string }[], options?: node_ssh.SSHPutFilesOptions) {
    await this.client.putFiles(files.map(f => { return { local: this.fileToPath(f.local), remote: f.remote } }), options);
  }

  async downloadFile(localFile: string | vscode.Uri, remoteFile: string) {
    await this.client.getFile(this.fileToPath(localFile), remoteFile);
  }

  async uploadDirectory(localDirectory: string | vscode.Uri, remoteDirectory: string, options?: node_ssh.SSHGetPutDirectoryOptions) {
    await this.client.putDirectory(this.fileToPath(localDirectory), remoteDirectory, options);
  }

  async downloadDirectory(localDirectory: string | vscode.Uri, remoteDirectory: string, options?: node_ssh.SSHGetPutDirectoryOptions) {
    await this.client.getDirectory(this.fileToPath(localDirectory), remoteDirectory, options);
  }

  fileToPath(file: string | vscode.Uri): string {
    if (typeof file === "string") {
      if (process.platform === `win32` && file[0] === `/`) {
        //Issue with getFile not working propertly on Windows
        //when there was a / at the start.
        return file.substring(1);
      } else {
        return file;
      }
    }
    else {
      return file.fsPath;
    }
  }
}