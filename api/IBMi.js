const node_ssh = require('node-ssh');
const parse = require('csv-parse/lib/sync');

const IBMiContent = require('./IBMiContent');

module.exports = class IBMi {
  constructor() {
    this.client = new node_ssh.NodeSSH;
    this.currentUser = '';
    this.tempRemoteFiles = {};
    this.defaultUserLibraries = [];
    
    //Configration:
    this.homeDirectory = '.';
    this.libraryList = [];
    this.tempLibrary = 'ILEDITOR';
  }

  /**
   * @param {{host: string, username: string, password: string, keepaliveInterval: number}} connectionObject 
   * @returns {Promise<boolean>} Was succesful at connecting or not.
   */
  async connect(connectionObject) {
    try {
      connectionObject.keepaliveInterval = 35000;

      await this.client.connect(connectionObject);

      this.currentUser = connectionObject.username;

      //Perhaps load in existing config if it exists here.

      //Continue with finding out info about system
      if (this.homeDirectory === '.') this.homeDirectory = `/home/${connectionObject.username}`;

      //Create home directory if it does not exist.
      try {
        await this.paseCommand(`mkdir ${this.homeDirectory}`);
      } catch (e) {
        //If the folder doesn't exist, then we need to reset the path
        //because we need a valid path for the home directory.
        if (e.indexOf('File exists') === -1) {
          //An error message here also?
          this.homeDirectory = `.`;
        }
      }

      //Since the compiles are stateless, then we have to set the library list each time we use the `SYSTEM` command
      //We setup the defaultUserLibraries here so we can remove them later on so the user can setup their own library list
      let currentLibrary = `QGPL`;
      this.defaultUserLibraries = [];
      var libraryListString = await this.qshCommand('liblist');
      if (typeof libraryListString === 'string' && libraryListString !== '') {
        const libraryList = libraryListString.split('\n');

        var lib, type;
        for (const line of libraryList) {
          lib = line.substr(0, 10).trim();
          type = line.substr(12);

          switch (type) {
            case 'USR':
              this.defaultUserLibraries.push(lib);
              break;
              
            case 'CUR':
              currentLibrary = lib;
              break;
          }
        }

        if (this.libraryList.length === 0) this.libraryList = this.defaultUserLibraries;
      }

      //Next, we need to check the temp lib (where temp outfile data lives) exists
      try {
        await this.remoteCommand(
          'CRTLIB ' + this.tempLibrary,
          undefined,
        );
      } catch (e) {
        var [errorcode, errortext] = e.split(':');

        switch (errorcode) {
          case 'CPF2111': //Already exists, hopefully ok :)
            break;
          
          case 'CPD0032': //Can't use CRTLIB
            try {
              await this.remoteCommand(
                `CHKOBJ OBJ(QSYS/${this.tempLibrary}) OBJTYPE(*LIB)`,
                undefined
              );

              //We're all good if no errors
            } catch (e) {
              if (currentLibrary.startsWith('Q')) {
                //Temporary library not created. Some parts of the extension will not run without a temporary library.
              } else {
                this.tempLibrary = currentLibrary;
                //Using ${currentLibrary} as the temporary library for temporary data.
              }
            }
            break;
        }

        console.log(e);
      }

      return true;

    } catch (e) {
      return false;
    }
  }

  /**
   * 
   * @param {string} command 
   * @param {string} [directory] If not passed, will use current home directory
   */
  remoteCommand(command, directory) {
    //execCommand does not crash..
    return this.paseCommand('system "' + command + '"', directory);
  }

  /**
   * 
   * @param {string} command 
   * @param {string} [directory] 
   * @param {number} [returnType] 
   */
  qshCommand(command, directory = this.homeDirectory, returnType = 0) {

    if (Array.isArray(command)) {
      command = command.join(';');
    }

    command = command.replace(/"/g, '\\"');

    command = 'echo "' + command + '" | /QOpenSys/usr/bin/qsh';

    return this.paseCommand(command, directory, returnType);
  }

  /**
   * 
   * @param {string} command 
   * @param {null|string} [directory] If null/not passed, will default to home directory
   * @param {number} [returnType] If not passed, will default to 0. Accepts 0 or 1
   */
  async paseCommand(command, directory = this.homeDirectory, returnType = 0) {
    command = command.replace(/\$/g, '\\$');

    var result = await this.client.execCommand(command, {
      cwd: directory,
    });

    if (returnType === 0) {
      if (result.code === 0 || result.code === null) return Promise.resolve(result.stdout);
      else return Promise.reject(result.stderr);
    } else {
      return Promise.resolve(result);
    }
  }

  /**
   * Download the contents of a table.
   * @param {string} lib 
   * @param {string} file 
   * @param {string} [mbr] Will default to file provided 
   */
  async getTable(lib, file, mbr) {
    if (!mbr) mbr = file; //Incase mbr is the same file

    const content = new IBMiContent(this);
    const tempRmt = this.getTempRemote(IBMi.qualifyPath(undefined, lib, file, mbr));

    await this.remoteCommand(
      'QSYS/CPYTOIMPF FROMFILE(' +
        lib +
        '/' +
        file +
        ' ' +
        mbr +
        ') ' +
        "TOSTMF('" +
        tempRmt +
        "') MBROPT(*REPLACE) STMFCCSID(1208) RCDDLM(*CRLF) DTAFMT(*DLM) RMVBLANK(*TRAILING) ADDCOLNAM(*SQL)",
    );

    var result = await content.downloadStreamfile(tempRmt);

    return parse(result, {
      columns: true,
      skip_empty_lines: true,
    });
    
  }

  /**
   * Generates path to a temp file on the IBM i
   * @param {string} key Key to the temp file to be re-used
   */
  getTempRemote(key) {

    if (this.tempRemoteFiles[key] !== undefined) {
      console.log('Using existing temp: ' + this.tempRemoteFiles[key]);
      return this.tempRemoteFiles[key];
    } else {
      var value = '/tmp/' + makeid();
      console.log('Using new temp: ' + value);
      this.tempRemoteFiles[key] = value;
      return value;
    }
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
      (asp ? `/${asp}` : '') + `/QSYS.lib/${lib}.lib/${obj}.file/${mbr}.mbr`;
    return path;
  }
}

function makeid() {
  var text = 'o';
  var possible =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

  for (var i = 0; i < 9; i++)
    text += possible.charAt(Math.floor(Math.random() * possible.length));

  return text;
}