
import * as node_ssh from "node-ssh";
import * as vscode from "vscode";
import { ConnectionConfiguration } from "./Configuration";

import path from 'path';
import { instance } from "../instantiate";
import { CommandData, CommandResult, ConnectionData, IBMiMember, RemoteCommand } from "../typings";
import { CompileTools } from "./CompileTools";
import IBMiContent from "./IBMiContent";
import { CachedServerSettings, GlobalStorage } from './Storage';
import { Tools } from './Tools';
import * as configVars from './configVars';

export interface MemberParts extends IBMiMember {
  basename: string
}

let remoteApps = [ // All names MUST also be defined as key in 'remoteFeatures' below!!
  {
    path: `/usr/bin/`,
    names: [`setccsid`, `iconv`, `attr`, `tar`, `ls`]
  },
  {
    path: `/QOpenSys/pkgs/bin/`,
    names: [`git`, `grep`, `tn5250`, `md5sum`, `bash`, `chsh`, `stat`, `sort`, `tar`, `ls`]
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
        const delayedOperations: Function[] = [];

        await this.client.connect(connectionObject as node_ssh.Config);

        this.currentConnectionName = connectionObject.name;
        this.currentHost = connectionObject.host;
        this.currentPort = connectionObject.port;
        this.currentUser = connectionObject.username;

        if (!reconnecting) {
          this.outputChannel = vscode.window.createOutputChannel(`Code for IBM i: ${this.currentConnectionName}`);
        }

        let tempLibrarySet = false;

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
        this.client.connection!.once(`timeout`, disconnected);
        this.client.connection!.once(`end`, disconnected);
        this.client.connection!.once(`error`, disconnected);

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
          command: `CRTLIB LIB(` + this.config.tempLibrary + `) TEXT('Code for i temporary objects. May be cleared.')`,
          noLibList: true
        });
        console.log(createdTempLib?.stderr);

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
                if (!result.stderr.startsWith(`CPF2125`)) {
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
            command: `rm -f ${path.posix.join(this.config.tempDir, `vscodetemp*`)}`
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

        // Check for bad data areas?
        if (quickConnect === true && cachedServerSettings?.badDataAreasChecked === true) {
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

          const QCPFRMIMPF = await await this.runCommand({
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

        // Check for installed components?
        // For Quick Connect to work here, 'remoteFeatures' MUST have all features defined and no new properties may be added!
        if (quickConnect === true && cachedServerSettings?.remoteFeaturesKeys && cachedServerSettings.remoteFeaturesKeys === Object.keys(this.remoteFeatures).sort().toString()) {
          Object.assign(this.remoteFeatures, cachedServerSettings.remoteFeatures);
        } else {
          progress.report({
            message: `Checking installed components on host IBM i.`
          });

          // We need to check if our remote programs are installed.
          remoteApps.push(
            {
              path: `/QSYS.lib/${this.config.tempLibrary.toUpperCase()}.lib/`,
              names: [`GENCMDXML.PGM`, `GETNEWLIBL.PGM`],
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
        }

        if (this.remoteFeatures[`QZDFMDB2.PGM`]) {
          let statement;
          let output;

          // Check for ASP information?
          if (quickConnect === true && cachedServerSettings?.aspInfo) {
            this.aspInfo = cachedServerSettings.aspInfo;
          } else {
            progress.report({
              message: `Checking for ASP information.`
            });

            //This is mostly a nice to have. We grab the ASP info so user's do
            //not have to provide the ASP in the settings.
            try {
              const resultSet = await new IBMiContent(this).runSQL(`SELECT * FROM QSYS2.ASP_INFO`);
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
          if (quickConnect === true && cachedServerSettings?.qccsid !== null && cachedServerSettings?.variantChars) {
            this.qccsid = cachedServerSettings.qccsid;
            this.variantChars = cachedServerSettings.variantChars;
          } else {
            progress.report({
              message: `Fetching conversion values.`
            });

            // Next, we're going to see if we can get the CCSID from the user or the system.
            // Some things don't work without it!!!
            try {
              const CCSID_SYSVAL = -2;
              statement = `select CHARACTER_CODE_SET_ID from table( QSYS2.QSYUSRINFO( USERNAME => upper('${this.currentUser}') ) )`;
              output = await this.sendCommand({
                command: `LC_ALL=EN_US.UTF-8 system "call QSYS/QZDFMDB2 PARM('-d' '-i')"`,
                stdin: statement
              });

              if (output.stdout) {
                const [row] = Tools.db2Parse(output.stdout);
                if (row && row.CHARACTER_CODE_SET_ID !== `null` && typeof row.CHARACTER_CODE_SET_ID === 'number') {
                  this.qccsid = row.CHARACTER_CODE_SET_ID;
                }
              }

              if (this.qccsid === undefined || this.qccsid === CCSID_SYSVAL) {
                statement = `select SYSTEM_VALUE_NAME, CURRENT_NUMERIC_VALUE from QSYS2.SYSTEM_VALUE_INFO where SYSTEM_VALUE_NAME = 'QCCSID'`;
                output = await this.sendCommand({
                  command: `LC_ALL=EN_US.UTF-8 system "call QSYS/QZDFMDB2 PARM('-d' '-i')"`,
                  stdin: statement
                });

                if (output.stdout) {
                  const rows = Tools.db2Parse(output.stdout);
                  const ccsid = rows.find(row => row.SYSTEM_VALUE_NAME === `QCCSID`);
                  if (ccsid && typeof ccsid.CURRENT_NUMERIC_VALUE === 'number') {
                    this.qccsid = ccsid.CURRENT_NUMERIC_VALUE;
                  }
                }
              }

              if (this.config.enableSQL && this.qccsid === 65535) {
                this.config.enableSQL = false;
                vscode.window.showErrorMessage(`QCCSID is set to 65535. Using fallback methods to access the IBM i file systems.`);
              }

              progress.report({
                message: `Fetching local encoding values.`
              });

              statement = `with VARIANTS ( HASH, AT, DOLLARSIGN ) as (`
                + `  values ( cast( x'7B' as varchar(1) )`
                + `         , cast( x'7C' as varchar(1) )`
                + `         , cast( x'5B' as varchar(1) ) )`
                + `)`
                + `select HASH concat AT concat DOLLARSIGN as LOCAL`
                + `  from VARIANTS; `;
              output = await this.sendCommand({
                command: `LC_ALL=EN_US.UTF-8 system "call QSYS/QZDFMDB2 PARM('-d' '-i')"`,
                stdin: statement
              });
              if (output.stdout) {
                const [row] = Tools.db2Parse(output.stdout);
                if (row && row.LOCAL !== `null` && typeof row.LOCAL === 'string') {
                  this.variantChars.local = row.LOCAL;
                }
              } else {
                throw new Error(`There was an error running the SQL statement.`);
              }
            } catch (e) {
              // Oh well!
              console.log(e);
            }
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
          try {
            //check users default shell
            const bashShellPath = '/QOpenSys/pkgs/bin/bash';
            const commandShellResult = await this.sendCommand({
              command: `echo $SHELL`
            });

            if (!commandShellResult.stderr) {
              let usesBash = commandShellResult.stdout.trim() === bashShellPath;
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
                  if (!currentPaths.includes("/QOpenSys/pkgs/bin")) {
                    reason = "Your $PATH shell environment variable does not include /QOpenSys/pkgs/bin";
                  }
                  else if (currentPaths.indexOf("/QOpenSys/pkgs/bin") > currentPaths.indexOf("/usr/bin") || currentPaths.indexOf("/QOpenSys/pkgs/bin") > currentPaths.indexOf("/QOpenSys/usr/bin")) {
                    reason = "/QOpenSys/pkgs/bin is not in the right position in your $PATH shell environment variable";
                  }
                  if (reason && await vscode.window.showWarningMessage(`/QOpenSys/pkgs/bin not found in $PATH`, {
                    modal: true,
                    detail: `${reason}, so Code for IBM i may not function correctly. Would you like to ${bashrcExists ? "update" : "create"} ${bashrcFile} to fix this now?`,
                  }, `Yes`)) {
                    delayedOperations.push(async () => {
                      this.appendOutput(`${bashrcExists ? "update" : "create"} ${bashrcFile}`);
                      if (!bashrcExists) {
                        const createBashrc = await this.sendCommand({ command: `echo "# Generated by Code for IBM i\nexport PATH=/QOpenSys/pkgs/bin:\\$PATH" >> ${bashrcFile} && chown ${connectionObject.username.toLowerCase()} ${bashrcFile} && chmod 755 ${bashrcFile}` });
                        if (createBashrc.code !== 0) {
                          await vscode.window.showWarningMessage(`Error creating ${bashrcFile}):\n${createBashrc.stderr}.\n\n Code for IBM i may not function correctly. Please contact your system administrator.`, { modal: true });
                        }
                      }
                      else {
                        try {
                          const content = instance.getContent();
                          if (content) {
                            const bashrcContent = (await content.downloadStreamfile(bashrcFile)).split("\n");
                            let replaced = false;
                            bashrcContent.forEach((line, index) => {
                              if (!replaced) {
                                const pathRegex = /^((?:export )?PATH=)(.*)(?:)$/.exec(line);
                                if (pathRegex) {
                                  bashrcContent[index] = `${pathRegex[1]}/QOpenSys/pkgs/bin:${pathRegex[2]
                                    .replace("/QOpenSys/pkgs/bin", "") //Removes /QOpenSys/pkgs/bin wherever it is
                                    .replace("::", ":")}`; //Removes double : in case /QOpenSys/pkgs/bin wasn't at the end
                                  replaced = true;
                                }
                              }
                            });

                            if (!replaced) {
                              bashrcContent.push(
                                "",
                                "# Generated by Code for IBM i",
                                "export PATH=/QOpenSys/pkgs/bin:$PATH"
                              );
                            }

                            await content.writeStreamfile(bashrcFile, bashrcContent.join("\n"));
                          }
                        }
                        catch (error) {
                          await vscode.window.showWarningMessage(`Error modifying PATH in ${bashrcFile}):\n${error}.\n\n Code for IBM i may not function correctly. Please contact your system administrator.`, { modal: true });
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
        if (quickConnect === true && cachedServerSettings?.libraryListValidated === true) {
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
                `liblist -d ` + this.defaultUserLibraries.join(` `).replace(/\$/g, `\\$`),
                ...this.config.libraryList.map(lib => `liblist -a ` + lib.replace(/\$/g, `\\$`))
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
      console.log(`Using existing temp: ` + this.tempRemoteFiles[key]);
      return this.tempRemoteFiles[key];
    } else
      if (this.config) {
        let value = path.posix.join(this.config.tempDir, `vscodetemp-${Tools.makeid()}`);
        console.log(`Using new temp: ` + value);
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
