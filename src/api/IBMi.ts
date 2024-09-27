import * as node_ssh from "node-ssh";
import * as vscode from "vscode";
import { ConnectionConfiguration } from "./Configuration";

import { parse } from 'csv-parse/sync';
import { existsSync } from "fs";
import os from "os";
import path from 'path';
import { ComponentId, ComponentManager } from "../components/component";
import { CopyToImport } from "../components/copyToImport";
import { instance } from "../instantiate";
import { CommandData, CommandResult, ConnectionData, MemberParts, RemoteCommand, RemoteFeatures, SpecialAuthorities, WrapResult } from "../typings";
import { CompileTools } from "./CompileTools";
import IBMiContent from "./IBMiContent";
import { CachedServerSettings, GlobalStorage } from './Storage';
import { Tools } from './Tools';
import * as configVars from './configVars';
import { DebugConfiguration } from "./debug/config";
import { debugPTFInstalled } from "./debug/server";
import IBMiSettings from "./IBMiSettings";
import IBMiApps from "./IBMiApps";

const CCSID_SYSVAL = -2;
const bashShellPath = '/QOpenSys/pkgs/bin/bash';

export default class IBMi {
  private qccsid: number = 65535;
  private jobCcsid: number = CCSID_SYSVAL;
  /** User default CCSID is job default CCSID */
  private userDefaultCCSID: number = 0;

  private components: ComponentManager = new ComponentManager();

  client: node_ssh.NodeSSH;
  currentHost: string = ``;
  currentPort: number = 22;
  currentUser: string = ``;
  currentConnectionName: string = ``;
  tempRemoteFiles: { [name: string]: string } = {};
  defaultUserLibraries: string[] = [];
  outputChannel?: vscode.OutputChannel;
  outputChannelContent?: string;
  /**
   * Used to store ASP numbers and their names
   * Their names usually maps up to a directory in
   * the root of the IFS, thus why we store it.
   */
  aspInfo: { [id: number]: string } = {};
  remoteFeatures: RemoteFeatures;
  variantChars: { american: string, local: string };

  /** 
   * Strictly for storing errors from sendCommand.
   * Used when creating issues on GitHub.
   * */
  lastErrors: object[] = [];
  config?: ConnectionConfiguration.Parameters;
  content = new IBMiContent(this);
  shell?: string;

  commandsExecuted = 0;

  //Maximum admited length for command's argument - any command whose arguments are longer than this won't be executed by the shell
  maximumArgsLength = 0;

  dangerousVariants = false;

  constructor() {
    this.client = new node_ssh.NodeSSH;

    this.remoteFeatures = {};

    this.variantChars = {
      american: `#@$`,
      local: `#@$`
    };
  }

  /**
   * @returns {Promise<{success: boolean, error?: any}>} Was succesful at connecting or not.
   */
  async connect(connectionObject: ConnectionData, reconnecting?: boolean, reloadServerSettings: boolean = false, onConnectedOperations: Function[] = []): Promise<{ success: boolean, error?: any }> {
    return await Tools.withContext("code-for-ibmi:connecting", async () => {
      try {
        connectionObject.keepaliveInterval = 35000;

        configVars.replaceAll(connectionObject);

        return await vscode.window.withProgress({
          location: vscode.ProgressLocation.Notification,
          title: `Connecting`,
          cancellable: true
        }, async (progress, cancelToken) => {
          progress.report({
            message: `Connecting via SSH.`
          });
          const delayedOperations: Function[] = [...onConnectedOperations];

          await this.client.connect(connectionObject as node_ssh.Config);

          cancelToken.onCancellationRequested(() => {
            this.end();
          });

          this.currentConnectionName = connectionObject.name;
          this.currentHost = connectionObject.host;
          this.currentPort = connectionObject.port;
          this.currentUser = connectionObject.username;

          if (!reconnecting) {
            this.outputChannel = vscode.window.createOutputChannel(`Code for IBM i: ${this.currentConnectionName}`);
            this.outputChannelContent = '';
          }

          let tempLibrarySet = false;

          const timeoutHandler = async () => {
            if (!cancelToken.isCancellationRequested) {
              this.disconnect();

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
            }
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

          //Initialize IBMiConnectionSettings to be used throughout to get settings
          let connSettings = new IBMiSettings(this);

          // Check shell output for additional user text - this will confuse Code...
          progress.report({
            message: `Checking shell output.`
          });

          const checkShellResult = await connSettings.checkShellOutput();

          if (!checkShellResult) {
            const chosen = await vscode.window.showErrorMessage(`Error in shell configuration!`, {
              detail: [
                `This extension can not work with the shell configured on ${this.currentConnectionName},`,
                `since the output from shell commands have additional content.`,
                `This can be caused by running commands like "echo" or other`,
                `commands creating output in your shell start script.`, ``,
                `The connection to ${this.currentConnectionName} will be aborted.`
              ].join(`\n`),
              modal: true
            }, `Read more`);

            if (chosen === `Read more`) {
              vscode.commands.executeCommand(`vscode.open`, `https://codefori.github.io/docs/#/pages/tips/setup`);
            }

            throw (`Shell config error, connection aborted.`);
          }

          // Register handlers after we might have to abort due to bad configuration.
          this.client.connection!.once(`timeout`, timeoutHandler);
          this.client.connection!.once(`end`, timeoutHandler);
          this.client.connection!.once(`error`, timeoutHandler);

          if (!reconnecting) {
            instance.setConnection(this);
          }

          progress.report({
            message: `Checking home directory.`
          });

          const homeResult = await connSettings.getHomeDirectory();
          if (homeResult.homeMsg) {
            if (homeResult.homeExists) {
              //Home Directory exists but give informational message
              await vscode.window.showWarningMessage(homeResult.homeMsg, { modal: !reconnecting });
            }
            else {
              //Home Directory does not exist
              if (reconnecting) {
                vscode.window.showWarningMessage(homeResult.homeMsg, { modal: false });
              }
              else {
                if (await vscode.window.showWarningMessage(`Home directory does not exist`, {
                  modal: true,
                  detail: `Your home directory (${homeResult.homeDir}) does not exist, so Code for IBM i may not function correctly. Would you like to create this directory now?`,
                }, `Yes`)) {
                  this.appendOutput(`creating home directory ${homeResult.homeDir}`);
                  let homeCreatedResult = await connSettings.createHomeDirectory(homeResult.homeDir, connectionObject.username);
                  if (!homeCreatedResult.homeCreated) {
                    await vscode.window.showWarningMessage(homeCreatedResult.homeMsg, { modal: true });
                  }
                }
              }
            }
          }

          // Check to see if we need to store a new value for the home directory
          if (homeResult.homeDir) {
            if (this.config.homeDirectory !== homeResult.homeDir) {
              this.config.homeDirectory = homeResult.homeDir;
              vscode.window.showInformationMessage(`Configured home directory reset to ${homeResult.homeDir}.`);
            }
          } else {
            // New connections always have `.` as the initial value.
            // If we can't find a usable home directory, just reset it to
            // the initial default.
            this.config.homeDirectory = `.`;
          }

          //Set a default IFS listing
          if (this.config.ifsShortcuts.length === 0) {
            if (homeResult.homeDir) {
              this.config.ifsShortcuts = [this.config.homeDirectory];
            } else {
              this.config.ifsShortcuts = [`/`];
            }
          }

          progress.report({
            message: `Checking library list configuration.`
          });

          this.defaultUserLibraries = [];

          let libraryListResult = await connSettings.getLibraryList();
          if (libraryListResult.libStatus) {
            
            this.defaultUserLibraries = libraryListResult.defaultUserLibraries;

            //If this is the first time the config is made, then these arrays will be empty
            if (this.config.currentLibrary.length === 0) {
              this.config.currentLibrary = libraryListResult.currentLibrary;
            }
            if (this.config.libraryList.length === 0) {
              this.config.libraryList = libraryListResult.defaultUserLibraries;
            }
          }

          progress.report({
            message: `Checking temporary library configuration.`
          });

          //Next, we need to check the temp lib (where temp outfile data lives) exists
          tempLibrarySet = await connSettings.setTempLibrary(this.config.tempLibrary);
          if (!tempLibrarySet) {
            if (libraryListResult.currentLibrary && !libraryListResult.currentLibrary.startsWith(`Q`)) {
              //Using ${currentLibrary} as the temporary library for temporary data.
              this.config.tempLibrary = this.config.currentLibrary;
              tempLibrarySet = true;
            }
          }

          progress.report({
            message: `Checking temporary directory configuration.`
          });

          let tempDirSet = await connSettings.setTempDirectory(this.config.tempDir);

          if (!tempDirSet) {
            this.config.tempDir = `/tmp`;
          }

          if (tempLibrarySet && this.config.autoClearTempData) {
            progress.report({
              message: `Clearing temporary data.`
            });
            //Clear Temporary Library Data
            let clearMsg = await connSettings.clearTempLibrary(this.config.tempLibrary);
            if (clearMsg) {
              // @ts-ignore We know the config exists.
              vscode.window.showErrorMessage(clearMsg, `View log`).then
                (async choice => {
                  if (choice === `View log`) {
                    this.outputChannel!.show();
                  }
                });
            }

            //Clear Temporary Directory Data
            clearMsg = await connSettings.clearTempDirectory(this.config.tempDir);
            if (clearMsg) {
              // @ts-ignore We know the config exists.
              vscode.window.showErrorMessage(clearMsg, `View log`).then
                (async choice => {
                  if (choice === `View log`) {
                    this.outputChannel!.show();
                  }
                });
            }

          }

          //TO DO: why is this required????
          const commandShellResult = await this.sendCommand({
            command: `echo $SHELL`
          });

          //TO DO: why is this required????
          if (commandShellResult.code === 0) {
            this.shell = commandShellResult.stdout.trim();
          }

          // Check for bad data areas?
          if (quickConnect === true && cachedServerSettings?.badDataAreasChecked === true) {
            // Do nothing, bad data areas are already checked.
          } else {
            progress.report({
              message: `Checking for bad data areas.`
            });

            const QCPTOIMPF = await connSettings.checkObjectExists('QSYS', 'QCPTOIMPF', '*DTAARA');

            if (QCPTOIMPF) {
              vscode.window.showWarningMessage(`The data area QSYS/QCPTOIMPF exists on this system and may impact Code for IBM i functionality.`, {
                detail: `For V5R3, the code for the command CPYTOIMPF had a major design change to increase functionality and performance. The QSYS/QCPTOIMPF data area lets developers keep the pre-V5R2 version of CPYTOIMPF. Code for IBM i cannot function correctly while this data area exists.`,
                modal: true,
              }, `Delete`, `Read more`).then(choice => {
                switch (choice) {
                  case `Delete`:
                    connSettings.deleteObject('QSYS', 'QCPTOIMPF', '*DTAARA').then((result) => {
                      if (result) {
                        vscode.window.showInformationMessage(`The data
                        area QSYS/QCPTOIMPF has been deleted.`);
                      }
                      else {
                        vscode.window.showInformationMessage(`Failed to 
                        delete the data area QSYS/QCPTOIMPF. Code for IBM
                        i may not work as intended.`);
                      }
                    });
                    break;
                  case `Read more`:
                    vscode.env.openExternal(vscode.Uri.parse(`https://github.com/codefori/vscode-ibmi/issues/476#issuecomment-1018908018`));
                    break;
                }
              });
            }

            const QCPFRMIMPF = await connSettings.checkObjectExists('QSYS', 'QCPFRMIMPF', '*DTAARA');

            if (QCPFRMIMPF) {
              vscode.window.showWarningMessage(`The data area QSYS/QCPFRMIMPF exists on this system and may impact Code for IBM i functionality.`, {
                modal: false,
              }, `Delete`, `Read more`).then(choice => {
                switch (choice) {
                  case `Delete`:
                    connSettings.deleteObject('QSYS', 'QCPFRMIMPF', '*DTAARA')
                      .then((result) => {
                        if (result) {
                          vscode.window.showInformationMessage(`The data area QSYS/QCPFRMIMPF has been deleted.`);
                        } else {
                          vscode.window.showInformationMessage(`Failed to delete the data area QSYS/QCPFRMIMPF. Code for IBM i may not work as intended.`);
                        }
                      })
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

            let remoteApps = new IBMiApps();

            // We need to check if our remote programs are installed.
            remoteApps.addRemoteApp(
              {
                path: `/QSYS.lib/${this.upperCaseName(this.config.tempLibrary)}.lib/`,
                names: [`GETNEWLIBL.PGM`],
                specific: `GE*.PGM`
              }
            );

            //Next, we see what pase features are available (installed via yum)
            //This may enable certain features in the future.
            for (const remoteApp of remoteApps.getRemoteApps()) {
              try {
                progress.report({
                  message: `Checking installed components on host IBM i: ${remoteApp.path}`
                });

                await remoteApps.checkRemoteFeatures(remoteApp, this);
                this.remoteFeatures = remoteApps.getRemoteFeatures();

              } catch (e) {
                console.log(e);
              }
            }
          }

          if (this.sqlRunnerAvailable()) {

            // Check for ASP information?
            if (quickConnect === true && cachedServerSettings?.aspInfo) {
              this.aspInfo = cachedServerSettings.aspInfo;
            } else {
              progress.report({
                message: `Checking for ASP information.`
              });

              //This is mostly a nice to have. We grab the ASP info so user's do
              //not have to provide the ASP in the settings.

              this.aspInfo = await connSettings.getASPInfo();
              if (Object.keys(this.aspInfo).length === 0) {
                progress.report({
                  message: `Failed to get ASP information.`
                });
              }

            }

            // Fetch conversion values?
            if (quickConnect === true && cachedServerSettings?.jobCcsid !== null && cachedServerSettings?.variantChars && cachedServerSettings?.userDefaultCCSID && cachedServerSettings?.qccsid) {
              this.qccsid = cachedServerSettings.qccsid;
              this.jobCcsid = cachedServerSettings.jobCcsid;
              this.variantChars = cachedServerSettings.variantChars;
              this.userDefaultCCSID = cachedServerSettings.userDefaultCCSID;
            } else {
              progress.report({
                message: `Fetching conversion values.`
              });

              // Next, we're going to see if we can get the CCSID from the user or the system.
              // Some things don't work without it!!!
              try {
                // we need to grab the system CCSID (QCCSID)
                this.qccsid = await connSettings.getQCCSID();

                // we grab the users default CCSID
                this.jobCcsid = await connSettings.getjobCCSID(this.currentUser);

                // if the job ccsid is *SYSVAL, then assign it to sysval
                if (this.jobCcsid === CCSID_SYSVAL) {
                  this.jobCcsid = this.qccsid;
                }

                // Let's also get the user's default CCSID
                this.userDefaultCCSID = await connSettings.getDefaultCCSID();

                progress.report({
                  message: `Fetching local encoding values.`
                });

                this.variantChars.local = await connSettings.getLocalEncodingValues();

              } catch (e) {
                // Oh well!
                console.log(e);
              }
            }
          } else {
            // Disable it if it's not found
            if (this.enableSQL) {
              progress.report({
                message: `SQL program not installed. Disabling SQL.`
              });
            }
          }

          if (!this.enableSQL) {
            const encoding = this.getEncoding();
            // Show a message if the system CCSID is bad
            const ccsidMessage = this.qccsid === 65535 ? `The system QCCSID is not set correctly. We recommend changing the CCSID on your user profile first, and then changing your system QCCSID.` : undefined;

            // Show a message if the runtime CCSID is bad (which means both runtime and default CCSID are bad) - in theory should never happen
            const encodingMessage = encoding.invalid ? `Runtime CCSID detected as ${encoding.ccsid} and is invalid. Please change the CCSID or default CCSID in your user profile.` : undefined;

            vscode.window.showErrorMessage([
              ccsidMessage,
              encodingMessage,
              `Using fallback methods to access the IBM i file systems.`
            ].filter(x => x).join(` `));
          }

          // give user option to set bash as default shell.
          if (this.remoteFeatures[`bash`]) {
            try {
              //check users default shell

              if (!commandShellResult.stderr) {
                let usesBash = this.shell === bashShellPath;
                if (!usesBash) {
                  // make sure chsh is installed
                  if (this.remoteFeatures[`chsh`]) {
                    vscode.window.showInformationMessage(`IBM recommends using bash as your default shell.`, `Set shell to bash`, `Read More`,).then(async choice => {
                      switch (choice) {
                        case `Set shell to bash`:

                          const commandSetBashResult = await connSettings.setBash();

                          if (!commandSetBashResult) {
                            vscode.window.showInformationMessage(`Shell is now bash! Reconnect for change to take effect.`);
                            usesBash = true;
                          } else {
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

                if (usesBash) {
                  //Ensure /QOpenSys/pkgs/bin is found in $PATH
                  progress.report({
                    message: `Checking /QOpenSys/pkgs/bin in $PATH.`
                  });

                  if ((!quickConnect || !cachedServerSettings?.pathChecked)) {
                    
                    const bashrcFile = `${homeResult.homeDir}/.bashrc`;
                    
                    let bashrcExists = await connSettings.checkBashRCFile(bashrcFile);
                    
                    let checkPathResult = await connSettings.checkPaths(["/QOpenSys/pkgs/bin", "/usr/bin", "/QOpenSys/usr/bin"]);
                    
                    if (checkPathResult.reason && await vscode.window.showWarningMessage(`${checkPathResult.missingPath} not found in $PATH`, {
                      modal: true,
                      detail: `${checkPathResult.reason}, so Code for IBM i may not function correctly. Would you like to ${bashrcExists ? "update" : "create"} ${bashrcFile} to fix this now?`,
                    }, `Yes`)) {
                      delayedOperations.push(async () => {
                        this.appendOutput(`${bashrcExists ? "update" : "create"} ${bashrcFile}`);
                        if (!bashrcExists) {
                          //Create bashrc File
                          let createBashResult = await connSettings.createBashrcFile(bashrcFile,connectionObject.username);
                          //Error creating bashrc File
                          if (!createBashResult.createBash) {
                            vscode.window.showWarningMessage(`Error creating ${bashrcFile}):\n${createBashResult.createBashMsg}.\n\n Code for IBM i may not function correctly. Please contact your system administrator.`, { modal: true });
                          }
                        }
                        else {
                          //Update bashRC file
                          let updateBashResult = await connSettings.updateBashrcFile(bashrcFile);
                          if(!updateBashResult.updateBash) {
                            vscode.window.showWarningMessage(`Error modifying PATH in ${bashrcFile}):\n${updateBashResult.updateBashMsg}.\n\n Code for IBM i may not function correctly. Please contact your system administrator.`, { modal: true });
                          }
                        }
                      });
                    }
                  }
                }
              }
            } catch (e) {
              // Oh well...trying to set default shell is not worth stopping for.
              console.log(e);
            }
          }

          if (this.config.autoConvertIFSccsid) {
            if (this.remoteFeatures.attr === undefined || this.remoteFeatures.iconv === undefined) {
              this.config.autoConvertIFSccsid = false;
              vscode.window.showWarningMessage(`EBCDIC streamfiles will not be rendered correctly since \`attr\` or \`iconv\` is not installed on the host. They should both exist in \`\\usr\\bin\`.`);
            }
          }

          if (homeResult.homeDir) {
            if (!tempLibrarySet) {
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

              let libraryListResult = await connSettings.validateLibraryList(this.defaultUserLibraries,this.config.libraryList);
              if(libraryListResult.badLibs.length > 0) {
                const chosen = await vscode.window.showWarningMessage(`The following ${libraryListResult.badLibs.length > 1 ? `libraries` : `library`} does not exist: ${libraryListResult.badLibs.join(`,`)}. Remove ${libraryListResult.badLibs.length > 1 ? `them` : `it`} from the library list?`, `Yes`, `No`);
                if (chosen === `Yes`) {
                  this.config!.libraryList = libraryListResult.validLibs;
                } else {
                  vscode.window.showWarningMessage(`The following libraries does not exist: ${libraryListResult.badLibs.join(`,`)}.`);
                }
              }
            }
          }

          let debugConfigLoaded = false
          if ((!quickConnect || !cachedServerSettings?.debugConfigLoaded)) {
            if (debugPTFInstalled()) {
              try {
                const debugServiceConfig = await new DebugConfiguration().load();
                delete this.config.debugCertDirectory;
                this.config.debugPort = debugServiceConfig.getOrDefault("DBGSRV_SECURED_PORT", "8005");
                this.config.debugSepPort = debugServiceConfig.getOrDefault("DBGSRV_SEP_DAEMON_PORT", "8008");
                debugConfigLoaded = true;
              }
              catch (error) {
                vscode.window.showWarningMessage(`Could not load debug service configuration: ${error}`);
              }
            }
          }

          if ((!quickConnect || !cachedServerSettings?.maximumArgsLength)) {
            //Compute the maximum admited length of a command's arguments. Source: Googling and https://www.in-ulm.de/~mascheck/various/argmax/#effectively_usable
            this.maximumArgsLength = Number((await this.sendCommand({ command: "/QOpenSys/usr/bin/expr `/QOpenSys/usr/bin/getconf ARG_MAX` - `env|wc -c` - `env|wc -l` \\* 4 - 2048" })).stdout);
          }
          else {
            this.maximumArgsLength = cachedServerSettings.maximumArgsLength;
          }

          progress.report({ message: `Checking Code for IBM i components.` });
          await this.components.startup(this);

          if (!reconnecting) {
            vscode.workspace.getConfiguration().update(`workbench.editor.enablePreview`, false, true);
            await vscode.commands.executeCommand(`setContext`, `code-for-ibmi:connected`, true);
            for (const operation of delayedOperations) {
              await operation();
            }
          }

          instance.fire(`connected`);

          GlobalStorage.get().setServerSettingsCache(this.currentConnectionName, {
            aspInfo: this.aspInfo,
            qccsid: this.qccsid,
            jobCcsid: this.jobCcsid,
            remoteFeatures: this.remoteFeatures,
            remoteFeaturesKeys: Object.keys(this.remoteFeatures).sort().toString(),
            variantChars: {
              american: this.variantChars.american,
              local: this.variantChars.local,
            },
            badDataAreasChecked: true,
            libraryListValidated: true,
            pathChecked: true,
            userDefaultCCSID: this.userDefaultCCSID,
            debugConfigLoaded,
            maximumArgsLength: this.maximumArgsLength
          });

          //Keep track of variant characters that can be uppercased
          this.dangerousVariants = this.variantChars.local !== this.variantChars.local.toLocaleUpperCase();

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
    });
  }

  usingBash() {
    return this.shell === bashShellPath;
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

    return {
      ...result,
      code: result.code || 0,
    };
  }

  private appendOutput(content: string) {
    if (this.outputChannel) {
      this.outputChannel.append(content);
    }
    if (this.outputChannelContent !== undefined) {
      this.outputChannelContent += content;
    }
  }

  private determineClear() {
    if (this.commandsExecuted > 150) {
      if (this.outputChannel) {
        this.outputChannel.clear();
      }
      if (this.outputChannelContent !== undefined) {
        this.outputChannelContent = '';
      }
      this.commandsExecuted = 0;
    }

    this.commandsExecuted += 1;
  }

  private async disconnect() {
    this.client.connection?.removeAllListeners();
    this.client.dispose();
    this.client.connection = null;
    instance.fire(`disconnected`);
  }

  async end() {
    if (this.client.connection) {
      this.disconnect();
    }

    if (this.outputChannel) {
      this.outputChannel.hide();
      this.outputChannel.dispose();
    }

    if (this.outputChannelContent !== undefined) {
      this.outputChannelContent = undefined;
    }

    await Promise.all([
      vscode.commands.executeCommand("code-for-ibmi.refreshObjectBrowser"),
      vscode.commands.executeCommand("code-for-ibmi.refreshLibraryListView"),
      vscode.commands.executeCommand("code-for-ibmi.refreshIFSBrowser")
    ]);

    instance.setConnection(undefined);
    await vscode.commands.executeCommand(`setContext`, `code-for-ibmi:connected`, false);
    vscode.window.showInformationMessage(`Disconnected from ${this.currentHost}.`);
  }

  /**
   * SQL only available when runner is installed and CCSID is valid.
   */
  get enableSQL(): boolean {
    const sqlRunner = this.sqlRunnerAvailable();
    const encodings = this.getEncoding();
    return sqlRunner && encodings.invalid === false;
  }

  /**
   * Do not use this API directly.
   * It exists to support some backwards compatability.
   * @deprecated
   */
  set enableSQL(value: boolean) {
    this.remoteFeatures[`QZDFMDB2.PGM`] = value ? `/QSYS.LIB/QZDFMDB2.PGM` : undefined;
  }

  public sqlRunnerAvailable() {
    return this.remoteFeatures[`QZDFMDB2.PGM`] !== undefined;
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
    const upperCasedString = this.upperCaseName(string);
    const path = upperCasedString.startsWith(`/`) ? upperCasedString.substring(1).split(`/`) : upperCasedString.split(`/`);

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
  async withTempDirectory<T>(process: (directory: string) => Promise<T>) {
    const tempDirectory = `${this.config?.tempDir || '/tmp'}/code4itemp${Tools.makeid(20)}`;
    const prepareDirectory = await this.sendCommand({ command: `rm -rf ${tempDirectory} && mkdir -p ${tempDirectory}` });
    if (prepareDirectory.code === 0) {
      try {
        return await process(tempDirectory);
      }
      finally {
        await this.sendCommand({ command: `rm -rf ${tempDirectory}` });
      }
    }
    else {
      throw new Error(`Failed to create temporary directory ${tempDirectory}: ${prepareDirectory.stderr}`);
    }
  }

  /**
   * Uppercases an object name, keeping the variant chars case intact
   * @param name
   */
  upperCaseName(name: string) {
    if (this.dangerousVariants && new RegExp(`[${this.variantChars.local}]`).test(name)) {
      const upperCased = [];
      for (const char of name) {
        const upChar = char.toLocaleUpperCase();
        if (new RegExp(`[A-Z${this.variantChars.local}]`).test(upChar)) {
          upperCased.push(upChar);
        }
        else {
          upperCased.push(char);
        }
      }
      return upperCased.join("");
    }
    else {
      return name.toLocaleUpperCase();
    }
  }

  getComponent<T>(id: ComponentId) {
    return this.components.get<T>(id);
  }

  /**
   * Run SQL statements.
   * Each statement must be separated by a semi-colon and a new line (i.e. ;\n).
   * If a statement starts with @, it will be run as a CL command.
   *
   * @param statements
   * @returns a Result set
   */

  // TODO: stop using this.runSql
  async runSQL(statements: string): Promise<Tools.DB2Row[]> {
    const { 'QZDFMDB2.PGM': QZDFMDB2 } = this.remoteFeatures;

    if (QZDFMDB2) {
      const ccsidDetail = this.getEncoding();
      const useCcsid = ccsidDetail.fallback && !ccsidDetail.invalid ? ccsidDetail.ccsid : undefined;
      const possibleChangeCommand = (useCcsid ? `@CHGJOB CCSID(${useCcsid});\n` : '');

      let input = Tools.fixSQL(`${possibleChangeCommand}${statements}`, true);

      let returningAsCsv: WrapResult | undefined;

      if (this.qccsid === 65535) {
        let list = input.split(`\n`).join(` `).split(`;`).filter(x => x.trim().length > 0);
        const lastStmt = list.pop()?.trim();
        const asUpper = lastStmt?.toUpperCase();

        if (lastStmt) {
          if ((asUpper?.startsWith(`SELECT`) || asUpper?.startsWith(`WITH`))) {
            const copyToImport = this.getComponent<CopyToImport>(`CopyToImport`);
            if (copyToImport) {
              returningAsCsv = copyToImport.wrap(lastStmt);
              list.push(...returningAsCsv.newStatements);
              input = list.join(`;\n`);
            }
          }

          if (!returningAsCsv) {
            list.push(lastStmt);
          }
        }
      }

      const output = await this.sendCommand({
        command: `LC_ALL=EN_US.UTF-8 system "call QSYS/QZDFMDB2 PARM('-d' '-i' '-t')"`,
        stdin: input
      })

      if (output.stdout) {
        Tools.db2Parse(output.stdout, input);

        if (returningAsCsv) {
          // Will throw an error if stdout contains an error

          const csvContent = await this.content.downloadStreamfile(returningAsCsv.outStmf);
          if (csvContent) {
            this.sendCommand({ command: `rm -rf "${returningAsCsv.outStmf}"` });

            return parse(csvContent, {
              columns: true,
              skip_empty_lines: true,
              cast: true,
              onRecord(record) {
                for (const key of Object.keys(record)) {
                  record[key] = record[key] === ` ` ? `` : record[key];
                }
                return record;
              }
            }) as Tools.DB2Row[];
          }

          throw new Error(`There was an error fetching the SQL result set.`)
        } else {
          return Tools.db2Parse(output.stdout);
        }
      }
    }

    throw new Error(`There is no way to run SQL on this system.`);
  }

  getEncoding() {
    const fallbackToDefault = ((this.jobCcsid < 1 || this.jobCcsid === 65535) && this.userDefaultCCSID > 0);
    const ccsid = fallbackToDefault ? this.userDefaultCCSID : this.jobCcsid;
    return {
      fallback: fallbackToDefault,
      ccsid,
      invalid: (ccsid < 1 || ccsid === 65535)
    };
  }

  getCcsids() {
    return {
      qccsid: this.qccsid,
      runtimeCcsid: this.jobCcsid,
      userDefaultCCSID: this.userDefaultCCSID,
    };
  }

  async checkUserSpecialAuthorities(authorities: SpecialAuthorities[], user?: string) {
    const profile = (user || this.currentUser).toLocaleUpperCase();
    const [row] = await this.runSQL(
      `select trim(coalesce(usr.special_authorities,'') concat ' ' concat coalesce(grp.special_authorities, '')) AUTHORITIES ` +
      `from qsys2.user_info_basic usr ` +
      `left join qsys2.user_info_basic grp on grp.authorization_name = usr.group_profile_name ` +
      `where usr.authorization_name = '${profile}'`
    );

    const userAuthorities = row?.AUTHORITIES ? String(row.AUTHORITIES).split(" ").filter(Boolean).filter(Tools.distinct) : [];
    const missing = authorities.filter(auth => !userAuthorities.includes(auth));
    return { valid: !Boolean(missing.length), missing };
  }
}