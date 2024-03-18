
import * as node_ssh from "node-ssh";
import * as vscode from "vscode";
import { ConnectionConfiguration } from "./Configuration";

import { existsSync } from "fs";
import os from "os";
import path from 'path';
import { instance } from "../instantiate";
import { CommandData, CommandResult, ConnectionData, MemberParts, RemoteCommand } from '../typings';
import { CompileTools } from "./CompileTools";
import { CachedServerSettings, GlobalStorage } from './Storage';
import { Tools } from './Tools';
import ConnectionSettings from './ConnectionSettings';
import * as configVars from './configVars';
import { clear } from "console";

const CCSID_SYSVAL = -2;

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
  qccsid: number;
  defaultCCSID: number;
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
    this.qccsid = CCSID_SYSVAL;
    this.defaultCCSID = 0;

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
        let connSettings = new ConnectionSettings(this);

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

        // Check shell output for additional user text - this will confuse Code...
        progress.report({
          message: `Checking shell output.`
        });

        if (!(await connSettings.CheckShellOutput())) {
          const chosen = await vscode.window.showErrorMessage(`Error in shell configuration!`, {
            detail: [
              `This extension can not work with the shell configured on ${connectionObject.name},`,
              `since the output from shell commands have additional content.`,
              `This can be caused by running commands like "echo" or other`,
              `commands creating output in your shell start script.`, ``,
              `The connection to ${connectionObject.name} will be aborted.`
            ].join(`\n`),
            modal: true
          }, `Read more`);

          if (chosen === `Read more`) {
            vscode.commands.executeCommand(`vscode.open`, `https://codefori.github.io/docs/#/pages/tips/setup`);
          }
          throw (`Shell config error, connection aborted.`);
        }

        // Register handlers after we might have to abort due to bad configuration.
        this.client.connection!.once(`timeout`, disconnected);
        this.client.connection!.once(`end`, disconnected);
        this.client.connection!.once(`error`, disconnected);

        if (!reconnecting) {
          instance.setConnection(this);
        }

        //Checking home directory
        progress.report({
          message: `Checking home directory.`
        });

        let homeDirValues = await connSettings.checkHomeDirectory();
        if (!homeDirValues.homeErr) {

          if (!homeDirValues.homeExists) {
            if (reconnecting) {
              vscode.window.showWarningMessage(`Your home directory (${homeDirValues.homeDir}) does not exist. Code for IBM i may not function correctly.`, { modal: false });
            }
            else {
              if (await vscode.window.showWarningMessage(`Home directory does not exist`, {
                modal: true,
                detail: `Your home directory (${homeDirValues.homeDir}) does not exist, so Code for IBM i may not function correctly. Would you like to create this directory now?`,
              }, `Yes`)) {
                this.appendOutput(`creating home directory ${homeDirValues.homeDir}`);
                let homeDirResult = await connSettings.createHomeDirectory(homeDirValues.homeDir, connectionObject.username);
                if (!homeDirResult.homeCreated) {
                  await vscode.window.showWarningMessage(homeDirResult.homeMsg, { modal: true });
                }
              }
            }
          }
          if (homeDirValues.homeChanged) {
            vscode.window.showInformationMessage(`Configured home directory reset to ${homeDirValues.homeDir}.`);
          }
        }
        else {
          await vscode.window.showWarningMessage(homeDirValues.homeMsg, { modal: !reconnecting });
        }

        //Checking library list configuration

        progress.report({
          message: `Checking library list configuration.`
        });

        await connSettings.checkLibraryList();

        //Checking temporary library configuration
        progress.report({
          message: `Checking temporary library configuration.`
        });

        await connSettings.checkTempLibConfig();

        //Checking temporary directory configuration

        progress.report({
          message: `Checking temporary directory configuration.`
        });

        const tempDirSet = await connSettings.checkTempDirectoryConfig();

        //Clear temporary data
        if (tempDirSet && this.config?.autoClearTempData) {

          progress.report({
            message: `Clearing temporary data.`
          });
          let clearResult = await connSettings.clearTempDataSys(); //Clear temporary data in SYS filesystem
          if(!clearResult.cleared) {
            vscode.window.showErrorMessage(clearResult.message, `View log`).then(async choice => {
              if (choice === `View log`) {
                this.outputChannel!.show();
              }
            });
          }
          
          clearResult = await connSettings.clearTempDataIFS(); //Clear temporary data in IFS
          if(!clearResult.cleared) {
            vscode.window.showErrorMessage(clearResult.message, `View log`).then(async choice => {
              if (choice === `View log`) {
                this.outputChannel!.show();
              }
            });
          }
        }

        // Check for bad data areas
        if (!(quickConnect === true && cachedServerSettings?.badDataAreasChecked === true)) {
          progress.report({
            message: `Checking for bad data areas.`
          });

          if (await connSettings.checkQCPTOIMPF()) {
            vscode.window.showWarningMessage(`The data area QSYS/QCPTOIMPF exists on this system and may impact Code for IBM i functionality.`, {
              detail: `For V5R3, the code for the command CPYTOIMPF had a major design change to increase functionality and performance. The QSYS/QCPTOIMPF data area lets developers keep the pre-V5R2 version of CPYTOIMPF. Code for IBM i cannot function correctly while this data area exists.`,
              modal: true,
            }, `Delete`, `Read more`).then(choice => {
              switch (choice) {
                case `Delete`:
                  connSettings.deleteQCPTOIMPF().then((result) => {
                    if (result?.code === 0) {
                      vscode.window.showInformationMessage(`The data area QSYS/QCPTOIMPF has been deleted.`);
                    } else {
                      vscode.window.showInformationMessage(`Failed to delete the data area QSYS/QCPTOIMPF. Code for IBM i may not work as intended.`);
                    }
                  });
                  break;
                case `Read more`:
                  vscode.env.openExternal(vscode.Uri.parse(`https://github.com/codefori/vscode-ibmi/issues/476#issuecomment-1018908018`));
                  break;
              }
            });
          }

          if (await connSettings.checkQCPFRMIMPF()) {
            vscode.window.showWarningMessage(`The data area QSYS/QCPFRMIMPF exists on this system and may impact Code for IBM i functionality.`, {
              modal: false,
            }, `Delete`, `Read more`).then(choice => {
              switch (choice) {
                case `Delete`:
                  connSettings.deleteQCPFRMIMPF().then((result) => {
                    if (result?.code === 0) {
                      vscode.window.showInformationMessage(`The data area QSYS/QCPFRMIMPF has been deleted.`);
                    } else {
                      vscode.window.showInformationMessage(`Failed to delete the data area QSYS/QCPFRMIMPF. Code for IBM i may not work as intended.`);
                    }
                  });
                  break;
                case `Read more`:
                  vscode.env.openExternal(vscode.Uri.parse(`https://github.com/codefori/vscode-ibmi/issues/476#issuecomment-1018908018`));
                  break;
              }
            });


          }

        }

        // Check for installed components?
        // For Quick Connect to work here, 'remoteFeatures' MUST have all features defined and no new properties may be added!
        if (quickConnect === true && cachedServerSettings?.remoteFeaturesKeys && cachedServerSettings.remoteFeaturesKeys === Object.keys(this.remoteFeatures).sort().toString()) {
          Object.assign(this.remoteFeatures, cachedServerSettings.remoteFeatures);
        } else {
          progress.report({
            message: `Checking installed components on host IBM i.`
          });

          //Next, we see what pase features are available (installed via yum)
          //This may enable certain features in the future.
          const remoteApps = connSettings.getRemoteApps();
          for (const remoteFeature of remoteApps) {
            progress.report({
              message: `Checking installed components on host IBM i: ${remoteFeature.path}`
            });
            await connSettings.checkInstalledFeature(remoteFeature);
          }
        }

        if (this.remoteFeatures[`QZDFMDB2.PGM`]) {
          //Temporary function to run SQL
          const runSQL = async (statement: string) => {
            const output = await this.sendCommand({
              command: `LC_ALL=EN_US.UTF-8 system "call QSYS/QZDFMDB2 PARM('-d' '-i')"`,
              stdin: statement
            });

            if (output.code === 0) {
              return Tools.db2Parse(output.stdout);
            }
            else {
              throw new Error(output.stdout);
            }
          };

          // Check for ASP information?
          if (quickConnect === true && cachedServerSettings?.aspInfo) {
            this.aspInfo = cachedServerSettings.aspInfo;
          } else {
            progress.report({
              message: `Checking for ASP information.`
            });

            try {
              await connSettings.checkASPInfo();
            } catch (e) {
              //Oh well
              progress.report({
                message: `Failed to get ASP information.`
              });
            }
          }

          // Fetch conversion values?
          if (quickConnect === true && cachedServerSettings?.qccsid !== null && cachedServerSettings?.variantChars && cachedServerSettings?.defaultCCSID) {
            this.qccsid = cachedServerSettings.qccsid;
            this.variantChars = cachedServerSettings.variantChars;
            this.defaultCCSID = cachedServerSettings.defaultCCSID;
          } else {
            progress.report({
              message: `Fetching conversion values.`
            });

            // Next, we're going to see if we can get the CCSID from the user or the system.
            // Some things don't work without it!!!
            const [userInfo] = await runSQL(`select CHARACTER_CODE_SET_ID from table( QSYS2.QSYUSRINFO( USERNAME => upper('${this.currentUser}') ) )`);
            if (userInfo.CHARACTER_CODE_SET_ID !== `null` && typeof userInfo.CHARACTER_CODE_SET_ID === 'number') {
              this.qccsid = userInfo.CHARACTER_CODE_SET_ID;
            }

            if (!this.qccsid || this.qccsid === CCSID_SYSVAL) {
              const [systemCCSID] = await runSQL(`select SYSTEM_VALUE_NAME, CURRENT_NUMERIC_VALUE from QSYS2.SYSTEM_VALUE_INFO where SYSTEM_VALUE_NAME = 'QCCSID'`);
              if (typeof systemCCSID.CURRENT_NUMERIC_VALUE === 'number') {
                this.qccsid = systemCCSID.CURRENT_NUMERIC_VALUE;
              }
            }

            try {
              const [activeJob] = await runSQL(`Select DEFAULT_CCSID From Table(QSYS2.ACTIVE_JOB_INFO( JOB_NAME_FILTER => '*', DETAILED_INFO => 'ALL' ))`);
              this.defaultCCSID = Number(activeJob.DEFAULT_CCSID);
            }
            catch (error) {
              const [defaultCCSID] = (await this.runCommand({ command: "DSPJOB OPTION(*DFNA)" }))
                .stdout
                .split("\n")
                .filter(line => line.includes("DFTCCSID"));

              const defaultCCSCID = Number(defaultCCSID.split("DFTCCSID").at(1)?.trim());
              if (defaultCCSCID && !isNaN(defaultCCSCID)) {
                this.defaultCCSID = defaultCCSCID;
              }
            }

            if (this.config.enableSQL && this.qccsid === 65535) {
              this.config.enableSQL = false;
              vscode.window.showErrorMessage(`QCCSID is set to 65535. Using fallback methods to access the IBM i file systems.`);
            }

            progress.report({
              message: `Fetching local encoding values.`
            });

            await connSettings.checkLocalEncoding();
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

        if ((this.qccsid < 1 || this.qccsid === 65535)) {
          this.outputChannel?.appendLine(`\nUser CCSID is ${this.qccsid}; falling back to using default CCSID ${this.defaultCCSID}\n`);
        }

        // give user option to set bash as default shell.
        if (this.remoteFeatures[`bash`]) {
          await connSettings.checkDefaultShell();
          if (!this.config?.usesBash) {
            // make sure chsh is installed
            if (this.remoteFeatures[`chsh`]) {
              vscode.window.showInformationMessage(`IBM recommends using bash as your default shell.`, `Set shell to bash`, `Read More`,).then(async choice => {
                switch (choice) {
                  case `Set shell to bash`:
                    await connSettings.setShelltoBash();
                    if (this.config?.usesBash) {
                      vscode.window.showInformationMessage(`Shell is now bash! Reconnect for change to take effect.`);
                    }
                    else {
                      vscode.window.showInformationMessage(`Default shell WAS NOT changed to bash.`);
                    }
                    break;
                  case `Read More`:
                    vscode.env.openExternal(vscode.Uri.parse(`https://ibmi-oss-docs.readthedocs.io/en/latest/user_setup/README.html#step-4-change-your-default-shell-to-bash`));
                    break;
                }
              });
            }
          }

          if (this.config?.usesBash) {
            if ((!quickConnect || !cachedServerSettings?.pathChecked)) {
              //Ensure /QOpenSys/pkgs/bin is found in $PATH
              progress.report({
                message: `Checking /QOpenSys/pkgs/bin in $PATH.`
              });
              const bashPath = await connSettings.checkBashPath();

              if (bashPath.reason && await vscode.window.showWarningMessage(`/QOpenSys/pkgs/bin not found in $PATH`, {
                modal: true,
                detail: `${bashPath.reason}, so Code for IBM i may not function correctly. Would you like to ${bashPath.bashrcExists ? "update" : "create"} ${bashPath.bashrcFile} to fix this now?`,
              }, `Yes`)) {
                delayedOperations.push(async () => {
                  this.appendOutput(`${bashPath.bashrcExists ? "update" : "create"} ${bashPath.bashrcFile}`);
                  if (!bashPath.bashrcExists) {
                    const bashrc = await connSettings.updateBashrc(bashPath.bashrcFile, connectionObject.username);
                    if (bashrc.code !== 0) {
                      await vscode.window.showWarningMessage(`Error creating ${bashPath.bashrcFile}):\n${bashrc.stderr}.\n\n Code for IBM i may not function correctly. Please contact your system administrator.`, { modal: true });
                    }
                  }
                  else {
                    try {
                      await connSettings.createBashrc(bashPath.bashrcFile);
                    }
                    catch (error) {
                      await vscode.window.showWarningMessage(`Error modifying PATH in ${bashPath.bashrcFile}):\n${error}.\n\n Code for IBM i may not function correctly. Please contact your system administrator.`, { modal: true });
                    }
                  }
                });
              }
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
            progress.report({
              message: `Validate configured library list`
            });
            let badLibs = await connSettings.validateLibraryList();
            if (badLibs.length > 0) {
              let validLibs = this.config?.libraryList.filter(lib => !badLibs.includes(lib));
              const chosen = await vscode.window.showWarningMessage(`The following ${badLibs.length > 1 ? `libraries` : `library`} does not exist: ${badLibs.join(`,`)}. Remove ${badLibs.length > 1 ? `them` : `it`} from the library list?`, `Yes`, `No`);
              if (chosen === `Yes`) {
                this.config!.libraryList = validLibs;
              } else {
                vscode.window.showWarningMessage(`The following libraries does not exist: ${badLibs.join(`,`)}.`);
              }
            }
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
          pathChecked: true,
          defaultCCSID: this.defaultCCSID
        });

        return {
          success: true
        };
      });

    } catch (e: any) {

      if (this.client.isConnected()) {
        this.client.dispose();
      }

      if (reconnecting && await vscode.window.showWarningMessage(`Could not reconnect`, {
        modal: true,
        detail: `Reconnection to ${this.currentConnectionName} has failed. Would you like to try again?\n\n${e}`
      }, `Yes`)) {
        return this.connect(connectionObject, true);
      }

      let error = e;
      if (e.code === "ENOTFOUND") {
        error = `Host is unreachable. Check the connection's hostname/IP address.`;
      }
      else if (e.code === "ECONNREFUSED") {
        error = `Port ${connectionObject.port} is unreachable. Check the connection's port number or run command STRTCPSVR SERVER(*SSHD) on the host.`
      }
      else if (e.level === "client-authentication") {
        error = `Check your credentials${e.message ? ` (${e.message})` : ''}.`;
      }

      return {
        success: false,
        error
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

  getLastDownloadLocation() {
    if (this.config?.lastDownloadLocation && existsSync(Tools.fixWindowsPath(this.config.lastDownloadLocation))) {
      return this.config.lastDownloadLocation;
    }
    else {
      return os.homedir();
    }
  }

  async setLastDownloadLocation(location: string) {
    if (this.config && location && location !== this.config.lastDownloadLocation) {
      this.config.lastDownloadLocation = location;
      await ConnectionConfiguration.update(this.config);
    }
  }

  fileToPath(file: string | vscode.Uri): string {
    if (typeof file === "string") {
      return Tools.fixWindowsPath(file);
    }
    else {
      return file.fsPath;
    }
  }

  /**
   * Creates a temporary directory and pass it on to a `process` function.
   * The directory is guaranteed to be empty when created and deleted after the `process` is done.
   * @param process the process that will run on the empty directory
   */
  async withTempDirectory(process: (directory: string) => Promise<void>) {
    const tempDirectory = `${this.config?.tempDir || '/tmp'}/code4itemp${Tools.makeid(20)}`;
    const prepareDirectory = await this.sendCommand({ command: `rm -rf ${tempDirectory} && mkdir -p ${tempDirectory}` });
    if (prepareDirectory.code === 0) {
      try {
        await process(tempDirectory);
      }
      finally {
        await this.sendCommand({ command: `rm -rf ${tempDirectory}` });
      }
    }
    else {
      throw new Error(`Failed to create temporary directory ${tempDirectory}: ${prepareDirectory.stderr}`);
    }
  }
}