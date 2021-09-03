
const vscode = require(`vscode`);

const node_ssh = require(`node-ssh`);
const Configuration = require(`./Configuration`);

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

    /** @type {{[name: string]: string}} */
    this.remoteFeatures = {
      db2util: undefined,
      git: undefined,
      grep: undefined,
    };
  }

  /**
   * @param {{name: string, host: string, port: number, username: string, password?: string,
   *          privateKey?: string, keepaliveInterval?: number}} connectionObject
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

        let homeDirSet = true;
        let tempLibrarySet = false;
        
        this.client.connection.once(`timeout`, async () => {
          const choice = await vscode.window.showWarningMessage(`Connection to ${this.currentConnectionName} has timed out. Would you like to reconnect?`, `Yes`, `No`);

          if (choice === `Yes`) {
            this.connect(connectionObject);
          } else {
            vscode.commands.executeCommand(`code-for-ibmi.disconnect`);
          };
        });

        progress.report({
          message: `Loading configuration.`
        });

        //Load existing config
        /** @type {Configuration} */
        this.config = await Configuration.load(this.currentConnectionName);

        progress.report({
          message: `Checking home directory.`
        });

        //Get home directory if one isn't set
        let commandResult = await this.paseCommand(`pwd`, null, 1);
        if (typeof commandResult === `object`) {
          if (this.config.homeDirectory === `.`) this.config.set(`homeDirectory`, commandResult.stdout.trim());

          if (commandResult.stderr) {
            homeDirSet = false;
          }
        }

        //Set a default IFS listing
        if (this.config.ifsShortcuts.length === 0) {
          if (homeDirSet) {
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
        let libraryListString = await this.qshCommand(`liblist`);
        if (typeof libraryListString === `string` && libraryListString !== ``) {
          const libraryList = libraryListString.split(`\n`);

          let lib, type;
          for (const line of libraryList) {
            lib = line.substr(0, 10).trim();
            type = line.substr(12);

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
          if (this.config.objectBrowserList.length === 0) await this.config.set(`objectBrowserList`, this.defaultUserLibraries);
          if (this.config.databaseBrowserList.length === 0) await this.config.set(`databaseBrowserList`, this.defaultUserLibraries);
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
          message: `Checking installed components on host IBM i.`
        });

        //Next, we see what pase features are available (installed via yum)
        const packagesPath = `/QOpenSys/pkgs/bin/`;
        try {
          //This may enable certain features in the future.
          const call = await this.paseCommand(`ls -p ${packagesPath}`);
          if (typeof call === `string`) {
            const files = call.split(`\n`);
            for (const feature of Object.keys(this.remoteFeatures))
              if (files.includes(feature))
                this.remoteFeatures[feature] = packagesPath + feature;
          }
          
        } catch (e) {}

        //Even if db2util is installed, but they have disabled it... then disable it
        if (this.config.enableSQL !== true) {
          this.remoteFeatures.db2util = undefined;
        }

        if (this.remoteFeatures.db2util) {
          progress.report({
            message: `db2util is enabled, so checking for ASP information.`
          });

          //This is mostly a nice to have. We grab the ASP info so user's do
          //not have to provide the ASP in the settings. This only works if
          //they have db2util installed, becuase we have to use SQL to get the
          //data. I couldn't find an outfile for this information. :(
          try {
            const command = this.remoteFeatures.db2util;

            const statement = `SELECT * FROM QSYS2.ASP_INFO`;
            let output = await this.paseCommand(`DB2UTIL_JSON_CONTAINER=array ${command} -o json "${statement}"`);
      
            if (typeof output === `string`) {
              const rows = JSON.parse(output);
              for (const row of rows) {
                if (row.DEVICE_DESCRIPTION_NAME && row.DEVICE_DESCRIPTION_NAME !== `null`) {
                  this.aspInfo[row.ASP_NUMBER] = row.DEVICE_DESCRIPTION_NAME;
                }
              }
            }
          } catch (e) {
            //Oh well
          }
        }

        if (homeDirSet) {
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
          vscode.window.showWarningMessage(`Code for IBM i may not function correctly until your user has a home directory. Please set a home directory using CHGUSRPRF USRPRF(${connectionObject.username.toUpperCase()}) HOMEDIR('/home/${connectionObject.username.toLowerCase()}').`);
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
    return this.paseCommand(`system "` + command + `"`, directory);
  }

  /**
   * 
   * @param {string|string[]} command 
   * @param {string} [directory] 
   * @param {number} [returnType] 
   */
  qshCommand(command, directory = this.config.homeDirectory, returnType = 0) {

    if (Array.isArray(command)) {
      command = command.join(`;`);
    }

    command = command.replace(/"/g, `\\"`);

    command = `echo "` + command + `" | /QOpenSys/usr/bin/qsh`;

    return this.paseCommand(command, directory, returnType);
  }

  /**
   * 
   * @param {string} command 
   * @param {null|string} [directory] If null/not passed, will default to home directory
   * @param {number} [returnType] If not passed, will default to 0. Accepts 0 or 1
   * @returns {Promise<string|{code: number, stdout: string, stderr: string}>}
   */
  async paseCommand(command, directory = this.config.homeDirectory, returnType = 0) {
    command = command.replace(/\$/g, `\\$`);

    this.outputChannel.append(`${directory}: ${command}\n`);

    const result = await this.client.execCommand(command, {
      cwd: directory,
    });

    this.outputChannel.append(JSON.stringify(result, null, 4) + `\n`);
    this.outputChannel.append(`\n`);

    if (returnType === 0) {
      if (result.code === 0 || result.code === null) return Promise.resolve(result.stdout);
      else return Promise.reject(result.stderr);
    } else {
      return Promise.resolve(result);
    }
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
      let value = `/tmp/vscodetemp-` + IBMi.makeid();
      console.log(`Using new temp: ` + value);
      this.tempRemoteFiles[key] = value;
      return value;
    }
  }

  static makeid() {
    let text = `o`;
    let possible =
      `ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789`;
  
    for (let i = 0; i < 9; i++)
      text += possible.charAt(Math.floor(Math.random() * possible.length));
  
    return text;
  }

  /**
   * Build the IFS path string to a member
   * @param {string|undefined} asp 
   * @param {string} lib 
   * @param {string} obj 
   * @param {string} mbr 
   */
  static qualifyPath(asp, lib, obj, mbr) {
    const path =
      (asp && asp.length > 0 ? `/${asp}` : ``) + `/QSYS.lib/${lib}.lib/${obj}.file/${mbr}.mbr`;
    return path;
  }
}
