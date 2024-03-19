import path from 'path';

import IBMi from "./IBMi";
import IBMiContent from "./IBMiContent";
import { CommandResult, RemoteFeature, RemoteApps } from "../typings";
import { Tools } from './Tools';
import RemoteApp from './RemoteApp';
import { instance } from "../instantiate";
import { get } from 'http';

export default class ConnectionSettings {

  private remoteApp: RemoteApp;

  constructor(private connection: IBMi) {
    this.remoteApp = new RemoteApp();
  }

  async CheckShellOutput(): Promise<boolean> {

    const checkShellText = `This should be the only text!`;
    const checkShellResult = await this.connection.sendCommand({
      command: `echo "${checkShellText}"`,
      directory: `.`
    });

    if (checkShellResult.stdout.split(`\n`)[0] !== checkShellText) {
      return false; //Shell config error
    }

    return true;

  }

  async checkHomeDirectory(): Promise<{ homeErr: boolean, homeDir: string, homeExists: boolean, homeChanged: boolean, homeMsg: string }> {

    let homeDir; //Home Directory name
    let homeExists = false; //Home directory exists will be true otherwise false
    let homeChanged = false; //Home directory exists and value changed
    let homeMsg = '';
    let homeErr = false;

    const homeResult = await this.connection.sendCommand({
      command: `echo $HOME && cd && test -w $HOME`,
      directory: `.`
    });

    homeDir = homeResult.stdout.trim();
    // Note: if the home directory does not exist, the behavior of the echo/cd/test command combo is as follows:
    //   - stderr contains 'Could not chdir to home directory /home/________: No such file or directory'
    //       (The output contains 'chdir' regardless of locale and shell, so maybe we could use that 
    //        if we iterate on this code again in the future)
    //   - stdout contains the name of the home directory (even if it does not exist)
    //   - The 'cd' command causes an error if the home directory does not exist or otherwise can't be cd'ed into
    //   - The 'test' command causes an error if the home directory is not writable (one can cd into a non-writable directory)
    const isHomeUsable = (0 == homeResult.code);
    if (isHomeUsable) {
      homeExists = true;
    }
    else {
      // Let's try to provide more valuable information to the user about why their home directory
      // is bad and maybe even provide the opportunity to create the home directory
      // we _could_ just assume the home directory doesn't exist but maybe there's something more going on, namely mucked-up permissions
      let doesHomeExist = (0 === (await this.connection.sendCommand({ command: `test -e ${homeDir}` })).code);
      if (doesHomeExist) {
        // Note: this logic might look backward because we fall into this (failure) leg on what looks like success (home dir exists).
        //       But, remember, but we only got here if 'cd $HOME' failed.
        //       Let's try to figure out why....
        if (0 !== (await this.connection.sendCommand({ command: `test -d ${homeDir}` })).code) {
          homeErr = true;
          homeMsg = `Your home directory (${homeDir}) is not a directory! Code for IBM i may not function correctly. Please contact your system administrator.`;
        }
        else if (0 !== (await this.connection.sendCommand({ command: `test -w ${homeDir}` })).code) {
          homeErr = true;
          homeMsg = `Your home directory (${homeDir}) is not writable! Code for IBM i may not function correctly. Please contact your system administrator.`;
        }
        else if (0 !== (await this.connection.sendCommand({ command: `test -x ${homeDir}` })).code) {
          homeErr = true;
          homeMsg = `Your home directory (${homeDir}) is not usable due to permissions! Code for IBM i may not function correctly. Please contact your system administrator.`;
        }
        else {
          // not sure, but get your sys admin involved
          homeErr = true;
          homeMsg = `Your home directory (${homeDir}) exists but is unusable. Code for IBM i may not function correctly. Please contact your system administrator.`;
        }
      }
      else homeExists = false;
    }

    if (!homeErr && this.connection.config) {

      // Check to see if we need to store a new value for the home directory
      if (homeExists) {

        if (this.connection.config?.homeDirectory !== homeDir) {
          homeChanged = true;
          this.connection.config.homeDirectory = homeDir;
        }
      } else {
        // New connections always have `.` as the initial value. 
        // If we can't find a usable home directory, just reset it to
        // the initial default.
        this.connection.config.homeDirectory = `.`;
      }

      //Set a default IFS listing
      if (this.connection.config?.ifsShortcuts.length === 0) {
        if (homeExists) {
          this.connection.config.ifsShortcuts = [this.connection.config.homeDirectory];
        } else {
          this.connection.config.ifsShortcuts = [`/`];
        }
      }
    }

    return { homeErr, homeDir, homeExists, homeChanged, homeMsg };
  }

  async createHomeDirectory(homeDir: string, username: string): Promise<{ homeCreated: boolean, homeMsg: string }> {

    let homeCreated = true;
    let homeMsg = '';

    let mkHomeCmd = `mkdir -p ${homeDir} && chown ${username.toLowerCase()} ${homeDir} && chmod 0755 ${homeDir}`;
    let mkHomeResult = await this.connection.sendCommand({ command: mkHomeCmd, directory: `.` });
    if (0 !== mkHomeResult.code) {
      homeMsg = mkHomeResult.stderr;
      // We still get 'Could not chdir to home directory' in stderr so we need to hackily gut that out, as well as the bashisms that are a side effect of our API
      homeMsg = homeMsg.substring(1 + homeMsg.indexOf(`\n`)).replace(`bash: line 1: `, ``);
      homeCreated = false;
    } else {
      homeMsg = mkHomeResult.stderr;
      // We still get 'Could not chdir to home directory' in stderr so we need to hackily gut that out, as well as the bashisms that are a side effect of our API
      homeMsg = homeMsg.substring(1 + homeMsg.indexOf(`\n`)).replace(`bash: line 1: `, ``);
      homeMsg = `Error creating home directory (${homeDir}):\n${homeMsg}.\n\n Code for IBM i may not function correctly. Please contact your system administrator.`;
      homeCreated = false;
    }

    return { homeCreated, homeMsg };

  }

  async checkLibraryList(): Promise<boolean> {

    //Since the compiles are stateless, then we have to set the library list each time we use the `SYSTEM` command
    //We setup the defaultUserLibraries here so we can remove them later on so the user can setup their own library list
    let currentLibrary = `QGPL`;
    this.connection.defaultUserLibraries = [];
    let LibListSet = false;

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
        if (this.connection.config) {
          if (this.connection.config.currentLibrary.length === 0) {
            this.connection.config.currentLibrary = currentLibrary;
          }
          if (this.connection.config.libraryList.length === 0) {
            this.connection.config.libraryList = this.connection.defaultUserLibraries;
          }
          LibListSet = true;
        }

      }
    }

    return LibListSet;

  }

  async checkTempLibConfig(): Promise<boolean> {

    let tempLibrarySet = false;

    if (this.connection.config) {

      //Next, we need to check the temp lib (where temp outfile data lives) exists
      const createdTempLib = await this.connection.runCommand({
        command: `CRTLIB LIB(${this.connection.config.tempLibrary}) TEXT('Code for i temporary objects. May be cleared.')`,
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
          const tempLibExists = await this.connection.runCommand({
            command: `CHKOBJ OBJ(QSYS/${this.connection.config.tempLibrary}) OBJTYPE(*LIB)`,
            noLibList: true
          });

          if (tempLibExists.code === 0) {
            //We're all good if no errors
            tempLibrarySet = true;
          } else if (this.connection.config.currentLibrary && !this.connection.config.currentLibrary.startsWith(`Q`)) {
            //Using ${currentLibrary} as the temporary library for temporary data.
            this.connection.config.tempLibrary = this.connection.config.currentLibrary;
            tempLibrarySet = true;
          }
        }
      }

    }

    return tempLibrarySet;

  }

  async checkTempDirectoryConfig(): Promise<boolean> {

    let tempDirSet = false;
    // Next, we need to check if the temp directory exists
    let result = await this.connection.sendCommand({
      command: `[ -d "${this.connection.config?.tempDir}" ]`
    });

    if (result.code === 0) {
      // Directory exists
      tempDirSet = true;
    } else {
      // Directory does not exist, try to create it
      let result = await this.connection.sendCommand({
        command: `mkdir -p ${this.connection.config?.tempDir}`
      });
      if (result.code === 0) {
        // Directory created
        tempDirSet = true;
      } else {
        // Directory not created
      }
    }

    if (!tempDirSet && this.connection.config) {
      this.connection.config.tempDir = `/tmp`;
    }

    return tempDirSet;

  }

  clearTempDataSys(): Promise<{ cleared: boolean, message: string }> {

    let cleared = false;
    let message = '';

    if (this.connection.config?.tempLibrary) {
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
              cleared = false;
              message = `Temporary data not cleared from ${this.connection.config?.tempLibrary}.`;

            }
          }
          else {
            cleared = true;
            message = 'Temporary data cleared from ' + this.connection.config?.tempLibrary;
          }
        });
    }

    return Promise.resolve({ cleared, message });

  }

  clearTempDataIFS(): Promise<{ cleared: boolean, message: string }> {

    let cleared = false;
    let message = '';

    if (this.connection.config?.tempLibrary) {
      this.connection.sendCommand({
        command: `rm -f ${path.posix.join(this.connection.config.tempDir, `vscodetemp*`)}`
      })
        .then(result => {
          // All good!
          cleared = true;
          message = `Temporary data cleared from ${this.connection.config?.tempDir}.`
        })
        .catch(e => {
          // CPF2125: No objects deleted.
          // @ts-ignore We know the config exists.
          cleared = false;
          message = `Temporary data not cleared from ${this.connection.config?.tempDir}.`
        });
    }

    return Promise.resolve({ cleared, message });

  }

  async checkQCPTOIMPF(): Promise<boolean> {

    let dataArea = false;

    const QCPTOIMPF = await this.connection.runCommand({
      command: `CHKOBJ OBJ(QSYS/QCPTOIMPF) OBJTYPE(*DTAARA)`,
      noLibList: true
    });
    if (QCPTOIMPF?.code === 0) {
      dataArea = true;
    }
    return dataArea;
  }

  deleteQCPTOIMPF(): Promise<CommandResult> {
    return this.connection.runCommand({
      command: `DLTOBJ OBJ(QSYS/QCPTOIMPF) OBJTYPE(*DTAARA)`,
      noLibList: true
    });
  }

  async checkQCPFRMIMPF(): Promise<boolean> {

    let dataArea = false;

    const QCPFRMIMPF = await this.connection.runCommand({
      command: `CHKOBJ OBJ(QSYS/QCPFRMIMPF) OBJTYPE(*DTAARA)`,
      noLibList: true
    });

    if (QCPFRMIMPF?.code === 0) {
      dataArea = true;
    }

    return dataArea;
  }

  deleteQCPFRMIMPF(): Promise<CommandResult> {
    return this.connection.runCommand({
      command: `DLTOBJ OBJ(QSYS/QCPFRMIMPF) OBJTYPE(*DTAARA)`,
      noLibList: true
    });
  }

  getRemoteApps(): RemoteApps {
    // We need to check if our remote programs are installed.
    if (this.connection.config?.tempLibrary) {
      this.remoteApp.addFeature(
        {
          path: `/QSYS.lib/${this.connection.config.tempLibrary.toUpperCase()}.lib/`,
          names: [`GENCMDXML.PGM`, `GETNEWLIBL.PGM`],
          specific: `GE*.PGM`
        }
      );
    }
    return this.remoteApp.getFeatures();
  }

  async checkInstalledFeature(remoteFeature: RemoteFeature) {

    //Next, we see what pase features are available (installed via yum)
    //This may enable certain features in the future.
    try {
      const call = await this.connection.sendCommand({ command: `ls -p ${remoteFeature.path}${remoteFeature.specific || ``}` });
      if (call.stdout) {
        const files = call.stdout.split(`\n`);

        if (remoteFeature.specific) {
          for (const name of remoteFeature.names)
            this.connection.remoteFeatures[name] = files.find(file => file.includes(name));
        } else {
          for (const name of remoteFeature.names)
            if (files.includes(name))
              this.connection.remoteFeatures[name] = remoteFeature.path + name;
        }
      }
    } catch (e) {
      console.log(e);
    }
  }

  async checkASPInfo(): Promise<boolean> {

    let getASPInfo = false;

    //This is mostly a nice to have. We grab the ASP info so user's do
    //not have to provide the ASP in the settings.
    const resultSet = await new IBMiContent(this.connection).runSQL(`SELECT * FROM QSYS2.ASP_INFO`);
    resultSet.forEach(row => {
      if (row.DEVICE_DESCRIPTION_NAME && row.DEVICE_DESCRIPTION_NAME && row.DEVICE_DESCRIPTION_NAME !== `null`) {
        this.connection.aspInfo[Number(row.ASP_NUMBER)] = String(row.DEVICE_DESCRIPTION_NAME);
        getASPInfo = true;
      }
    });

    return Promise.resolve(getASPInfo);

  }

  async checkCCSID(): Promise<{ ccsidNum: number, ccsidSet: boolean, ccsidMessage: string }> {

    let ccsidNum = 0;
    let ccsidSet = false;
    let ccsidMessage = '';

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
          ccsidNum = row.CHARACTER_CODE_SET_ID;
          ccsidSet = true;
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
            ccsidNum = ccsid.CURRENT_NUMERIC_VALUE;
            ccsidSet = true;
          }
        }
      }
    }
    catch (e: any) {
      ccsidNum = 0;
      ccsidSet = false;
      ccsidMessage = e.message;
    }

    return Promise.resolve({ ccsidNum, ccsidSet, ccsidMessage });

  }

  async checkLocalEncoding(): Promise<{ local: String, localEncoding: boolean, localMessage: string }> {

    let local = '';
    let localEncoding = false;
    let localMessage = '';

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
          local = row.LOCAL;
          localEncoding = true;
        }
      } else {
        localEncoding = false;
        localMessage = `There was an error running the SQL statement to retreive Local Encoding.`;
      }
    }
    catch (e: any) {
      console.log(e);
      localEncoding = false;
      localMessage = e.message;
    }

    return Promise.resolve({ local, localEncoding, localMessage });

  }

  async checkDefaultShell(): Promise<{ usesBash: boolean, bashMessage: string }> {

    let usesBash = false;
    let bashMessage = '';

    try {
      if (this.connection.config) {
        this.connection.config.usesBash = false;
        //check users default shell
        const bashShellPath = '/QOpenSys/pkgs/bin/bash';
        const commandShellResult = await this.connection.sendCommand({
          command: `echo $SHELL`
        });
        if (!commandShellResult.stderr) {
          this.connection.config.usesBash = commandShellResult.stdout.trim() === bashShellPath;
          usesBash = this.connection.config.usesBash;
        }
      }
    }
    catch (e: any) {
      // Oh well...trying to set default shell is not worth stopping for.
      console.log(e);
      usesBash = false;
      bashMessage = e.message;
    }

    return Promise.resolve({ usesBash, bashMessage });

  }

  async setShelltoBash(): Promise<boolean> {

    let usesBash = false;

    if (this.connection.config) {
      const commandSetBashResult = await this.connection.sendCommand({
        command: `/QOpenSys/pkgs/bin/chsh -s /QOpenSys/pkgs/bin/bash`
      });
      if (!commandSetBashResult.stderr) {
        this.connection.config.usesBash = true;
        usesBash = true;
      } else {
        this.connection.config.usesBash = false;
        usesBash = false;
      }
    }

    return Promise.resolve(usesBash);

  }

  async checkBashPath(): Promise<{ reason: string, bashrcFile: string, bashrcExists: boolean }> {

    const currentPaths = (await this.connection.sendCommand({ command: "echo $PATH" })).stdout.split(":");
    const bashrcFile = `${this.connection.config?.homeDirectory}/.bashrc`;
    const bashrcExists = (await this.connection.sendCommand({ command: `test -e ${bashrcFile}` })).code === 0;

    let reason = '';
    if (!currentPaths.includes("/QOpenSys/pkgs/bin")) {
      reason = "Your $PATH shell environment variable does not include /QOpenSys/pkgs/bin";
    }
    else if (currentPaths.indexOf("/QOpenSys/pkgs/bin") > currentPaths.indexOf("/usr/bin") || currentPaths.indexOf("/QOpenSys/pkgs/bin") > currentPaths.indexOf("/QOpenSys/usr/bin")) {
      reason = "/QOpenSys/pkgs/bin is not in the right position in your $PATH shell environment variable";
    }
    return Promise.resolve({ reason, bashrcFile, bashrcExists });
  }

  async updateBashrc(bashrcFile: string, username: string): Promise<CommandResult> {
    const bashrc = await this.connection.sendCommand({ command: `echo "# Generated by Code for IBM i\nexport PATH=/QOpenSys/pkgs/bin:\\$PATH" >> ${bashrcFile} && chown ${username.toLowerCase()} ${bashrcFile} && chmod 755 ${bashrcFile}` });
    return bashrc;
  }

  async createBashrc(bashrcFile: string) {
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

  async validateLibraryList(): Promise<string[]> {

    let badLibs: string[] = [];

    if (this.connection.config) {
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
    }

    return badLibs;

  }
}