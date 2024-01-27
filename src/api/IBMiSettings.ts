import * as vscode from "vscode";
import path from 'path';

import IBMi from "./IBMi";
import IBMiContent from "./IBMiContent";
import { ConnectionData } from "../typings";
import { Tools } from './Tools';
import { instance } from "../instantiate";

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

export default class IBMiSettings {

    private connection : IBMi;
    private progress: vscode.Progress<{ message?: string; increment?: number }>;
    private reconnecting?: boolean;
    private connectionObject: ConnectionData;
    private tempLibrarySet: boolean;
    private tempDirSet: boolean;
    private delayedOperations: Function[];
  
    constructor(connection: IBMi, progress: vscode.Progress<{ message?: string; increment?: number }>, connectionObject: ConnectionData,delayedOperations: Function[],reconnecting?: boolean) {
      this.connection = connection;
      this.progress = progress;
      this.reconnecting = reconnecting;
      this.connectionObject = connectionObject;
      this.tempLibrarySet = false;
      this.tempDirSet = false;
      this.delayedOperations = delayedOperations;
    }
  
    async CheckShellOutput( ) {
      // Check shell output for additional user text - this will confuse Code...
      this.progress.report({
        message: `Checking shell output.`
      });
  
      const checkShellText = `This should be the only text!`;
      const checkShellResult = await this.connection.sendCommand({
        command: `echo "${checkShellText}"`,
        directory: `.`
      });
      if (checkShellResult.stdout.split(`\n`)[0] !== checkShellText) {
        const chosen = await vscode.window.showErrorMessage(`Error in shell configuration!`, {
          detail: [
            `This extension can not work with the shell configured on ${this.connection.currentConnectionName},`,
            `since the output from shell commands have additional content.`,
            `This can be caused by running commands like "echo" or other`,
            `commands creating output in your shell start script.`, ``,
            `The connection to ${this.connection.currentConnectionName} will be aborted.`
          ].join(`\n`),
          modal: true
        }, `Read more`);
  
        if (chosen === `Read more`) {
          vscode.commands.executeCommand(`vscode.open`, `https://codefori.github.io/docs/#/pages/tips/setup`);
        }
  
        throw (`Shell config error, connection aborted.`);
      }
    }
  
    async checkHomeDirectory() {
      
      this.progress.report({
        message: `Checking home directory.`
      });
  
      let defaultHomeDir;
  
      const echoHomeResult = await this.connection.sendCommand({
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
        let doesHomeExist = (0 === (await this.connection.sendCommand({ command: `test -e ${actualHomeDir}` })).code);
        if (doesHomeExist) {
          // Note: this logic might look backward because we fall into this (failure) leg on what looks like success (home dir exists).
          //       But, remember, but we only got here if 'cd $HOME' failed.
          //       Let's try to figure out why....
          if (0 !== (await this.connection.sendCommand({ command: `test -d ${actualHomeDir}` })).code) {
            await vscode.window.showWarningMessage(`Your home directory (${actualHomeDir}) is not a directory! Code for IBM i may not function correctly. Please contact your system administrator.`, { modal: !this.reconnecting });
          }
          else if (0 !== (await this.connection.sendCommand({ command: `test -w ${actualHomeDir}` })).code) {
            await vscode.window.showWarningMessage(`Your home directory (${actualHomeDir}) is not writable! Code for IBM i may not function correctly. Please contact your system administrator.`, { modal: !this.reconnecting });
          }
          else if (0 !== (await this.connection.sendCommand({ command: `test -x ${actualHomeDir}` })).code) {
            await vscode.window.showWarningMessage(`Your home directory (${actualHomeDir}) is not usable due to permissions! Code for IBM i may not function correctly. Please contact your system administrator.`, { modal: !this.reconnecting });
          }
          else {
            // not sure, but get your sys admin involved
            await vscode.window.showWarningMessage(`Your home directory (${actualHomeDir}) exists but is unusable. Code for IBM i may not function correctly. Please contact your system administrator.`, { modal: !this.reconnecting });
          }
        }
        else if (this.reconnecting) {
          vscode.window.showWarningMessage(`Your home directory (${actualHomeDir}) does not exist. Code for IBM i may not function correctly.`, { modal: false });
        }
        else if (await vscode.window.showWarningMessage(`Home directory does not exist`, {
          modal: true,
          detail: `Your home directory (${actualHomeDir}) does not exist, so Code for IBM i may not function correctly. Would you like to create this directory now?`,
        }, `Yes`)) {
          this.appendOutput(`creating home directory ${actualHomeDir}`);
          let mkHomeCmd = `mkdir -p ${actualHomeDir} && chown ${this.connectionObject.username.toLowerCase()} ${actualHomeDir} && chmod 0755 ${actualHomeDir}`;
          let mkHomeResult = await this.connection.sendCommand({ command: mkHomeCmd, directory: `.` });
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
  
      if (this.connection.config){
  
      // Check to see if we need to store a new value for the home directory
      if (defaultHomeDir) {
  
        if (this.connection.config?.homeDirectory !== defaultHomeDir) {
          this.connection.config.homeDirectory = defaultHomeDir;
          vscode.window.showInformationMessage(`Configured home directory reset to ${defaultHomeDir}.`);
        }
      } else {
        // New connections always have `.` as the initial value. 
        // If we can't find a usable home directory, just reset it to
        // the initial default.
        this.connection.config.homeDirectory = `.`;
      }
  
  
      //Set a default IFS listing
      if (this.connection.config?.ifsShortcuts.length === 0) {
        if (defaultHomeDir) {
          this.connection.config.ifsShortcuts = [this.connection.config.homeDirectory];
        } else {
          this.connection.config.ifsShortcuts = [`/`];
        }
      }
    }
  
    }
  
    async checkLibraryList() {
  
      this.progress.report({
        message: `Checking library list configuration.`
      });
  
      //Since the compiles are stateless, then we have to set the library list each time we use the `SYSTEM` command
      //We setup the defaultUserLibraries here so we can remove them later on so the user can setup their own library list
      let currentLibrary = `QGPL`;
      this.connection.defaultUserLibraries = [];
  
      const liblResult = await this.connection.sendQsh({
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
                this.connection.defaultUserLibraries.push(lib);
                break;
  
              case `CUR`:
                currentLibrary = lib;
                break;
            }
          }
  
          //If this is the first time the config is made, then these arrays will be empty
          if(this.connection.config) {
            if (this.connection.config.currentLibrary.length === 0) {
              this.connection.config.currentLibrary = currentLibrary;
            }
            if (this.connection.config.libraryList.length === 0) {
              this.connection.config.libraryList = this.connection.defaultUserLibraries;
            }
          }
        
        }
      }
    }
  
    async checkTempLibConfig() {
      
      this.tempLibrarySet = false;
  
      if(this.connection.config){
    
      this.progress.report({
      message: `Checking temporary library configuration.`
    });
  
    //Next, we need to check the temp lib (where temp outfile data lives) exists
    const createdTempLib = await this.connection.runCommand({
      command: `CRTLIB LIB(${this.connection.config.tempLibrary}) TEXT('Code for i temporary objects. May be cleared.')`,
      noLibList: true
    });
  
    if (createdTempLib.code === 0) {
      this.tempLibrarySet = true;
    } else {
      const messages = Tools.parseMessages(createdTempLib.stderr);
      if (messages.findId(`CPF2158`) || messages.findId(`CPF2111`)) { //Already exists, hopefully ok :)            
        this.tempLibrarySet = true;
      }
      else if (messages.findId(`CPD0032`)) { //Can't use CRTLIB
        const tempLibExists = await this.connection.runCommand({
          command: `CHKOBJ OBJ(QSYS/${this.connection.config.tempLibrary}) OBJTYPE(*LIB)`,
          noLibList: true
        });
  
        if (tempLibExists.code === 0) {
          //We're all good if no errors
          this.tempLibrarySet = true;
        } else if (this.connection.config.currentLibrary && !this.connection.config.currentLibrary.startsWith(`Q`)) {
          //Using ${currentLibrary} as the temporary library for temporary data.
          this.connection.config.tempLibrary = this.connection.config.currentLibrary;
          this.tempLibrarySet = true;
        }
      }
    }
  
  }
  
  }
  
  async checkTempDirectoryConfig() {
    this.progress.report({
      message: `Checking temporary directory configuration.`
    });
  
    this.tempDirSet = false;
    // Next, we need to check if the temp directory exists
    let result = await this.connection.sendCommand({
      command: `[ -d "${this.connection.config?.tempDir}" ]`
    });
  
    if (result.code === 0) {
      // Directory exists
      this.tempDirSet = true;
    } else {
      // Directory does not exist, try to create it
      let result = await this.connection.sendCommand({
        command: `mkdir -p ${this.connection.config?.tempDir}`
      });
      if (result.code === 0) {
        // Directory created
        this.tempDirSet = true;
      } else {
        // Directory not created
      }
    }
  
    if (!this.tempDirSet && this.connection.config) {
      this.connection.config.tempDir = `/tmp`;
    }
  }
  
  async clearTempData() {
    if (this.tempLibrarySet && this.connection.config?.autoClearTempData) {
      this.progress.report({
        message: `Clearing temporary data.`
      });
  
      this.connection.runCommand({
        command: `DLTOBJ OBJ(${this.connection.config.tempLibrary}/O_*) OBJTYPE(*FILE)`,
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
                  this.connection.outputChannel!.show();
                }
              });
            }
          }
        })
  
      this.connection.sendCommand({
        command: `rm -f ${path.posix.join(this.connection.config.tempDir, `vscodetemp*`)}`
      })
        .then(result => {
          // All good!
        })
        .catch(e => {
          // CPF2125: No objects deleted.
          // @ts-ignore We know the config exists.
          vscode.window.showErrorMessage(`Temporary data not cleared from ${this.config.tempDir}.`, `View log`).then(async choice => {
            if (choice === `View log`) {
              this.connection.outputChannel!.show();
            }
          });
        });
    }
  }
  
  async checkBadDataAreas() {
    this.progress.report({
      message: `Checking for bad data areas.`
    });
  
    const QCPTOIMPF = await this.connection.runCommand({
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
            this.connection.runCommand({
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
  
    const QCPFRMIMPF = await this.connection.runCommand({
      command: `CHKOBJ OBJ(QSYS/QCPFRMIMPF) OBJTYPE(*DTAARA)`,
      noLibList: true
    });
  
    if (QCPFRMIMPF?.code === 0) {
      vscode.window.showWarningMessage(`The data area QSYS/QCPFRMIMPF exists on this system and may impact Code for IBM i functionality.`, {
        modal: false,
      }, `Delete`, `Read more`).then(choice => {
        switch (choice) {
          case `Delete`:
            this.connection.runCommand({
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
  
  async checkInstalledComponents() {
    this.progress.report({
      message: `Checking installed components on host IBM i.`
    });
  
    // We need to check if our remote programs are installed.
    if(this.connection.config?.tempLibrary) {
      remoteApps.push(
        {
          path: `/QSYS.lib/${this.connection.config.tempLibrary.toUpperCase()}.lib/`,
          names: [`GENCMDXML.PGM`, `GETNEWLIBL.PGM`],
          specific: `GE*.PGM`
        }
      );
    }
  
    //Next, we see what pase features are available (installed via yum)
    //This may enable certain features in the future.
    for (const feature of remoteApps) {
      try {
        this.progress.report({
          message: `Checking installed components on host IBM i: ${feature.path}`
        });
  
        const call = await this.connection.sendCommand({ command: `ls -p ${feature.path}${feature.specific || ``}` });
        if (call.stdout) {
          const files = call.stdout.split(`\n`);
  
          if (feature.specific) {
            for (const name of feature.names)
              this.connection.remoteFeatures[name] = files.find(file => file.includes(name));
          } else {
            for (const name of feature.names)
              if (files.includes(name))
                this.connection.remoteFeatures[name] = feature.path + name;
          }
        }
      } catch (e) {
        console.log(e);
      }
    }
  }
  
  async checkASPInfo() {
    this.progress.report({
      message: `Checking for ASP information.`
    });
  
    //This is mostly a nice to have. We grab the ASP info so user's do
    //not have to provide the ASP in the settings.
    try {
      const resultSet = await new IBMiContent(this.connection).runSQL(`SELECT * FROM QSYS2.ASP_INFO`);
      resultSet.forEach(row => {
        if (row.DEVICE_DESCRIPTION_NAME && row.DEVICE_DESCRIPTION_NAME && row.DEVICE_DESCRIPTION_NAME !== `null`) {
          this.connection.aspInfo[Number(row.ASP_NUMBER)] = String(row.DEVICE_DESCRIPTION_NAME);
        }
      });
    } catch (e) {
      //Oh well
      this.progress.report({
        message: `Failed to get ASP information.`
      });
    }
  }
  
  async checkCCSID() {
    
    this.progress.report({
      message: `Fetching conversion values.`
    });
  
    // Next, we're going to see if we can get the CCSID from the user or the system.
    // Some things don't work without it!!!
    try {
      const CCSID_SYSVAL = -2;
      let statement = `select CHARACTER_CODE_SET_ID from table( QSYS2.QSYUSRINFO( USERNAME => upper('${this.connection.currentUser}') ) )`;
      let output = await this.connection.sendCommand({
        command: `LC_ALL=EN_US.UTF-8 system "call QSYS/QZDFMDB2 PARM('-d' '-i')"`,
        stdin: statement
      });
  
      if (output.stdout) {
        const [row] = Tools.db2Parse(output.stdout);
        if (row && row.CHARACTER_CODE_SET_ID !== `null` && typeof row.CHARACTER_CODE_SET_ID === 'number') {
          this.connection.qccsid = row.CHARACTER_CODE_SET_ID;
        }
      }
  
      if (this.connection.qccsid === undefined || this.connection.qccsid === CCSID_SYSVAL) {
        statement = `select SYSTEM_VALUE_NAME, CURRENT_NUMERIC_VALUE from QSYS2.SYSTEM_VALUE_INFO where SYSTEM_VALUE_NAME = 'QCCSID'`;
        output = await this.connection.sendCommand({
          command: `LC_ALL=EN_US.UTF-8 system "call QSYS/QZDFMDB2 PARM('-d' '-i')"`,
          stdin: statement
        });
  
        if (output.stdout) {
          const rows = Tools.db2Parse(output.stdout);
          const ccsid = rows.find(row => row.SYSTEM_VALUE_NAME === `QCCSID`);
          if (ccsid && typeof ccsid.CURRENT_NUMERIC_VALUE === 'number') {
            this.connection.qccsid = ccsid.CURRENT_NUMERIC_VALUE;
          }
        }
      }
  
      if (this.connection.config?.enableSQL && this.connection.qccsid === 65535) {
        this.connection.config.enableSQL = false;
        vscode.window.showErrorMessage(`QCCSID is set to 65535. Using fallback methods to access the IBM i file systems.`);
      }
    }
    catch (e) {
      // Oh well!
      console.log(e);
    }
  }
  
    async checkLocalEncoding() {
  
      this.progress.report({
        message: `Fetching local encoding values.`
      });
  
      try {
  
      const statement = `with VARIANTS ( HASH, AT, DOLLARSIGN ) as (`
        + `  values ( cast( x'7B' as varchar(1) )`
        + `         , cast( x'7C' as varchar(1) )`
        + `         , cast( x'5B' as varchar(1) ) )`
        + `)`
        + `select HASH concat AT concat DOLLARSIGN as LOCAL`
        + `  from VARIANTS; `;
      
      const output = await this.connection.sendCommand({
        command: `LC_ALL=EN_US.UTF-8 system "call QSYS/QZDFMDB2 PARM('-d' '-i')"`,
        stdin: statement
      });
      if (output.stdout) {
        const [row] = Tools.db2Parse(output.stdout);
        if (row && row.LOCAL !== `null` && typeof row.LOCAL === 'string') {
          this.connection.variantChars.local = row.LOCAL;
        }
      } else {
        throw new Error(`There was an error running the SQL statement.`);
      }
    }
    catch (e) {
      // Oh well!
      console.log(e);
    }
  }
  
  async checkBash() {
  
    try {
      if(this.connection.config){
        this.connection.config.usesBash = false;
        //check users default shell
      const bashShellPath = '/QOpenSys/pkgs/bin/bash';
      const commandShellResult = await this.connection.sendCommand({
        command: `echo $SHELL`
      });
  
      if (!commandShellResult.stderr) {
        this.connection.config.usesBash = commandShellResult.stdout.trim() === bashShellPath;
        if (!this.connection.config?.usesBash) {
          // make sure chsh is installed
          if (this.connection.remoteFeatures[`chsh`]) {
            vscode.window.showInformationMessage(`IBM recommends using bash as your default shell.`, `Set shell to bash`, `Read More`,).then(async choice => {
              switch (choice) {
                case `Set shell to bash`:
                  const commandSetBashResult = await this.connection.sendCommand({
                    command: `/QOpenSys/pkgs/bin/chsh -s /QOpenSys/pkgs/bin/bash`
                  });
  
                  if (!commandSetBashResult.stderr) {
                    vscode.window.showInformationMessage(`Shell is now bash! Reconnect for change to take effect.`);
                    if(this.connection.config) this.connection.config.usesBash = true;
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
      }
    }
    } catch (e) {
      // Oh well...trying to set default shell is not worth stopping for.
      console.log(e);
    }
  }
  
  async checkOpenSrcPath() {
    
    this.progress.report({
      message: `Checking /QOpenSys/pkgs/bin in $PATH.`
    });
  
    const currentPaths = (await this.connection.sendCommand({ command: "echo $PATH" })).stdout.split(":");
    const bashrcFile = `${this.connection.config?.homeDirectory}/.bashrc`;
    let bashrcExists = (await this.connection.sendCommand({ command: `test -e ${bashrcFile}` })).code === 0;
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
      this.delayedOperations.push(async () => {
        this.appendOutput(`${bashrcExists ? "update" : "create"} ${bashrcFile}`);
        if (!bashrcExists) {
          const createBashrc = await this.connection.sendCommand({ command: `echo "# Generated by Code for IBM i\nexport PATH=/QOpenSys/pkgs/bin:\\$PATH" >> ${bashrcFile} && chown ${this.connectionObject.username.toLowerCase()} ${bashrcFile} && chmod 755 ${bashrcFile}` });
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

  async validateLibraryList() {
    this.progress.report({
        message: `Validate configured library list`
      });
      let validLibs: string[] = [];
      let badLibs: string[] = [];

      if(this.connection.config){
      const result = await this.connection.sendQsh({
        command: [
          `liblist -d ` + this.connection.defaultUserLibraries.join(` `).replace(/\$/g, `\\$`),
          ...this.connection.config.libraryList.map(lib => `liblist -a ` + lib.replace(/\$/g, `\\$`))
        ].join(`; `)
      });
    
      if (result.stderr) {
        const lines = result.stderr.split(`\n`);

        lines.forEach(line => {
          const badLib = this.connection.config?.libraryList.find(lib => line.includes(`ibrary ${lib} `));

          // If there is an error about the library, store it
          if (badLib) badLibs.push(badLib);
        });
      }

      if (result && badLibs.length > 0) {
        validLibs = this.connection.config?.libraryList.filter(lib => !badLibs.includes(lib));
        const chosen = await vscode.window.showWarningMessage(`The following ${badLibs.length > 1 ? `libraries` : `library`} does not exist: ${badLibs.join(`,`)}. Remove ${badLibs.length > 1 ? `them` : `it`} from the library list?`, `Yes`, `No`);
        if (chosen === `Yes`) {
          this.connection.config!.libraryList = validLibs;
        } else {
          vscode.window.showWarningMessage(`The following libraries does not exist: ${badLibs.join(`,`)}.`);
        }
      }
    }
  }
  
    private appendOutput(content: string) {
      if (this.connection.outputChannel) {
        this.connection.outputChannel.append(content);
      }
    }
  
  }