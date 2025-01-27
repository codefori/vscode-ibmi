import { parse } from 'csv-parse/sync';
import { existsSync } from "fs";
import * as node_ssh from "node-ssh";
import os from "os";
import path, { parse as parsePath } from 'path';
import { IBMiComponent } from "./components/component";
import { CopyToImport } from "./components/copyToImport";
import { CustomQSh } from './components/cqsh';
import { ComponentManager } from "./components/manager";
import { CompileTools } from "./CompileTools";
import IBMiContent from "./IBMiContent";
import { CachedServerSettings, CodeForIStorage } from './configuration/storage/CodeForIStorage';
import { Tools } from './Tools';
import * as configVars from './configVars';
import { DebugConfiguration } from "./configuration/DebugConfiguration";
import { ConnectionManager } from './configuration/config/ConnectionManager';
import { AspInfo, CommandData, CommandResult, ConnectionData, IBMiMember, RemoteCommand, WrapResult } from './types';
import { EventEmitter } from 'stream';
import { ConnectionConfig } from './configuration/config/types';

export interface MemberParts extends IBMiMember {
  basename: string
}

export type ConnectionMessageType = 'info' | 'warning' | 'error';
export type ConnectionErrorCode = `shell_config` | `home_directory_creation` | `QCPTOIMPF_exists` | `QCPFRMIMPF_exists` | `default_not_bash` | `invalid_bashrc` | `invalid_temp_lib` | `no_auto_conv_ebcdic` | `not_loaded_debug_config` | `no_sql_runner` | `ccsid_warning`;

export interface ConnectionResult {
  success: boolean,
  errorCodes?: ConnectionErrorCode[],
}

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

type DisconnectCallback = (conn: IBMi) => Promise<void>;
interface ConnectionCallbacks {
  onConnectedOperations?: Function[],
  timeoutCallback?: (conn: IBMi) => Promise<void>,
  uiErrorHandler: (connection: IBMi, error: ConnectionErrorCode, data?: any) => Promise<boolean>,
  progress: (detail: { message: string }) => void,
  message: (type: ConnectionMessageType, message: string) => void,
  cancelEmitter?: EventEmitter,
}

export default class IBMi {
  public static GlobalStorage: CodeForIStorage;
  public static connectionManager: ConnectionManager = new ConnectionManager();
  static readonly CCSID_NOCONVERSION = 65535;
  static readonly CCSID_SYSVAL = -2;
  static readonly bashShellPath = '/QOpenSys/pkgs/bin/bash';

  private systemVersion: number = 0;
  private qccsid: number = IBMi.CCSID_NOCONVERSION;
  private userJobCcsid: number = IBMi.CCSID_SYSVAL;
  /** User default CCSID is job default CCSID */
  private userDefaultCCSID: number = 0;
  private sshdCcsid: number | undefined;

  private componentManager = new ComponentManager(this);

  /**
   * @deprecated Will become private in v3.0.0 - use {@link IBMi.getConfig} instead.
   */
  config?: ConnectionConfig;
  /**
   * @deprecated Will become private in v3.0.0 - use {@link IBMi.getContent} instead.
   */
  content = new IBMiContent(this);

  client: node_ssh.NodeSSH | undefined;
  currentHost: string = ``;
  currentPort: number = 22;
  currentUser: string = ``;
  currentConnectionName: string = ``;
  private tempRemoteFiles: { [name: string]: string } = {};
  defaultUserLibraries: string[] = [];

  /**
   * Used to store ASP numbers and their names
   * Their names usually maps up to a directory in
   * the root of the IFS, thus why we store it.
   */
  private iAspInfo: AspInfo[] = [];
  private currentAsp: string|undefined;

  remoteFeatures: { [name: string]: string | undefined };

  variantChars: {
    american: string,
    local: string,
    qsysNameRegex?: RegExp
  };

  shell?: string;

  //Maximum admited length for command's argument - any command whose arguments are longer than this won't be executed by the shell
  maximumArgsLength = 0;

  public appendOutput: (text: string) => void = (text) => {
    process.stdout.write(text);
  };

  private disconnectedCallback: (DisconnectCallback) | undefined;

  /**
   * Will only be called once per connection.
   */
  setDisconnectedCallback(callback: DisconnectCallback) {
    this.disconnectedCallback = callback;
  }

  get canUseCqsh() {
    return this.getComponent(CustomQSh.ID) !== undefined;
  }

  /**
   * Primarily used for running SQL statements.
   */
  get userCcsidInvalid() {
    return this.userJobCcsid === IBMi.CCSID_NOCONVERSION;
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

  get connected(): boolean {
    return this.client ? this.client.isConnected() : false;
  }

  getContent() {
    return this.content;
  }

  getConfig() {
    if (this.connected && this.config) {
      return this.config!;
    } else {
      throw new Error(`Not connected to IBM i.`);
    }
  }

  setConfig(newConfig: ConnectionConfig) {
    this.config = newConfig;
  }

  constructor() {
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
  async connect(connectionObject: ConnectionData, callbacks: ConnectionCallbacks, reconnecting?: boolean, reloadServerSettings: boolean = false): Promise<ConnectionResult> {
    const currentExtensionVersion = process.env.VSCODEIBMI_VERSION;
    try {
      connectionObject.keepaliveInterval = 35000;

      configVars.replaceAll(connectionObject);

      callbacks.progress({
        message: `Connecting via SSH.`
      });

      const delayedOperations: Function[] = callbacks.onConnectedOperations ? [...callbacks.onConnectedOperations] : [];

      this.client = new node_ssh.NodeSSH;
      await this.client.connect({
        ...connectionObject,
        privateKeyPath: connectionObject.privateKeyPath ? Tools.resolvePath(connectionObject.privateKeyPath) : undefined
      } as node_ssh.Config);

      let wasCancelled = false;

      if (callbacks.cancelEmitter) {
        callbacks.cancelEmitter.once('cancel', () => {
          wasCancelled = true;
          this.dispose();
        });
      }

      this.currentConnectionName = connectionObject.name;
      this.currentHost = connectionObject.host;
      this.currentPort = connectionObject.port;
      this.currentUser = connectionObject.username;

      this.appendOutput(`Code for IBM i, version ${currentExtensionVersion}\n\n`);

      let tempLibrarySet = false;

      callbacks.progress({
        message: `Loading configuration.`
      });

      //Load existing config
      this.config = await IBMi.connectionManager.load(this.currentConnectionName);

      // Load cached server settings.
      const cachedServerSettings: CachedServerSettings = IBMi.GlobalStorage.getServerSettingsCache(this.currentConnectionName);

      // Reload server settings?
      const quickConnect = () => {
        return (this.config!.quickConnect === true && reloadServerSettings === false);
      }

      // Check shell output for additional user text - this will confuse Code...
      callbacks.progress({
        message: `Checking shell output.`
      });

      const checkShellText = `This should be the only text!`;
      const checkShellResult = await this.sendCommand({
        command: `echo "${checkShellText}"`,
        directory: `.`
      });
      if (checkShellResult.stdout.split(`\n`)[0] !== checkShellText) {
        callbacks.uiErrorHandler(this, `shell_config`);
        return {
          success: false
        };
      }

      if (callbacks.timeoutCallback) {
        const timeoutCallbackWrapper = () => {
          // Don't call the callback function if it was based on a user cancellation request.
          if (!wasCancelled) {
            callbacks.timeoutCallback!(this);
          }
        }

        // Register handlers after we might have to abort due to bad configuration.
        this.client.connection!.once(`timeout`, timeoutCallbackWrapper);
        this.client.connection!.once(`end`, timeoutCallbackWrapper);
        this.client.connection!.once(`error`, timeoutCallbackWrapper);
      }

      callbacks.progress({
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
            await callbacks.message(`warning`, `Your home directory (${actualHomeDir}) is not a directory! Code for IBM i may not function correctly. Please contact your system administrator.`);
          }
          else if (0 !== (await this.sendCommand({ command: `test -w ${actualHomeDir}` })).code) {
            await callbacks.message(`warning`, `Your home directory (${actualHomeDir}) is not writable! Code for IBM i may not function correctly. Please contact your system administrator.`);
          }
          else if (0 !== (await this.sendCommand({ command: `test -x ${actualHomeDir}` })).code) {
            await callbacks.message(`warning`, `Your home directory (${actualHomeDir}) is not usable due to permissions! Code for IBM i may not function correctly. Please contact your system administrator.`);
          }
          else {
            // not sure, but get your sys admin involved
            await callbacks.message(`warning`, `Your home directory (${actualHomeDir}) exists but is unusable. Code for IBM i may not function correctly. Please contact your system administrator.`);
          }
        }
        else if (reconnecting) {
          callbacks.message(`warning`, `Your home directory (${actualHomeDir}) does not exist. Code for IBM i may not function correctly.`);
        }
        else {
          const homedirCreated = await callbacks.uiErrorHandler(this, `home_directory_creation`, actualHomeDir);
          if (homedirCreated) {
            defaultHomeDir = actualHomeDir;
          }
        }
      }

      // Check to see if we need to store a new value for the home directory
      if (defaultHomeDir) {
        if (this.config.homeDirectory !== defaultHomeDir) {
          this.config.homeDirectory = defaultHomeDir;
          callbacks.message(`info`, `Configured home directory reset to ${defaultHomeDir}.`);
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
        callbacks.progress({
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
            callbacks.progress({
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
        callbacks.progress({
          message: `Checking installed components on host IBM i: Java`
        });
        const javaCheck = async (root: string) => await this.content.testStreamFile(`${root}/bin/java`, 'x') ? root : undefined;
        this.remoteFeatures.jdk80 = await javaCheck(`/QOpenSys/QIBM/ProdData/JavaVM/jdk80/64bit`);
        this.remoteFeatures.jdk11 = await javaCheck(`/QOpenSys/QIBM/ProdData/JavaVM/jdk11/64bit`);
        this.remoteFeatures.openjdk11 = await javaCheck(`/QOpensys/pkgs/lib/jvm/openjdk-11`);
        this.remoteFeatures.jdk17 = await javaCheck(`/QOpenSys/QIBM/ProdData/JavaVM/jdk17/64bit`);
      }

      if (this.remoteFeatures.uname) {
        callbacks.progress({
          message: `Checking OS version.`
        });
        const systemVersionResult = await this.sendCommand({ command: `${this.remoteFeatures.uname} -rv` });

        if (systemVersionResult.code === 0) {
          const version = systemVersionResult.stdout.trim().split(` `);
          this.systemVersion = Number(`${version[1]}.${version[0]}`);
        }
      }

      if (!this.systemVersion) {
        callbacks.message(`warning`, `Unable to determine system version. Code for IBM i only supports 7.3 and above. Some features may not work correctly.`);
      } else if (this.systemVersion < 7.3) {
        callbacks.message(`warning`, `IBM i ${this.systemVersion} is not supported. Code for IBM i only supports 7.3 and above. Some features may not work correctly.`);
      }

      callbacks.progress({ message: `Checking Code for IBM i components.` });
      await this.componentManager.startup();

      const componentStates = await this.componentManager.getState();
      this.appendOutput(`\nCode for IBM i components:\n`);
      for (const state of componentStates) {
        this.appendOutput(`\t${state.id.name} (${state.id.version}): ${state.state}\n`);
      }
      this.appendOutput(`\n`);

      callbacks.progress({
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

      callbacks.progress({
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

      callbacks.progress({
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
        callbacks.progress({
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
                callbacks.message(`errror`, `Temporary data not cleared from ${this.config.tempLibrary}.`);
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
            callbacks.message(`errror`, `Temporary data not cleared from ${this.config.tempDir}.`);
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
        callbacks.progress({
          message: `Checking for bad data areas.`
        });

        const QCPTOIMPF = await this.runCommand({
          command: `CHKOBJ OBJ(QSYS/QCPTOIMPF) OBJTYPE(*DTAARA)`,
          noLibList: true
        });

        if (QCPTOIMPF?.code === 0) {
          callbacks.uiErrorHandler(this, `QCPTOIMPF_exists`);
        }

        const QCPFRMIMPF = await this.runCommand({
          command: `CHKOBJ OBJ(QSYS/QCPFRMIMPF) OBJTYPE(*DTAARA)`,
          noLibList: true
        });

        if (QCPFRMIMPF?.code === 0) {
          callbacks.uiErrorHandler(this, `QCPFRMIMPF_exists`);
        }
      }

      // give user option to set bash as default shell.
      if (this.remoteFeatures[`bash`]) {
        try {
          //check users default shell

          if (!commandShellResult.stderr) {
            let usesBash = this.shell === IBMi.bashShellPath;
            if (!usesBash) {
              // make sure chsh is installed
              if (this.remoteFeatures[`chsh`]) {
                callbacks.uiErrorHandler(this, `default_not_bash`);
              }
            }

            if (usesBash) {
              //Ensure /QOpenSys/pkgs/bin is found in $PATH
              callbacks.progress({
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

                if (reason) {
                  callbacks.uiErrorHandler(this, `invalid_bashrc`, { missingPath, bashrcFile, bashrcExists, reason });
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
          callbacks.message(`warning`, `EBCDIC streamfiles will not be rendered correctly since \`attr\` or \`iconv\` is not installed on the host. They should both exist in \`\\usr\\bin\`.`);
        }
      }

      if (defaultHomeDir) {
        if (!tempLibrarySet) {
          callbacks.uiErrorHandler(this, `invalid_temp_lib`);
        }
      } else {
        callbacks.message(`warning`, `Code for IBM i may not function correctly until your user has a home directory.`);
      }

      // Validate configured library list.
      if (quickConnect() && cachedServerSettings?.libraryListValidated === true) {
        // Do nothing, library list is already checked.
      } else {
        if (this.config.libraryList) {
          callbacks.progress({
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
            // Automatically cleanup bad libraries
            this.config!.libraryList = validLibs;
          }
        }
      }

      let debugConfigLoaded = false
      if ((!quickConnect || !cachedServerSettings?.debugConfigLoaded)) {
        if (this.debugPTFInstalled()) {
          try {
            const debugServiceConfig = await new DebugConfiguration(this).load();
            delete this.config.debugCertDirectory;
            this.config.debugPort = debugServiceConfig.getOrDefault("DBGSRV_SECURED_PORT", "8005");
            this.config.debugSepPort = debugServiceConfig.getOrDefault("DBGSRV_SEP_DAEMON_PORT", "8008");
            debugConfigLoaded = true;
          }
          catch (error) {
            callbacks.message(`error`, `Could not load debug service configuration: ${error}`);
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
        if (quickConnect() && cachedServerSettings?.iAspInfo) {
          this.iAspInfo = cachedServerSettings.iAspInfo;
        } else {
          callbacks.progress({
            message: `Checking for iASP information.`
          });

          //This is mostly a nice to have. We grab the ASP info so user's do
          //not have to provide the ASP in the settings.
          try {
            const resultSet = await this.runSQL(`SELECT * FROM QSYS2.ASP_INFO`);
            resultSet.forEach(row => {
              // Does not ever include SYSBAS/SYSTEM, only iASPs
              if (row.DEVICE_DESCRIPTION_NAME && row.DEVICE_DESCRIPTION_NAME && row.DEVICE_DESCRIPTION_NAME !== `null`) {
                this.iAspInfo.push({
                  id: Number(row.ASP_NUMBER),
                  name: String(row.DEVICE_DESCRIPTION_NAME),
                  type: String(row.ASP_TYPE),
                  rdbName: String(row.RDB_NAME)
                });
              }
            });
          } catch (e) {
            //Oh well
            callbacks.progress({
              message: `Failed to get ASP information.`
            });
          }
        }

        callbacks.progress({
          message: `Fetching current iASP information.`
        });

        this.currentAsp = await this.getUserProfileAsp();

        // Fetch conversion values?
        if (quickConnect() && cachedServerSettings?.jobCcsid !== null && cachedServerSettings?.userDefaultCCSID && cachedServerSettings?.qccsid) {
          this.qccsid = cachedServerSettings.qccsid;
          this.userJobCcsid = cachedServerSettings.jobCcsid;
          this.userDefaultCCSID = cachedServerSettings.userDefaultCCSID;
        } else {
          callbacks.progress({
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
            if (this.userJobCcsid === IBMi.CCSID_SYSVAL) {
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
          callbacks.uiErrorHandler(this, `ccsid_warning`, message);
        }

        if (this.canUseCqsh) {
          // If cqsh is available, but the user profile CCSID is bad, then cqsh won't work
          if (this.getCcsid() === IBMi.CCSID_NOCONVERSION) {
            userCcsidNeedsFixing = true;
          }
        }

        else {
          // If cqsh is not available, then we need to check the SSHD CCSID
          this.sshdCcsid = await this.content.getSshCcsid();
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
          showCcsidWarning(`The job CCSID is set to ${IBMi.CCSID_NOCONVERSION}. This may cause issues with objects with variant characters. Please use CHGUSRPRF USER(${this.currentUser.toUpperCase()}) CCSID(${this.userDefaultCCSID}) to set your profile to the current default CCSID.`);
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
          callbacks.progress({
            message: `Checking PASE locale environment variables.`
          });

          const systemEnvVars = await this.content.getSysEnvVars();

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
        callbacks.progress({
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
        callbacks.message(`warning`, `The SQL runner is not available. This could mean that VS Code will not work for this connection. See our documentation for more information.`)
      }

      if (!reconnecting) {
        for (const operation of delayedOperations) {
          await operation();
        }
      }

      IBMi.GlobalStorage.setServerSettingsCache(this.currentConnectionName, {
        lastCheckedOnVersion: currentExtensionVersion,
        iAspInfo: this.iAspInfo,
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

    } catch (e: any) {
      this.disconnect(true);

      let error = e.message;
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
        success: false
      };
    }
    finally {
      IBMi.connectionManager.update(this.config!);
    }
  }

  /**
   * Can return 0 if the OS version was not detected.
   */
  getSystemVersion(): number {
    return this.systemVersion;
  }

  usingBash() {
    return this.shell === IBMi.bashShellPath;
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
    return CompileTools.runCommand(this, data);
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


    this.appendOutput(`${directory}: ${command}\n`);
    if (options && options.stdin) {
      this.appendOutput(`${options.stdin}\n`);
    }

    const result = await this.client!.execCommand(command, {
      cwd: directory,
      stdin: options.stdin,
      onStdout: options.onStdout,
      onStderr: options.onStderr,
    });

    // Some simplification
    if (result.code === null) result.code = 0;

    this.appendOutput(JSON.stringify(result, null, 4) + `\n\n`);

    return {
      ...result,
      code: result.code || 0,
    };
  }

  private disconnect(failedToConnect = false) {
    if (this.client) {
      this.client = undefined;

      if (failedToConnect === false && this.disconnectedCallback) {
        this.disconnectedCallback(this);
      }
    }
  }

  async dispose() {
    this.disconnect();
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

  /**
   * Generates path to a temp file on the IBM i
   * @param {string} key Key to the temp file to be re-used
   */
  getTempRemote(key: string) {
    if (this.tempRemoteFiles[key] !== undefined) {
      // console.log(`Using existing temp: ${this.tempRemoteFiles[key]}`);
      return this.tempRemoteFiles[key];
    } else
      if (this.config) {
        let value = path.posix.join(this.config.tempDir, `vscodetemp-${Tools.makeid()}`);
        // console.log(`Using new temp: ${value}`);
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
      await IBMi.connectionManager.update(this.config);
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
    const fallbackToDefault = ((this.userJobCcsid < 1 || this.userJobCcsid === IBMi.CCSID_NOCONVERSION) && this.userDefaultCCSID > 0);
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

  debugPTFInstalled() {
    return this.remoteFeatures[`startDebugService.sh`] !== undefined;
  }

  private async getUserProfileAsp(): Promise<string|undefined> {
    const [currentRdb] = await this.runSQL(`values current_server`);

    if (currentRdb) {
      const key = Object.keys(currentRdb)[0];
      const rdbName = currentRdb[key];
      const currentAsp = this.iAspInfo.find(asp => asp.rdbName === rdbName);

      if (currentAsp) {
        return currentAsp.name;
      }
    }
  }

  getAllIAsps() {
    return this.iAspInfo;
  }

  getIAspDetail(by: string|number) {
    let asp: AspInfo|undefined;
    if (typeof by === 'string') {
      asp = this.iAspInfo.find(asp => asp.name === by);
    } else {
      asp = this.iAspInfo.find(asp => asp.id === by);
    }

    if (asp) {
      return asp;
    }
  }

  getIAspName(by: string|number): string|undefined {
    return this.getIAspDetail(by)?.name;
  }

  getCurrentIAspName() {
    return this.currentAsp;
  }

  private libraryAsps: { [library: string]: number } = {};
  async lookupLibraryIAsp(library: string) {
    let foundNumber: number|undefined = this.libraryAsps[library];

    if (!foundNumber) {
      const [row] = await this.runSQL(`SELECT IASP_NUMBER FROM TABLE(QSYS2.LIBRARY_INFO('${this.sysNameInAmerican(library)}'))`);
      const iaspNumber = Number(row?.IASP_NUMBER);
      if (iaspNumber >= 0) {
        this.libraryAsps[library] = iaspNumber;
        foundNumber = iaspNumber;
      }
    }

    return this.getIAspName(foundNumber);
  }

  getLibraryIAsp(library: string) {
    const found = this.libraryAsps[library];
    if (found >= 0) {
      return this.getIAspName(found);
    }
  }
}