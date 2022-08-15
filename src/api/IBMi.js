
const vscode = require(`vscode`);

const node_ssh = require(`node-ssh`);
const Configuration = require(`./Configuration`);
const Tools = require(`./Tools`);
const path = require(`path`);

let remoteApps = [
  {
    path: `/QOpenSys/pkgs/bin/`,
    names: [`git`, `grep`, `tn5250`]
  },
  {
    path: `/usr/bin/`,
    names: [`setccsid`, `iconv`, `attr`]
  },
  {
    path: `/QSYS.LIB/`,
    // In the future, we may use a generic specific. 
    // Right now we only need one program
    // specific: `*.PGM`,
    specific: `QZDFMDB2.PGM`,
    names: [`QZDFMDB2.PGM`]
  }
];

module.exports = class IBMi {
  constructor() {
    this.client = new node_ssh.NodeSSH;
    this.currentHost = ``;
    this.currentPort = 22;
    this.currentUser = ``;
    
    this.tempRemoteFiles = {};
    this.defaultUserLibraries = [];

    /** @type {vscode.OutputChannel} */
    this.outputChannel = vscode.window.createOutputChannel(`Code for IBM i`);

    /** @type {vscode.Disposable[]} List of vscode disposables */
    this.subscriptions = [this.outputChannel];

    /**
     * Used to store ASP numbers and their names
     * THeir names usually maps up to a directory in
     * the root of the IFS, thus why we store it.
     */
    this.aspInfo = {};

    /** @type {number|null} */
    this.qccsid = null;

    /** @type {{[name: string]: string}} */
    this.remoteFeatures = {
      git: undefined,
      grep: undefined,
      tn5250: undefined,
      setccsid: undefined,
      'GENCMDXML.PGM': undefined,
      'QZDFMDB2.PGM': undefined,
    };

    
    /** @type {{[name: string]: string}} */
    this.variantChars = {
      american: `#@$`,
      local: `#@$`
    };
    
    /** 
     * Strictly for storing errors from sendCommand.
     * Used when creating issues on GitHub.
     * @type {object[]} 
     * */
    this.lastErrors = [];
    
  }

  /**
   * @param {ConnectionData} connectionObject
   * @returns {Promise<{success: boolean, error?: any}>} Was succesful at connecting or not.
   */
  async connect(connectionObject) {
    try {
      connectionObject.keepaliveInterval = 35000;
      // Make sure we're not passing any blank strings, as node_ssh will try to validate it
      if (!connectionObject.privateKey) (connectionObject.privateKey = null);
      
      return await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `Connecting`,
      }, async progress => {
        progress.report({
          message: `Connecting via SSH.`
        });

        await this.client.connect(connectionObject);

        this.currentConnectionName = connectionObject.name;
        this.currentHost = connectionObject.host;
        this.currentPort = connectionObject.port;
        this.currentUser = connectionObject.username;

        let tempLibrarySet = false;
        
        const disconnected = async () => {
          const choice = await vscode.window.showWarningMessage(`Connection list`, {
            modal: true,
            detail: `Connection to ${this.currentConnectionName} has timed out. Would you like to reconnect?`
          }, `Yes`);

          if (choice === `Yes`) {
            this.connect(connectionObject);
          } else {
            vscode.commands.executeCommand(`code-for-ibmi.disconnect`);
          };
        };

        this.client.connection.once(`timeout`, disconnected);
        this.client.connection.once(`end`, disconnected);
        this.client.connection.once(`error`, disconnected);

        progress.report({
          message: `Loading configuration.`
        });

        //Load existing config
        /** @type {Configuration} */
        this.config = await Configuration.load(this.currentConnectionName);

        progress.report({
          message: `Checking home directory.`
        });

        let defaultHomeDir;

        const commandResult = await this.sendCommand({
          command: `pwd`,
          directory: `.`
        });
        if (commandResult.stderr) {
          defaultHomeDir = undefined;
        } else {
          defaultHomeDir = commandResult.stdout.trim();
        }

        //Get home directory if one isn't set
        if (defaultHomeDir) {
          if (this.config.homeDirectory === `.`) {
            // New connections always have `.` as the initial value
            // But set the value to the real path
            this.config.set(`homeDirectory`, defaultHomeDir);

          } else {
            //If they have one set, check it exists.
            const pwdResult = await this.sendCommand({
              command: `pwd`
            });
            if (pwdResult.stderr) {
              //If it doesn't exist, reset it
              this.config.set(`homeDirectory`, defaultHomeDir);
              progress.report({
                message: `Configured home directory reset to ${defaultHomeDir}.`
              });
            }
          }
        }

        //Set a default IFS listing
        if (this.config.ifsShortcuts.length === 0) {
          if (defaultHomeDir) {
            await this.config.set(`ifsShortcuts`, [this.config.homeDirectory]);
          } else {
            await this.config.set(`ifsShortcuts`, [`/`]);
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
            if (this.config.currentLibrary.length === 0) await this.config.set(`currentLibrary`, currentLibrary);
            if (this.config.libraryList.length === 0) await this.config.set(`libraryList`, this.defaultUserLibraries);
          }
        }

        progress.report({
          message: `Checking temporary library configuration.`
        });

        //Next, we need to check the temp lib (where temp outfile data lives) exists
        try {
          await this.remoteCommand(
            `CRTLIB LIB(` + this.config.tempLibrary + `) TEXT('Code for i temporary objects. May be cleared.')`,
            undefined,
          );

          tempLibrarySet = true;

        } catch (e) {
          let [errorcode, errortext] = e.split(`:`);

          switch (errorcode) {
          case `CPF2158`: //Library X exists in ASP device ASP X.
          case `CPF2111`: //Already exists, hopefully ok :)
            tempLibrarySet = true;
            break;
            
          case `CPD0032`: //Can't use CRTLIB
            try {
              await this.remoteCommand(
                `CHKOBJ OBJ(QSYS/${this.config.tempLibrary}) OBJTYPE(*LIB)`,
                undefined
              );

              //We're all good if no errors
              tempLibrarySet = true;
            } catch (e) {
              if (currentLibrary) {
                if (currentLibrary.startsWith(`Q`)) {
                  //Temporary library not created. Some parts of the extension will not run without a temporary library.
                } else {
                  this.config.tempLibrary = currentLibrary;

                  //Using ${currentLibrary} as the temporary library for temporary data.
                  await this.config.set(`tempLibrary`, currentLibrary);

                  tempLibrarySet = true;
                }
              }
            }
            break;
          }

          console.log(e);
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
          if(result.code === 0) {
            // Directory created
            tempDirSet = true;
          } else {
            // Directory not created
          }
        }
        
        if (!tempDirSet) {
          await this.config.set(`tempDir`, `/tmp`);
        }

        if (tempLibrarySet && this.config.autoClearTempData) {
          progress.report({
            message: `Clearing temporary data.`
          });

          this.remoteCommand(
            `DLTOBJ OBJ(${this.config.tempLibrary}/O_*) OBJTYPE(*FILE)`
          )
            .then(result => {
              // All good!
            })
            .catch(e => { 
              // CPF2125: No objects deleted.
              if (!e.startsWith(`CPF2125`)) {
                vscode.window.showErrorMessage(`Temporary data not cleared from ${this.config.tempLibrary}.`, `View log`).then(async choice => {
                  if (choice === `View log`) {
                    this.outputChannel.show();
                  }
                });
              }
            });

          this.sendCommand({
            command: `rm -f ${path.posix.join(this.config.tempDir,`vscodetemp*`)}`
          })
            .then(result => {
              // All good!
            })
            .catch(e => { 
              // CPF2125: No objects deleted.
              vscode.window.showErrorMessage(`Temporary data not cleared from ${this.config.tempDir}.`, `View log`).then(async choice => {
                if (choice === `View log`) {
                  this.outputChannel.show();
                }
              });
            });
        }

        progress.report({
          message: `Checking for bad data areas.`
        });
        
        try {
          await this.remoteCommand(
            `CHKOBJ OBJ(QSYS/QCPTOIMPF) OBJTYPE(*DTAARA)`,
            undefined
          );

          vscode.window.showWarningMessage(`The data area QSYS/QCPTOIMPF exists on this system and may impact Code for IBM i functionality.`, {
            detail: `For V5R3, the code for the command CPYTOIMPF had a major design change to increase functionality and performance. The QSYS/QCPTOIMPF data area lets developers keep the pre-V5R2 version of CPYTOIMPF. Code for IBM i cannot function correctly while this data area exists.`,
            modal: true,
          }, `Delete`, `Read more`).then(choice => {
            switch (choice) {
            case `Delete`:
              this.remoteCommand(
                `DLTOBJ OBJ(QSYS/QCPTOIMPF) OBJTYPE(*DTAARA)`
              )
                .then(() => {
                  vscode.window.showInformationMessage(`The data area QSYS/QCPTOIMPF has been deleted.`);
                })
                .catch(e => {
                  vscode.window.showInformationMessage(`Failed to delete the data area QSYS/QCPTOIMPF. Code for IBM i may not work as intended.`);
                });
              break;
            case `Read more`:
              vscode.env.openExternal(vscode.Uri.parse(`https://github.com/halcyon-tech/vscode-ibmi/issues/476#issuecomment-1018908018`));
              break;
            }
          });
        } catch (e) {
          // It doesn't exist, we're all good.
        }

        try {
          await this.remoteCommand(
            `CHKOBJ OBJ(QSYS/QCPFRMIMPF) OBJTYPE(*DTAARA)`,
            undefined
          );

          vscode.window.showWarningMessage(`The data area QSYS/QCPFRMIMPF exists on this system and may impact Code for IBM i functionality.`, {
            modal: false,
          }, `Delete`, `Read more`).then(choice => {
            switch (choice) {
            case `Delete`:
              this.remoteCommand(
                `DLTOBJ OBJ(QSYS/QCPFRMIMPF) OBJTYPE(*DTAARA)`
              )
                .then(() => {
                  vscode.window.showInformationMessage(`The data area QSYS/QCPFRMIMPF has been deleted.`);
                })
                .catch(e => {
                  vscode.window.showInformationMessage(`Failed to delete the data area QSYS/QCPFRMIMPF. Code for IBM i may not work as intended.`);
                });
              break;
            case `Read more`:
              vscode.env.openExternal(vscode.Uri.parse(`https://github.com/halcyon-tech/vscode-ibmi/issues/476#issuecomment-1018908018`));
              break;
            }
          });
        } catch (e) {
          // It doesn't exist, we're all good.
        }

        progress.report({
          message: `Checking installed components on host IBM i.`
        });

        // We need to check if our remote programs are installed.
        remoteApps.push(
          {
            path: `/QSYS.lib/${this.config.tempLibrary.toUpperCase()}.lib/`,
            names: [`GENCMDXML.PGM`]
          }
        );

        //Next, we see what pase features are available (installed via yum)
        //This may enable certain features in the future.
        for (const feature of remoteApps) {
          try {
            progress.report({
              message: `Checking installed components on host IBM i: ${feature.path}`
            });
        
            const call = await this.paseCommand(`ls -p ${feature.path}${feature.specific || ``}`);
            if (typeof call === `string`) {
              const files = call.split(`\n`);

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

        if (this.remoteFeatures[`QZDFMDB2.PGM`]) {
          let statement;
          let output;

          progress.report({
            message: `Checking for ASP information.`
          });

          //This is mostly a nice to have. We grab the ASP info so user's do
          //not have to provide the ASP in the settings.
          try {
            statement = `SELECT * FROM QSYS2.ASP_INFO`;
            output = await this.paseCommand(`LC_ALL=EN_US.UTF-8 system "call QSYS/QZDFMDB2 PARM('-d' '-i')"`, null, 0, {
              stdin: statement
            });

            if (typeof output === `string`) {
              const rows = Tools.db2Parse(output);
              rows.forEach(row => {
                if (row.DEVICE_DESCRIPTION_NAME && row.DEVICE_DESCRIPTION_NAME !== `null`) {
                  this.aspInfo[row.ASP_NUMBER] = row.DEVICE_DESCRIPTION_NAME;
                }
              });
            }
          } catch (e) {
            //Oh well
            progress.report({
              message: `Failed to get ASP information.`
            });
          }

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
              if (row && row.CHARACTER_CODE_SET_ID !== `null`) {
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
                if (ccsid) {
                  this.qccsid = ccsid.CURRENT_NUMERIC_VALUE;
                }
              }
            }

            if (this.config.enableSQL && this.qccsid === 65535) {
              await this.config.set(`enableSQL`, false);
              vscode.window.showErrorMessage(`QCCSID is set to 65535. Disabling SQL support.`);
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
              if (row && row.LOCAL !== `null`) {
                this.variantChars.local = row.LOCAL;
              }
            } else {
              throw new Error(`There was an error running the SQL statement.`);
            }
          } catch (e) {
            // Oh well!
            console.log(e);
          }
        } else {
          // Disable it if it's not found

          if (this.config.enableSQL) {
            progress.report({
              message: `SQL program not installed. Disabling SQL.`
            });
            await this.config.set(`enableSQL`, false);
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
          vscode.window.showWarningMessage(`Code for IBM i may not function correctly until your user has a home directory. Please set a home directory using CHGUSRPRF USRPRF(${connectionObject.username.toUpperCase()}) HOMEDIR('/home/${connectionObject.username.toLowerCase()}')`);
        }

        return {
          success: true
        };
      });

    } catch (e) {

      if (this.client.isConnected()) {
        this.client.dispose();
      }

      return {
        success: false,
        error: e
      };
    }
  }

  /**
   * 
   * @param {string} command 
   * @param {string} [directory] If not passed, will use current home directory
   */
  remoteCommand(command, directory) {
    //execCommand does not crash..
    // escape $ and "
    command = command.replace(/\$/g, `\\$`).replace(/"/g, `\\"`);

    return this.paseCommand(`system "` + command + `"`, directory);
  }

  /**
   * @param {{
   *   command: string|string[], 
   *   directory?: string,
   *   onStdout?: (data: Buffer) => void, onStderr?: (data: Buffer) => void, stdin?: string
   * }} options
   */
  async sendQsh(options) {
    let qshCommand;

    if (Array.isArray(options.command)) {
      qshCommand = options.command.join(`;`);
    } else {
      qshCommand = options.command;
    }

    options.stdin = qshCommand;

    return this.sendCommand({
      ...options,
      command: `/QOpenSys/usr/bin/qsh`
    });
  }

  /**
   * 
   * @param {string} command 
   * @param {null|string} [directory] If null/not passed, will default to home directory
   * @param {number} [returnType] If not passed, will default to 0. Accepts 0 or 1
   * @param {{onStdout?: (data: Buffer) => void, onStderr?: (data: Buffer) => void, stdin?: string}} [standardIO]
   * @returns {Promise<string|{code: number, stdout: string, stderr: string}>}
   * @deprecated Use sendCommand instead
   */
  async paseCommand(command, directory = this.config.homeDirectory, returnType = 0, standardIO = {}) {
    const result = await this.sendCommand({
      command,
      directory,
      ...standardIO
    })

    if (returnType === 0) {
      if (result.code === 0 || result.code === null) return Promise.resolve(result.stdout);
      else return Promise.reject(result.stderr);
    } else {
      return Promise.resolve(result);
    }
  }

  /**
   * @param {{
   *   command: string, 
   *   directory?: string,
   *   onStdout?: (data: Buffer) => void, onStderr?: (data: Buffer) => void, stdin?: string
   * }} options
   * @returns {Promise<{code: number, stdout: string, stderr: string}>}
   */
  async sendCommand(options) {
    const command = options.command;
    const directory = options.directory || this.config.homeDirectory;

    this.outputChannel.append(`${directory}: ${command}\n`);
    if (options && options.stdin) {
      this.outputChannel.append(`${options.stdin}\n`);
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

    this.outputChannel.append(JSON.stringify(result, null, 4) + `\n\n`);

    return result;
  }

  /**
   * Generates path to a temp file on the IBM i
   * @param {string} key Key to the temp file to be re-used
   */
  getTempRemote(key) {

    if (this.tempRemoteFiles[key] !== undefined) {
      console.log(`Using existing temp: ` + this.tempRemoteFiles[key]);
      return this.tempRemoteFiles[key];
    } else {
      let value = path.posix.join(this.config.tempDir, `vscodetemp-${Tools.makeid()}`);
      console.log(`Using new temp: ` + value);
      this.tempRemoteFiles[key] = value;
      return value;
    }
  }

  log(string) {
    this.outputChannel.appendLine(string);
  }

  /**
   * @param {string} string
   * @returns {{asp?: string, library: string, file: string, member: string, extension: string, basename: string}}
   */
  parserMemberPath(string) {
    const result = {
      asp: undefined,
      library: undefined,
      file: undefined,
      member: undefined,
      extension: undefined,
      basename: undefined,
    };

    const variant_chars_local = this.variantChars.local;
    const validQsysName = new RegExp(`^[A-Z0-9${variant_chars_local}][A-Z0-9_${variant_chars_local}.]{0,9}$`);

    // Remove leading slash
    const path = string.startsWith(`/`) ? string.substring(1).toUpperCase().split(`/`) : string.toUpperCase().split(`/`);

    if (path.length > 0) result.basename = path[path.length - 1];
    if (path.length > 1) result.file = path[path.length - 2];
    if (path.length > 2) result.library = path[path.length - 3];
    if (path.length > 3) result.asp = path[path.length - 4];

    if (!result.library || !result.file || !result.basename) {
      throw new Error(`Invalid path: ${string}. Use format LIB/SPF/NAME.ext`);
    }
    if (result.asp && !validQsysName.test(result.asp)) {
      throw new Error(`Invalid ASP name: ${result.asp}`);
    }
    if (!validQsysName.test(result.library)) {
      throw new Error(`Invalid Library name: ${result.library}`);
    }
    if (!validQsysName.test(result.file)) {
      throw new Error(`Invalid Source File name: ${result.file}`);
    }

    if (!result.basename.includes(`.`)) {
      throw new Error(`Source Type extension is required.`);
    } else {
      result.member = result.basename.substring(0, result.basename.lastIndexOf(`.`));
      result.extension = result.basename.substring(result.basename.lastIndexOf(`.`) + 1).trim();
    }

    if (!validQsysName.test(result.member)) {
      throw new Error(`Invalid Source Member name: ${result.member}`);
    }
    // The extension/source type has nearly the same naming rules as
    // the objects, except that a period is not allowed.  We can reuse
    // the existing RegExp because result.extension is everything after
    // the final period (so we know it won't contain a period).
    // But, a blank extension is valid.
    if (result.extension && !validQsysName.test(result.extension)) {
      throw new Error(`Invalid Source Member Extension: ${result.extension}`);
    }

    return result;
  }

  /**
   * @param {string} string
   * @returns {string} result
   */
  sysNameInLocal(string) {
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
  sysNameInAmerican(string) {
    const fromChars = this.variantChars.local;
    const toChars = this.variantChars.american;

    let result = string;

    for (let i = 0; i < fromChars.length; i++) {
      result = result.replace(new RegExp(`[${fromChars[i]}]`, `g`), toChars[i]);
    };

    return result;
  }
  
}
