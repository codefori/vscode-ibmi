import { parse } from 'csv-parse/sync';
import { existsSync } from "fs";
import * as node_ssh from "node-ssh";
import os from "os";
import path, { parse as parsePath } from 'path';
import * as vscode from "vscode";
import { IBMiComponent } from "../components/component";
import { CopyToImport } from "../components/copyToImport";
import { CustomQSh } from '../components/cqsh';
import { ComponentManager } from "../components/manager";
import { instance } from "../instantiate";
import { CommandData, CommandResult, ConnectionData, IBMiMember, RemoteCommand, SpecialAuthorities, WrapResult } from "../typings";
import { CompileTools } from "./CompileTools";
import { ConnectionConfiguration } from "./Configuration";
import IBMiContent from "./IBMiContent";
import { CachedServerSettings, GlobalStorage } from './Storage';
import { Tools } from './Tools';
import * as configVars from './configVars';
import { DebugConfiguration } from "./debug/config";
import { debugPTFInstalled } from "./debug/server";

export interface MemberParts extends IBMiMember {
  basename: string
}

const CCSID_NOCONVERSION = 65535;
const CCSID_SYSVAL = -2;
const bashShellPath = '/QOpenSys/pkgs/bin/bash';

const remoteApps = [ // All names MUST also be defined as key in 'remoteFeatures' below!!
  {
    path: `/usr/bin/`,
    names: [`setccsid`, `iconv`, `attr`, `tar`, `ls`, `uname`]
  },
  {
    path: `/QOpenSys/pkgs/bin/`,
    names: [`git`, `grep`, `tn5250`, `md5sum`, `bash`, `chsh`, `stat`, `sort`, `tar`, `ls`, `find`]
  },
  {
    path: `/QSYS.LIB/`,
    // In the future, we may use a generic specific.
    // Right now we only need one program
    // specific: `*.PGM`,
    specific: `QZDFMDB2.PGM`,
    names: [`QZDFMDB2.PGM`]
  },
  {
    path: `/QIBM/ProdData/IBMiDebugService/bin/`,
    specific: `startDebugService.sh`,
    names: [`startDebugService.sh`]
  }
];

export default class IBMi {
  private systemVersion: number = 0;
  private qccsid: number = CCSID_NOCONVERSION;
  private userJobCcsid: number = CCSID_SYSVAL;
  /** User default CCSID is job default CCSID */
  private userDefaultCCSID: number = 0;
  private sshdCcsid: number | undefined;

  private componentManager = new ComponentManager(this);

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
  remoteFeatures: { [name: string]: string | undefined };

  variantChars: {
    american: string,
    local: string,
    qsysNameRegex?: RegExp
  };

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

  get canUseCqsh() {
    return this.getComponent(CustomQSh.ID) !== undefined;
  }

  /**
   * Primarily used for running SQL statements.
   */
  get userCcsidInvalid() {
    return this.userJobCcsid === CCSID_NOCONVERSION;
  }

  /**
   * Determines if the client should do variant translation.
   * False when cqsh should be used.
   * True when cqsh is not available and the job CCSID is not the same as the SSHD CCSID.
   */
  get requiresTranslation() {
    if (this.canUseCqsh) {
      return false;
    } else {
      return this.getCcsid() !== this.sshdCcsid;
    }
  }

  get dangerousVariants() {
    return this.variantChars.local !== this.variantChars.local.toLocaleUpperCase();
  };

  constructor() {
    this.client = new node_ssh.NodeSSH;

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
      'GETMBRINFO.SQL': undefined,
      'QZDFMDB2.PGM': undefined,
      'startDebugService.sh': undefined,
      attr: undefined,
      iconv: undefined,
      tar: undefined,
      ls: undefined,
      find: undefined,
      jdk80: undefined,
      jdk11: undefined,
      jdk17: undefined,
      openjdk11: undefined,
      uname: undefined,
    };

    this.variantChars = {
      american: `#@$`,
      local: `#@$`
    };
  }

  /**
   * @returns {Promise<{success: boolean, error?: any}>} Was succesful at connecting or not.
   */
  async connect(connectionObject: ConnectionData, reconnecting?: boolean, reloadServerSettings: boolean = false, onConnectedOperations: Function[] = []): Promise<{ success: boolean, error?: any }> {
    const currentExtensionVersion = process.env.VSCODEIBMI_VERSION;
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

          await this.client.connect({
            ...connectionObject,
            privateKeyPath: connectionObject.privateKeyPath ? Tools.resolvePath(connectionObject.privateKeyPath) : undefined
          } as node_ssh.Config);

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
            this.appendOutput(`Code for IBM i, version ${currentExtensionVersion}\n\n`);
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
          const quickConnect = () => {
            return (this.config!.quickConnect === true && reloadServerSettings === false);
          }

          // Check shell output for additional user text - this will confuse Code...
          progress.report({
            message: `Checking shell output.`
          });

          const checkShellText = `This should be the only text!`;
          const checkShellResult = await this.sendCommand({
            command: `echo "${checkShellText}"`,
            directory: `.`
          });
          if (checkShellResult.stdout.split(`\n`)[0] !== checkShellText) {
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

          let defaultHomeDir;

          const echoHomeResult = await this.sendCommand({
            command: `echo $HOME && cd && test -w $HOME`,
            directory: `.`
          });
          // Note: if the home directory does not exist, the behavior of the echo/cd/test command combo is as follows:
          //   - stderr contains 'Could not chdir to home directory /home/________: No such file or directory'
          //       (The output contains 'chdir' regardless of locale and shell, so maybe we could use that
          //        if we iterate on this code again in the future)
          //   - stdout contains the name of the home directory (even if it does not exist)
          //   - The 'cd' command causes an error if the home directory does not exist or otherwise can't be cd'ed into
          //   - The 'test' command causes an error if the home directory is not writable (one can cd into a non-writable directory)
          let isHomeUsable = (0 == echoHomeResult.code);
          if (isHomeUsable) {
            defaultHomeDir = echoHomeResult.stdout.trim();
          } else {
            // Let's try to provide more valuable information to the user about why their home directory
            // is bad and maybe even provide the opportunity to create the home directory

            let actualHomeDir = echoHomeResult.stdout.trim();

            // we _could_ just assume the home directory doesn't exist but maybe there's something more going on, namely mucked-up permissions
            let doesHomeExist = (0 === (await this.sendCommand({ command: `test -e ${actualHomeDir}` })).code);
            if (doesHomeExist) {
              // Note: this logic might look backward because we fall into this (failure) leg on what looks like success (home dir exists).
              //       But, remember, but we only got here if 'cd $HOME' failed.
              //       Let's try to figure out why....
              if (0 !== (await this.sendCommand({ command: `test -d ${actualHomeDir}` })).code) {
                await vscode.window.showWarningMessage(`Your home directory (${actualHomeDir}) is not a directory! Code for IBM i may not function correctly. Please contact your system administrator.`, { modal: !reconnecting });
              }
              else if (0 !== (await this.sendCommand({ command: `test -w ${actualHomeDir}` })).code) {
                await vscode.window.showWarningMessage(`Your home directory (${actualHomeDir}) is not writable! Code for IBM i may not function correctly. Please contact your system administrator.`, { modal: !reconnecting });
              }
              else if (0 !== (await this.sendCommand({ command: `test -x ${actualHomeDir}` })).code) {
                await vscode.window.showWarningMessage(`Your home directory (${actualHomeDir}) is not usable due to permissions! Code for IBM i may not function correctly. Please contact your system administrator.`, { modal: !reconnecting });
              }
              else {
                // not sure, but get your sys admin involved
                await vscode.window.showWarningMessage(`Your home directory (${actualHomeDir}) exists but is unusable. Code for IBM i may not function correctly. Please contact your system administrator.`, { modal: !reconnecting });
              }
            }
            else if (reconnecting) {
              vscode.window.showWarningMessage(`Your home directory (${actualHomeDir}) does not exist. Code for IBM i may not function correctly.`, { modal: false });
            }
            else if (await vscode.window.showWarningMessage(`Home directory does not exist`, {
              modal: true,
              detail: `Your home directory (${actualHomeDir}) does not exist, so Code for IBM i may not function correctly. Would you like to create this directory now?`,
            }, `Yes`)) {
              this.appendOutput(`creating home directory ${actualHomeDir}`);
              let mkHomeCmd = `mkdir -p ${actualHomeDir} && chown ${connectionObject.username.toLowerCase()} ${actualHomeDir} && chmod 0755 ${actualHomeDir}`;
              let mkHomeResult = await this.sendCommand({ command: mkHomeCmd, directory: `.` });
              if (0 === mkHomeResult.code) {
                defaultHomeDir = actualHomeDir;
              } else {
                let mkHomeErrs = mkHomeResult.stderr;
                // We still get 'Could not chdir to home directory' in stderr so we need to hackily gut that out, as well as the bashisms that are a side effect of our API
                mkHomeErrs = mkHomeErrs.substring(1 + mkHomeErrs.indexOf(`\n`)).replace(`bash: line 1: `, ``);
                await vscode.window.showWarningMessage(`Error creating home directory (${actualHomeDir}):\n${mkHomeErrs}.\n\n Code for IBM i may not function correctly. Please contact your system administrator.`, { modal: true });
              }
            }
          }

          // Check to see if we need to store a new value for the home directory
          if (defaultHomeDir) {
            if (this.config.homeDirectory !== defaultHomeDir) {
              this.config.homeDirectory = defaultHomeDir;
              vscode.window.showInformationMessage(`Configured home directory reset to ${defaultHomeDir}.`);
            }
          } else {
            // New connections always have `.` as the initial value.
            // If we can't find a usable home directory, just reset it to
            // the initial default.
            this.config.homeDirectory = `.`;
          }

          //Set a default IFS listing
          if (this.config.ifsShortcuts.length === 0) {
            if (defaultHomeDir) {
              this.config.ifsShortcuts = [this.config.homeDirectory];
            } else {
              this.config.ifsShortcuts = [`/`];
            }
          }

          // If the version has changed (by update for example), then fetch everything again
          if (cachedServerSettings?.lastCheckedOnVersion !== currentExtensionVersion) {
            reloadServerSettings = true;
          }

          // Check for installed components?
          // For Quick Connect to work here, 'remoteFeatures' MUST have all features defined and no new properties may be added!
          if (quickConnect() && cachedServerSettings?.remoteFeaturesKeys && cachedServerSettings.remoteFeaturesKeys === Object.keys(this.remoteFeatures).sort().toString()) {
            Object.assign(this.remoteFeatures, cachedServerSettings.remoteFeatures);
          } else {
            progress.report({
              message: `Checking installed components on host IBM i.`
            });

            // We need to check if our remote programs are installed.
            remoteApps.push(
              {
                path: `/QSYS.lib/${this.upperCaseName(this.config.tempLibrary)}.lib/`,
                names: [`GETNEWLIBL.PGM`],
                specific: `GE*.PGM`
              }
            );

            //Next, we see what pase features are available (installed via yum)
            //This may enable certain features in the future.
            for (const feature of remoteApps) {
              try {
                progress.report({
                  message: `Checking installed components on host IBM i: ${feature.path}`
                });

                const call = await this.sendCommand({ command: `ls -p ${feature.path}${feature.specific || ``}` });
                if (call.stdout) {
                  const files = call.stdout.split(`\n`);

                  if (feature.specific) {
                    for (const name of feature.names)
                      this.remoteFeatures[name] = files.find(file => file.includes(name));
                  } else {
                    for (const name of feature.names)
                      if (files.includes(name))
                        this.remoteFeatures[name] = feature.path + name;
                  }
                }
              } catch (e) {
                console.log(e);
              }
            }

            //Specific Java installations check
            progress.report({
              message: `Checking installed components on host IBM i: Java`
            });
            const javaCheck = async (root: string) => await this.content.testStreamFile(`${root}/bin/java`, 'x') ? root : undefined;
            this.remoteFeatures.jdk80 = await javaCheck(`/QOpenSys/QIBM/ProdData/JavaVM/jdk80/64bit`);
            this.remoteFeatures.jdk11 = await javaCheck(`/QOpenSys/QIBM/ProdData/JavaVM/jdk11/64bit`);
            this.remoteFeatures.openjdk11 = await javaCheck(`/QOpensys/pkgs/lib/jvm/openjdk-11`);
            this.remoteFeatures.jdk17 = await javaCheck(`/QOpenSys/QIBM/ProdData/JavaVM/jdk17/64bit`);
          }

          if (this.remoteFeatures.uname) {
            progress.report({
              message: `Checking OS version.`
            });
            const systemVersionResult = await this.sendCommand({ command: `${this.remoteFeatures.uname} -rv` });

            if (systemVersionResult.code === 0) {
              const version = systemVersionResult.stdout.trim().split(` `);
              this.systemVersion = Number(`${version[1]}.${version[0]}`);
            }
          }

          if (!this.systemVersion) {
            vscode.window.showWarningMessage(`Unable to determine system version. Code for IBM i only supports 7.3 and above. Some features may not work correctly.`);
          } else if (this.systemVersion < 7.3) {
            vscode.window.showWarningMessage(`IBM i ${this.systemVersion} is not supported. Code for IBM i only supports 7.3 and above. Some features may not work correctly.`);
          }

          progress.report({ message: `Checking Code for IBM i components.` });
          await this.componentManager.startup();

          const componentStates = this.componentManager.getState();
          this.appendOutput(`\nCode for IBM i components:\n`);
          Array.from(componentStates.entries()).forEach(([name, state]) => {
            this.appendOutput(`\t${name} (${state.id.version}): ${state.state}\n`);
          });
          this.appendOutput(`\n`);

          progress.report({
            message: `Checking library list configuration.`
          });

          //Since the compiles are stateless, then we have to set the library list each time we use the `SYSTEM` command
          //We setup the defaultUserLibraries here so we can remove them later on so the user can setup their own library list
          let currentLibrary = `QGPL`;
          this.defaultUserLibraries = [];

          const liblResult = await this.sendQsh({
            command: `liblist`
          });
          if (liblResult.code === 0) {
            const libraryListString = liblResult.stdout;
            if (libraryListString !== ``) {
              const libraryList = libraryListString.split(`\n`);

              let lib, type;
              for (const line of libraryList) {
                lib = line.substring(0, 10).trim();
                type = line.substring(12);

                switch (type) {
                  case `USR`:
                    this.defaultUserLibraries.push(lib);
                    break;

                  case `CUR`:
                    currentLibrary = lib;
                    break;
                }
              }

              //If this is the first time the config is made, then these arrays will be empty
              if (this.config.currentLibrary.length === 0) {
                this.config.currentLibrary = currentLibrary;
              }
              if (this.config.libraryList.length === 0) {
                this.config.libraryList = this.defaultUserLibraries;
              }
            }
          }

          progress.report({
            message: `Checking temporary library configuration.`
          });

          //Next, we need to check the temp lib (where temp outfile data lives) exists
          const createdTempLib = await this.runCommand({
            command: `CRTLIB LIB(${this.config.tempLibrary}) TEXT('Code for i temporary objects. May be cleared.')`,
            noLibList: true
          });

          if (createdTempLib.code === 0) {
            tempLibrarySet = true;
          } else {
            const messages = Tools.parseMessages(createdTempLib.stderr);
            if (messages.findId(`CPF2158`) || messages.findId(`CPF2111`)) { //Already exists, hopefully ok :)
              tempLibrarySet = true;
            }
            else if (messages.findId(`CPD0032`)) { //Can't use CRTLIB
              const tempLibExists = await this.runCommand({
                command: `CHKOBJ OBJ(QSYS/${this.config.tempLibrary}) OBJTYPE(*LIB)`,
                noLibList: true
              });

              if (tempLibExists.code === 0) {
                //We're all good if no errors
                tempLibrarySet = true;
              } else if (currentLibrary && !currentLibrary.startsWith(`Q`)) {
                //Using ${currentLibrary} as the temporary library for temporary data.
                this.config.tempLibrary = currentLibrary;
                tempLibrarySet = true;
              }
            }
          }

          progress.report({
            message: `Checking temporary directory configuration.`
          });

          let tempDirSet = false;
          // Next, we need to check if the temp directory exists
          let result = await this.sendCommand({
            command: `[ -d "${this.config.tempDir}" ]`
          });

          if (result.code === 0) {
            // Directory exists
            tempDirSet = true;
          } else {
            // Directory does not exist, try to create it
            let result = await this.sendCommand({
              command: `mkdir -p ${this.config.tempDir}`
            });
            if (result.code === 0) {
              // Directory created
              tempDirSet = true;
            } else {
              // Directory not created
            }
          }

          if (!tempDirSet) {
            this.config.tempDir = `/tmp`;
          }

          if (tempLibrarySet && this.config.autoClearTempData) {
            progress.report({
              message: `Clearing temporary data.`
            });

            this.runCommand({
              command: `DLTOBJ OBJ(${this.config.tempLibrary}/O_*) OBJTYPE(*FILE)`,
              noLibList: true,
            })
              .then(result => {
                // All good!
                if (result && result.stderr) {
                  const messages = Tools.parseMessages(result.stderr);
                  if (!messages.findId(`CPF2125`)) {
                    // @ts-ignore We know the config exists.
                    vscode.window.showErrorMessage(`Temporary data not cleared from ${this.config.tempLibrary}.`, `View log`).then(async choice => {
                      if (choice === `View log`) {
                        this.outputChannel!.show();
                      }
                    });
                  }
                }
              })

            this.sendCommand({
              command: `rm -rf ${path.posix.join(this.config.tempDir, `vscodetemp*`)}`
            })
              .then(result => {
                // All good!
              })
              .catch(e => {
                // CPF2125: No objects deleted.
                // @ts-ignore We know the config exists.
                vscode.window.showErrorMessage(`Temporary data not cleared from ${this.config.tempDir}.`, `View log`).then(async choice => {
                  if (choice === `View log`) {
                    this.outputChannel!.show();
                  }
                });
              });
          }

          const commandShellResult = await this.sendCommand({
            command: `echo $SHELL`
          });

          if (commandShellResult.code === 0) {
            this.shell = commandShellResult.stdout.trim();
          }

          // Check for bad data areas?
          if (quickConnect() && cachedServerSettings?.badDataAreasChecked === true) {
            // Do nothing, bad data areas are already checked.
          } else {
            progress.report({
              message: `Checking for bad data areas.`
            });

            const QCPTOIMPF = await this.runCommand({
              command: `CHKOBJ OBJ(QSYS/QCPTOIMPF) OBJTYPE(*DTAARA)`,
              noLibList: true
            });

            if (QCPTOIMPF?.code === 0) {
              vscode.window.showWarningMessage(`The data area QSYS/QCPTOIMPF exists on this system and may impact Code for IBM i functionality.`, {
                detail: `For V5R3, the code for the command CPYTOIMPF had a major design change to increase functionality and performance. The QSYS/QCPTOIMPF data area lets developers keep the pre-V5R2 version of CPYTOIMPF. Code for IBM i cannot function correctly while this data area exists.`,
                modal: true,
              }, `Delete`, `Read more`).then(choice => {
                switch (choice) {
                  case `Delete`:
                    this.runCommand({
                      command: `DLTOBJ OBJ(QSYS/QCPTOIMPF) OBJTYPE(*DTAARA)`,
                      noLibList: true
                    })
                      .then((result) => {
                        if (result?.code === 0) {
                          vscode.window.showInformationMessage(`The data area QSYS/QCPTOIMPF has been deleted.`);
                        } else {
                          vscode.window.showInformationMessage(`Failed to delete the data area QSYS/QCPTOIMPF. Code for IBM i may not work as intended.`);
                        }
                      })
                    break;
                  case `Read more`:
                    vscode.env.openExternal(vscode.Uri.parse(`https://github.com/codefori/vscode-ibmi/issues/476#issuecomment-1018908018`));
                    break;
                }
              });
            }

            const QCPFRMIMPF = await this.runCommand({
              command: `CHKOBJ OBJ(QSYS/QCPFRMIMPF) OBJTYPE(*DTAARA)`,
              noLibList: true
            });

            if (QCPFRMIMPF?.code === 0) {
              vscode.window.showWarningMessage(`The data area QSYS/QCPFRMIMPF exists on this system and may impact Code for IBM i functionality.`, {
                modal: false,
              }, `Delete`, `Read more`).then(choice => {
                switch (choice) {
                  case `Delete`:
                    this.runCommand({
                      command: `DLTOBJ OBJ(QSYS/QCPFRMIMPF) OBJTYPE(*DTAARA)`,
                      noLibList: true
                    })
                      .then((result) => {
                        if (result?.code === 0) {
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
                          const commandSetBashResult = await this.sendCommand({
                            command: `/QOpenSys/pkgs/bin/chsh -s /QOpenSys/pkgs/bin/bash`
                          });

                          if (!commandSetBashResult.stderr) {
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
                    const currentPaths = (await this.sendCommand({ command: "echo $PATH" })).stdout.split(":");
                    const bashrcFile = `${defaultHomeDir}/.bashrc`;
                    let bashrcExists = (await this.sendCommand({ command: `test -e ${bashrcFile}` })).code === 0;
                    let reason;
                    const requiredPaths = ["/QOpenSys/pkgs/bin", "/usr/bin", "/QOpenSys/usr/bin"]
                    let missingPath;
                    for (const requiredPath of requiredPaths) {
                      if (!currentPaths.includes(requiredPath)) {
                        reason = `Your $PATH shell environment variable does not include ${requiredPath}`;
                        missingPath = requiredPath
                        break;
                      }
                    }
                    // If reason is still undefined, then we know the user has all the required paths. Then we don't 
                    // need to check for their existence before checking the order of the required paths.
                    if (!reason &&
                      (currentPaths.indexOf("/QOpenSys/pkgs/bin") > currentPaths.indexOf("/usr/bin")
                        || (currentPaths.indexOf("/QOpenSys/pkgs/bin") > currentPaths.indexOf("/QOpenSys/usr/bin")))) {
                      reason = "/QOpenSys/pkgs/bin is not in the right position in your $PATH shell environment variable";
                      missingPath = "/QOpenSys/pkgs/bin"
                    }
                    if (reason && await vscode.window.showWarningMessage(`${missingPath} not found in $PATH`, {
                      modal: true,
                      detail: `${reason}, so Code for IBM i may not function correctly. Would you like to ${bashrcExists ? "update" : "create"} ${bashrcFile} to fix this now?`,
                    }, `Yes`)) {
                      delayedOperations.push(async () => {
                        this.appendOutput(`${bashrcExists ? "update" : "create"} ${bashrcFile}`);
                        if (!bashrcExists) {
                          // Add "/usr/bin" and "/QOpenSys/usr/bin" to the end of the path. This way we know that the user has 
                          // all the required paths, but we don't overwrite the priority of other items on their path.
                          const createBashrc = await this.sendCommand({ command: `echo "# Generated by Code for IBM i\nexport PATH=/QOpenSys/pkgs/bin:\\$PATH:/QOpenSys/usr/bin:/usr/bin" >> ${bashrcFile} && chown ${connectionObject.username.toLowerCase()} ${bashrcFile} && chmod 755 ${bashrcFile}` });
                          if (createBashrc.code !== 0) {
                            vscode.window.showWarningMessage(`Error creating ${bashrcFile}):\n${createBashrc.stderr}.\n\n Code for IBM i may not function correctly. Please contact your system administrator.`, { modal: true });
                          }
                        }
                        else {
                          try {
                            const content = this.content;
                            if (content) {
                              const bashrcContent = (await content.downloadStreamfile(bashrcFile)).split("\n");
                              let replaced = false;
                              bashrcContent.forEach((line, index) => {
                                if (!replaced) {
                                  const pathRegex = /^((?:export )?PATH=)(.*)(?:)$/.exec(line);
                                  if (pathRegex) {
                                    bashrcContent[index] = `${pathRegex[1]}/QOpenSys/pkgs/bin:${pathRegex[2]
                                      .replace("/QOpenSys/pkgs/bin", "") //Removes /QOpenSys/pkgs/bin wherever it is
                                      .replace("::", ":")}:/QOpenSys/usr/bin:/usr/bin`; //Removes double : in case /QOpenSys/pkgs/bin wasn't at the end
                                    replaced = true;
                                  }
                                }
                              });

                              if (!replaced) {
                                bashrcContent.push(
                                  "",
                                  "# Generated by Code for IBM i",
                                  "export PATH=/QOpenSys/pkgs/bin:$PATH:/QOpenSys/usr/bin:/usr/bin"
                                );
                              }

                              await content.writeStreamfile(bashrcFile, bashrcContent.join("\n"));
                            }
                          }
                          catch (error) {
                            vscode.window.showWarningMessage(`Error modifying PATH in ${bashrcFile}):\n${error}.\n\n Code for IBM i may not function correctly. Please contact your system administrator.`, { modal: true });
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

          if (defaultHomeDir) {
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
          if (quickConnect() && cachedServerSettings?.libraryListValidated === true) {
            // Do nothing, library list is already checked.
          } else {
            if (this.config.libraryList) {
              progress.report({
                message: `Validate configured library list`
              });
              let validLibs: string[] = [];
              let badLibs: string[] = [];

              const result = await this.sendQsh({
                command: [
                  `liblist -d ` + IBMi.escapeForShell(this.defaultUserLibraries.join(` `)),
                  ...this.config.libraryList.map(lib => `liblist -a ` + IBMi.escapeForShell(lib))
                ].join(`; `)
              });

              if (result.stderr) {
                const lines = result.stderr.split(`\n`);

                lines.forEach(line => {
                  const badLib = this.config?.libraryList.find(lib => line.includes(`ibrary ${lib} `));

                  // If there is an error about the library, store it
                  if (badLib) badLibs.push(badLib);
                });
              }

              if (result && badLibs.length > 0) {
                validLibs = this.config.libraryList.filter(lib => !badLibs.includes(lib));
                const chosen = await vscode.window.showWarningMessage(`The following ${badLibs.length > 1 ? `libraries` : `library`} does not exist: ${badLibs.join(`,`)}. Remove ${badLibs.length > 1 ? `them` : `it`} from the library list?`, `Yes`, `No`);
                if (chosen === `Yes`) {
                  this.config!.libraryList = validLibs;
                } else {
                  vscode.window.showWarningMessage(`The following libraries does not exist: ${badLibs.join(`,`)}.`);
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

          if (this.sqlRunnerAvailable()) {
            // Check for ASP information?
            if (quickConnect() && cachedServerSettings?.aspInfo) {
              this.aspInfo = cachedServerSettings.aspInfo;
            } else {
              progress.report({
                message: `Checking for ASP information.`
              });

              //This is mostly a nice to have. We grab the ASP info so user's do
              //not have to provide the ASP in the settings.
              try {
                const resultSet = await this.runSQL(`SELECT * FROM QSYS2.ASP_INFO`);
                resultSet.forEach(row => {
                  if (row.DEVICE_DESCRIPTION_NAME && row.DEVICE_DESCRIPTION_NAME && row.DEVICE_DESCRIPTION_NAME !== `null`) {
                    this.aspInfo[Number(row.ASP_NUMBER)] = String(row.DEVICE_DESCRIPTION_NAME);
                  }
                });
              } catch (e) {
                //Oh well
                progress.report({
                  message: `Failed to get ASP information.`
                });
              }
            }

            // Fetch conversion values?
            if (quickConnect() && cachedServerSettings?.jobCcsid !== null && cachedServerSettings?.userDefaultCCSID && cachedServerSettings?.qccsid) {
              this.qccsid = cachedServerSettings.qccsid;
              this.userJobCcsid = cachedServerSettings.jobCcsid;
              this.userDefaultCCSID = cachedServerSettings.userDefaultCCSID;
            } else {
              progress.report({
                message: `Fetching conversion values.`
              });

              // Next, we're going to see if we can get the CCSID from the user or the system.
              // Some things don't work without it!!!
              try {

                // we need to grab the system CCSID (QCCSID)
                const [systemCCSID] = await this.runSQL(`select SYSTEM_VALUE_NAME, CURRENT_NUMERIC_VALUE from QSYS2.SYSTEM_VALUE_INFO where SYSTEM_VALUE_NAME = 'QCCSID'`);
                if (typeof systemCCSID.CURRENT_NUMERIC_VALUE === 'number') {
                  this.qccsid = systemCCSID.CURRENT_NUMERIC_VALUE;
                }

                // we grab the users default CCSID
                const [userInfo] = await this.runSQL(`select CHARACTER_CODE_SET_ID from table( QSYS2.QSYUSRINFO( USERNAME => upper('${this.currentUser}') ) )`);
                if (userInfo.CHARACTER_CODE_SET_ID !== `null` && typeof userInfo.CHARACTER_CODE_SET_ID === 'number') {
                  this.userJobCcsid = userInfo.CHARACTER_CODE_SET_ID;
                }

                // if the job ccsid is *SYSVAL, then assign it to sysval
                if (this.userJobCcsid === CCSID_SYSVAL) {
                  this.userJobCcsid = this.qccsid;
                }

                // Let's also get the user's default CCSID
                try {
                  const [activeJob] = await this.runSQL(`Select DEFAULT_CCSID From Table(QSYS2.ACTIVE_JOB_INFO( JOB_NAME_FILTER => '*', DETAILED_INFO => 'ALL' ))`);
                  this.userDefaultCCSID = Number(activeJob.DEFAULT_CCSID);
                }
                catch (error) {
                  const [defaultCCSID] = (await this.runCommand({ command: "DSPJOB OPTION(*DFNA)" }))
                    .stdout
                    .split("\n")
                    .filter(line => line.includes("DFTCCSID"));

                  const defaultCCSCID = Number(defaultCCSID.split("DFTCCSID").at(1)?.trim());
                  if (defaultCCSCID && !isNaN(defaultCCSCID)) {
                    this.userDefaultCCSID = defaultCCSCID;
                  }
                }

              } catch (e) {
                // Oh well!
                console.log(e);
              }
            }

            let userCcsidNeedsFixing = false;
            let sshdCcsidMismatch = false;

            const showCcsidWarning = (message: string) => {
              vscode.window.showWarningMessage(message, `Show documentation`).then(choice => {
                if (choice === `Show documentation`) {
                  vscode.commands.executeCommand(`vscode.open`, `https://codefori.github.io/docs/tips/ccsid/`);
                }
              });
            }

            if (this.canUseCqsh) {
              // If cqsh is available, but the user profile CCSID is bad, then cqsh won't work
              if (this.getCcsid() === CCSID_NOCONVERSION) {
                userCcsidNeedsFixing = true;
              }
            }

            else {
              // If cqsh is not available, then we need to check the SSHD CCSID
              this.sshdCcsid = await this.getSshCcsid();
              if (this.sshdCcsid === this.getCcsid()) {
                // If the SSHD CCSID matches the job CCSID (not the user profile!), then we're good.
                // This means we can use regular qsh without worrying about translation because the SSHD and job CCSID match.
                userCcsidNeedsFixing = false;
              } else {
                // If the SSHD CCSID does not match the job CCSID, then we need to warn the user
                sshdCcsidMismatch = true;
              }
            }

            if (userCcsidNeedsFixing) {
              showCcsidWarning(`The job CCSID is set to ${CCSID_NOCONVERSION}. This may cause issues with objects with variant characters. Please use CHGUSRPRF USER(${this.currentUser.toUpperCase()}) CCSID(${this.userDefaultCCSID}) to set your profile to the current default CCSID.`);
            } else if (sshdCcsidMismatch) {
              showCcsidWarning(`The CCSID of the SSH connection (${this.sshdCcsid}) does not match the job CCSID (${this.getCcsid()}). This may cause issues with objects with variant characters.`);
            }

            this.appendOutput(`\nCCSID information:\n`);
            this.appendOutput(`\tQCCSID: ${this.qccsid}\n`);
            this.appendOutput(`\tUser Job CCSID: ${this.userJobCcsid}\n`);
            this.appendOutput(`\tUser Default CCSID: ${this.userDefaultCCSID}\n`);
            if (this.sshdCcsid) {
              this.appendOutput(`\tSSHD CCSID: ${this.sshdCcsid}\n`);
            }

            // We only do this check if we're on 7.3 or below.
            if (this.systemVersion && this.systemVersion <= 7.3) {
              progress.report({
                message: `Checking PASE locale environment variables.`
              });

              const systemEnvVars = await this.getSysEnvVars();

              const paseLang = systemEnvVars.PASE_LANG;
              const paseCcsid = systemEnvVars.QIBM_PASE_CCSID;

              if (paseLang === undefined || paseCcsid === undefined) {
                showCcsidWarning(`The PASE environment variables PASE_LANG and QIBM_PASE_CCSID are not set correctly and is required for this OS version (${this.systemVersion}). This may cause issues with objects with variant characters.`);
              } else if (paseCcsid !== `1208`) {
                showCcsidWarning(`The PASE environment variable QIBM_PASE_CCSID is not set to 1208 and is required for this OS version (${this.systemVersion}). This may cause issues with objects with variant characters.`);
              }
            }

            // We always need to fetch the local variants because 
            // now we pickup CCSID changes faster due to cqsh
            progress.report({
              message: `Fetching local encoding values.`
            });

            const [variants] = await this.runSQL(`With VARIANTS ( HASH, AT, DOLLARSIGN ) as (`
              + `  values ( cast( x'7B' as varchar(1) )`
              + `         , cast( x'7C' as varchar(1) )`
              + `         , cast( x'5B' as varchar(1) ) )`
              + `)`
              + `Select HASH concat AT concat DOLLARSIGN as LOCAL from VARIANTS`);

            if (typeof variants.LOCAL === 'string' && variants.LOCAL !== `null`) {
              this.variantChars.local = variants.LOCAL;
            }
          } else {
            vscode.window.showWarningMessage(`The SQL runner is not available. This could mean that VS Code will not work for this connection. See our documentation for more information.`)
          }

          if (!reconnecting) {
            vscode.workspace.getConfiguration().update(`workbench.editor.enablePreview`, false, true);
            await vscode.commands.executeCommand(`setContext`, `code-for-ibmi:connected`, true);
            for (const operation of delayedOperations) {
              await operation();
            }
          }

          instance.fire(`connected`);

          GlobalStorage.get().setServerSettingsCache(this.currentConnectionName, {
            lastCheckedOnVersion: currentExtensionVersion,
            aspInfo: this.aspInfo,
            qccsid: this.qccsid,
            jobCcsid: this.userJobCcsid,
            remoteFeatures: this.remoteFeatures,
            remoteFeaturesKeys: Object.keys(this.remoteFeatures).sort().toString(),
            badDataAreasChecked: true,
            libraryListValidated: true,
            pathChecked: true,
            userDefaultCCSID: this.userDefaultCCSID,
            debugConfigLoaded,
            maximumArgsLength: this.maximumArgsLength
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
    });
  }

  /**
   * Can return 0 if the OS version was not detected.
   */
  getSystemVersion(): number {
    return this.systemVersion;
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

  static escapeForShell(command: string) {
    return command.replace(/\$/g, `\\$`)
  }

  async sendQsh(options: CommandData) {
    options.stdin = options.command;

    let qshExecutable = `/QOpenSys/usr/bin/qsh`;

    if (this.canUseCqsh) {
      qshExecutable = this.getComponent<CustomQSh>(CustomQSh.ID)!.installPath;
    }

    if (this.requiresTranslation) {
      options.stdin = this.sysNameInAmerican(options.stdin);
      options.directory = options.directory ? this.sysNameInAmerican(options.directory) : undefined;
    }

    return this.sendCommand({
      ...options,
      command: qshExecutable
    });
  }

  /**
   * Send commands to pase through the SSH connection.
   * Commands sent here end up in the 'Code for IBM i' output channel.
   */
  async sendCommand(options: CommandData): Promise<CommandResult> {
    let commands: string[] = [];
    if (options.env) {
      if (this.usingBash()) {
        commands.push(...Object.entries(options.env).map(([key, value]) => `export ${key}="${value ? IBMi.escapeForShell(value) : ``}"`));
      } else {
        // bourne shell doesn't support the same export syntax as bash
        commands.push(...Object.entries(options.env).map(([key, value]) => `${key}="${value ? IBMi.escapeForShell(value) : ``}" export ${key}`));
      }
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
    return sqlRunner;
  }

  public sqlRunnerAvailable() {
    return this.remoteFeatures[`QZDFMDB2.PGM`] !== undefined;
  }

  private async getSshCcsid() {
    const sql = `
    with SSH_DETAIL (id, iid) as (
      select substring(job_name, locate('/', job_name, 15)+1, 10) as id, internal_job_id as iid from qsys2.netstat_job_info j where local_address = '0.0.0.0' and local_port = 22
    )
    select DEFAULT_CCSID, CCSID from table(QSYS2.ACTIVE_JOB_INFO( JOB_NAME_FILTER => (select id from SSH_DETAIL), DETAILED_INFO => 'ALL')) where INTERNAL_JOB_ID = (select iid from SSH_DETAIL)
    `;

    const [result] = await this.runSQL(sql);
    return Number(result.CCSID === CCSID_NOCONVERSION ? result.DEFAULT_CCSID : result.CCSID);
  }

  async getSysEnvVars() {
    const systemEnvVars = await this.runSQL([
      `select ENVIRONMENT_VARIABLE_NAME, ENVIRONMENT_VARIABLE_VALUE`,
      `from qsys2.environment_variable_info where environment_variable_type = 'SYSTEM'`
    ].join(` `)) as { ENVIRONMENT_VARIABLE_NAME: string, ENVIRONMENT_VARIABLE_VALUE: string }[];

    let result: { [name: string]: string; } = {};

    systemEnvVars.forEach(row => {
      result[row.ENVIRONMENT_VARIABLE_NAME] = row.ENVIRONMENT_VARIABLE_VALUE;
    });

    return result;
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

  parserMemberPath(string: string, checkExtension?: boolean): MemberParts {
    // Remove leading slash
    const upperCasedString = this.upperCaseName(string);
    const path = upperCasedString.startsWith(`/`) ? upperCasedString.substring(1).split(`/`) : upperCasedString.split(`/`);

    const parsedPath = parsePath(upperCasedString);
    const name = parsedPath.name;
    const file = path[path.length - 2];
    const library = path[path.length - 3];
    const asp = path[path.length - 4];

    if (!library || !file || !name) {
      throw new Error(`Invalid path: ${string}. Use format LIB/SPF/NAME.ext`);
    }
    if (asp && !this.validQsysName(asp)) {
      throw new Error(`Invalid ASP name: ${asp}`);
    }
    if (!this.validQsysName(library)) {
      throw new Error(`Invalid Library name: ${library}`);
    }
    if (!this.validQsysName(file)) {
      throw new Error(`Invalid Source File name: ${file}`);
    }

    //Having a blank extension is allowed but the . in the path is required if checking the extension
    if (checkExtension && !parsedPath.ext) {
      throw new Error(`Source Type extension is required.`);
    }

    if (!this.validQsysName(name)) {
      throw new Error(`Invalid Source Member name: ${name}`);
    }
    // The extension/source type has nearly the same naming rules as
    // the objects, except that a period is not allowed.  We can reuse
    // the existing RegExp because result.extension is everything after
    // the final period (so we know it won't contain a period).
    // But, a blank extension is valid.
    const extension = parsedPath.ext.substring(1);
    if (extension && !this.validQsysName(extension)) {
      throw new Error(`Invalid Source Member Extension: ${extension}`);
    }

    return {
      library,
      file,
      extension,
      basename: parsedPath.base,
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

    return result
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

  getComponent<T extends IBMiComponent>(name: string, ignoreState?: boolean) {
    return this.componentManager.get<T>(name, ignoreState);
  }

  getComponentStates() {
    return this.componentManager.getState();
  }

  /**
   * Run SQL statements.
   * Each statement must be separated by a semi-colon and a new line (i.e. ;\n).
   * If a statement starts with @, it will be run as a CL command.
   *
   * @param statements
   * @returns a Result set
   */
  async runSQL(statements: string, options: { fakeBindings?: (string | number)[], forceSafe?: boolean } = {}): Promise<Tools.DB2Row[]> {
    const { 'QZDFMDB2.PGM': QZDFMDB2 } = this.remoteFeatures;
    const possibleChangeCommand = (this.userCcsidInvalid ? `@CHGJOB CCSID(${this.getCcsid()});\n` : '');

    if (QZDFMDB2) {
      // CHGJOB not required here. It will use the job CCSID, or the runtime CCSID.
      let input = Tools.fixSQL(`${possibleChangeCommand}${statements}`, true);
      let returningAsCsv: WrapResult | undefined;
      let command = `LC_ALL=EN_US.UTF-8 system "call QSYS/QZDFMDB2 PARM('-d' '-i' '-t')"`
      let useCsv = options.forceSafe;

      // Use custom QSH if available
      if (this.canUseCqsh) {
        const customQsh = this.getComponent<CustomQSh>(CustomQSh.ID)!;
        command = `${customQsh.installPath} -c "system \\"call QSYS/QZDFMDB2 PARM('-d' '-i' '-t')\\""`;
      }

      if (this.requiresTranslation) {
        // If we can't fix the input, then we can attempt to convert ourselves and then use the CSV.
        input = this.sysNameInAmerican(input);
        useCsv = true;
      }

      // Fix up the parameters
      let list = input.split(`\n`).join(` `).split(`;`).filter(x => x.trim().length > 0);
      let lastStmt = list.pop()?.trim();
      const asUpper = lastStmt?.toUpperCase();

      // We always need to use the CSV to get the values back correctly from the database.
      if (lastStmt) {
        const fakeBindings = options.fakeBindings;
        if (lastStmt.includes(`?`) && fakeBindings && fakeBindings.length > 0) {
          const parts = lastStmt.split(`?`);

          lastStmt = ``;
          for (let partsIndex = 0; partsIndex < parts.length; partsIndex++) {
            lastStmt += parts[partsIndex];
            if (fakeBindings[partsIndex] !== undefined) {
              switch (typeof fakeBindings[partsIndex]) {
                case `number`:
                  lastStmt += fakeBindings[partsIndex];
                  break;

                case `string`:
                  lastStmt += Tools.bufferToUx(fakeBindings[partsIndex] as string);
                  break;
              }
            }
          }
        }

        // Return as CSV when needed
        if (useCsv && (asUpper?.startsWith(`SELECT`) || asUpper?.startsWith(`WITH`))) {
          const copyToImport = this.getComponent<CopyToImport>(CopyToImport.ID);
          if (copyToImport) {
            returningAsCsv = copyToImport.wrap(this, lastStmt);
            list.push(...returningAsCsv.newStatements);
          }
        }

        if (!returningAsCsv) {
          list.push(lastStmt);
        }

        input = list.join(`;\n`);
      }

      const output = await this.sendCommand({
        command,
        stdin: input
      })

      if (output.stdout) {
        const fromStdout = Tools.db2Parse(output.stdout, input);

        if (returningAsCsv) {
          // Will throw an error if stdout contains an error

          const csvContent = await this.content.downloadStreamfile(returningAsCsv.outStmf);
          if (csvContent) {
            this.sendCommand({ command: `rm -rf "${returningAsCsv.outStmf}"` });

            return parse(csvContent, {
              columns: true,
              skip_empty_lines: true,
              onRecord(record) {
                for (const key of Object.keys(record)) {
                  record[key] = record[key] === ` ` ? `` : Tools.assumeType(record[key]);
                }
                return record;
              }
            }) as Tools.DB2Row[];
          }

          throw new Error(`There was an error fetching the SQL result set.`)
        } else {
          return fromStdout;
        }
      }
    }

    throw new Error(`There is no way to run SQL on this system.`);
  }

  validQsysName(name: string): boolean {
    // First character can only be A-Z, or a variant character
    // The rest can be A-Z, 0-9, _, ., or a variant character
    if (!this.variantChars.qsysNameRegex) {
      const regexTest = `^[A-Z${this.variantChars.local}][A-Z0-9_.${this.variantChars.local}]{0,9}$`;
      this.variantChars.qsysNameRegex = new RegExp(regexTest);
    }

    if (name.length > 10) return false;
    name = this.upperCaseName(name);
    return this.variantChars.qsysNameRegex.test(name);
  }

  getCcsid() {
    const fallbackToDefault = ((this.userJobCcsid < 1 || this.userJobCcsid === CCSID_NOCONVERSION) && this.userDefaultCCSID > 0);
    const ccsid = fallbackToDefault ? this.userDefaultCCSID : this.userJobCcsid;
    return ccsid;
  }

  getCcsids() {
    return {
      qccsid: this.qccsid,
      runtimeCcsid: this.userJobCcsid,
      userDefaultCCSID: this.userDefaultCCSID,
      sshdCcsid: this.sshdCcsid
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