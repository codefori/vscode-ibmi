import IBMi from "./IBMi";
import { Tools } from "./Tools";
import path from 'path';
import { aspInfo } from "../typings";

const CCSID_SYSVAL = -2;

export default class IBMiSettings {

  constructor(private connection: IBMi) {

  }

  async checkShellOutput(): Promise<boolean> {

    const checkShellText = `This should be the only text!`;
    const checkShellResult = await this.connection.sendCommand({
      command: `echo "${checkShellText}"`,
      directory: `.`
    });

    return Promise.resolve(checkShellResult.stdout.split(`\n`)[0] == checkShellText);

  }

  async getHomeDirectory(): Promise<{ homeExists: boolean, homeDir: string, homeMsg: string }> {

    let homeDir;
    let homeMsg = '';
    let homeExists;

    const homeResult = await this.connection.sendCommand({
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

    homeExists = homeResult.code == 0;
    homeDir = homeResult.stdout.trim();

    if (!homeExists) {
      // Let's try to provide more valuable information to the user about why their home directory
      // is bad and maybe even provide the opportunity to create the home directory

      // we _could_ just assume the home directory doesn't exist but maybe there's something more going on, namely mucked-up permissions
      homeExists = (0 === (await this.connection.sendCommand({ command: `test -e ${homeDir}` })).code);
      if (homeExists) {
        // Note: this logic might look backward because we fall into this (failure) leg on what looks like success (home dir exists).
        //       But, remember, but we only got here if 'cd $HOME' failed.
        //       Let's try to figure out why....
        if (0 !== (await this.connection.sendCommand({ command: `test -d ${homeDir}` })).code) {
          homeMsg = `Your home directory (${homeDir}) is not a directory! Code for IBM i may not function correctly. Please contact your system administrator.`;
        }
        else if (0 !== (await this.connection.sendCommand({ command: `test -w ${homeDir}` })).code) {
          homeMsg = `Your home directory (${homeDir}) is not writable! Code for IBM i may not function correctly. Please contact your system administrator.`;

        }
        else if (0 !== (await this.connection.sendCommand({ command: `test -x ${homeDir}` })).code) {
          homeMsg = `Your home directory (${homeDir}) is not usable due to permissions! Code for IBM i may not function correctly. Please contact your system administrator.`;
        }
        else {
          // not sure, but get your sys admin involved
          homeMsg = `Your home directory (${homeDir}) exists but is unusable. Code for IBM i may not function correctly. Please contact your system administrator.`;
        }
      }
      else {
        homeMsg = `Your home directory (${homeDir}) does not exist, so Code for IBM i may not function correctly.`;
      }
    }

    return Promise.resolve({ homeExists, homeDir, homeMsg });

  }

  async createHomeDirectory(homeDir: string, username: string): Promise<{ homeCreated: boolean, homeMsg: string }> {

    let homeCreated = false;
    let homeMsg = '';

    const homeCmd = `mkdir -p ${homeDir} && chown ${username.toLowerCase()} ${homeDir} && chmod 0755 ${homeDir}`;

    let mkHomeResult = await this.connection.sendCommand({ command: homeCmd, directory: `.` });

    if (0 === mkHomeResult.code) {
      homeCreated = true;
    } else {
      let mkHomeErrs = mkHomeResult.stderr;
      // We still get 'Could not chdir to home directory' in stderr so we need to hackily gut that out, as well as the bashisms that are a side effect of our API
      homeMsg = mkHomeErrs.substring(1 + mkHomeErrs.indexOf(`\n`)).replace(`bash: line 1: `, ``);
    }

    return Promise.resolve({ homeCreated, homeMsg });

  }

  async getLibraryList(): Promise<{ libStatus: boolean, currentLibrary: string, defaultUserLibraries: string[] }> {



    //Since the compiles are stateless, then we have to set the library list each time we use the `SYSTEM` command
    //We setup the defaultUserLibraries here so we can remove them later on so the user can setup their own library list

    let currentLibrary = `QGPL`;
    let defaultUserLibraries = [];
    let libStatus = false;

    const liblResult = await this.connection.sendQsh({
      command: `liblist`
    });

    if (liblResult.code === 0) {
      libStatus = true;
      const libraryListString = liblResult.stdout;
      if (libraryListString !== ``) {
        const libraryList = libraryListString.split(`\n`);

        let lib, type;
        for (const line of libraryList) {
          lib = line.substring(0, 10).trim();
          type = line.substring(12);

          switch (type) {
            case `USR`:
              defaultUserLibraries.push(lib);
              break;

            case `CUR`:
              currentLibrary = lib;
              break;
          }
        }
      }
    }

    return Promise.resolve({ libStatus, currentLibrary, defaultUserLibraries });

  }

  async setTempLibrary(tempLibrary: string): Promise<boolean> {

    let tempLibrarySet = false;

    //Check the temp lib (where temp outfile data lives) exists
    const createdTempLib = await this.connection.runCommand({
      command: `CRTLIB LIB(${tempLibrary}) TEXT('Code for i temporary objects. May be cleared.')`,
      noLibList: true
    });

    if (createdTempLib.code === 0) {
      tempLibrarySet = true;
    }
    else {
      const messages = Tools.parseMessages(createdTempLib.stderr);
      if (messages.findId(`CPF2158`) || messages.findId(`CPF2111`)) { //Already exists, hopefully ok :)
        tempLibrarySet = true;
      }
      else if (messages.findId(`CPD0032`)) { //Can't use CRTLIB
        const tempLibExists = await this.connection.runCommand({
          command: `CHKOBJ OBJ(QSYS/${tempLibrary}) OBJTYPE(*LIB)`,
          noLibList: true
        });

        if (tempLibExists.code === 0) {
          //We're all good if no errors
          tempLibrarySet = true;
        }
        else {
          tempLibrarySet = false;
        }

      }
    }

    return Promise.resolve(tempLibrarySet);

  }

  async setTempDirectory(tempDir: string): Promise<boolean> {

    let tempDirSet = false;

    // Check if the temp directory exists
    let result = await this.connection.sendCommand({
      command: `[ -d "${tempDir}" ]`
    });

    if (result.code === 0) {
      // Directory exists
      tempDirSet = true;
    } else {
      // Directory does not exist, try to create it
      let result = await this.connection.sendCommand({
        command: `mkdir -p ${tempDir}`
      });
      if (result.code === 0) {
        // Directory created
        tempDirSet = true;
      } else {
        // Directory not created
      }
    }

    return Promise.resolve(tempDirSet);

  }

  async clearTempLibrary(tempLibrary: string): Promise<string> {

    let clearMsg = '';

    this.connection.runCommand({
      command: `DLTOBJ OBJ(${tempLibrary}/O_*) OBJTYPE(*FILE)`,
      noLibList: true,
    })
      .then(result => {
        // All good!
        if (result && result.stderr) {
          const messages = Tools.parseMessages(result.stderr);
          if (!messages.findId(`CPF2125`)) {
            clearMsg = `Temporary data not cleared from ${tempLibrary}.`;
          }
        }
      });

    return Promise.resolve(clearMsg);

  }

  async clearTempDirectory(tempDir: string): Promise<string> {

    let clearMsg = '';

    try {
      this.connection.sendCommand({
        command: `rm -rf ${path.posix.join(tempDir, `vscodetemp*`)}`
      });
    }
    catch (e) {
      // CPF2125: No objects deleted.
      clearMsg = `Temporary data not cleared from ${tempDir}.`;
    }

    return Promise.resolve(clearMsg);

  }

  async getASPInfo(): Promise<aspInfo> {

    let aspInfo: aspInfo = {};

    try {
      const resultSet = await this.connection.runSQL(`SELECT * FROM QSYS2.ASP_INFO`);
      if (resultSet.length) {
        resultSet.forEach(row => {
          if (row.DEVICE_DESCRIPTION_NAME && row.DEVICE_DESCRIPTION_NAME && row.DEVICE_DESCRIPTION_NAME !== `null`) {
            aspInfo[Number(row.ASP_NUMBER)] = String(row.DEVICE_DESCRIPTION_NAME);
          }
        });
      }
    } catch (e) {
      //Oh well
      return Promise.reject(e);
    }

    return Promise.resolve(aspInfo);

  }

  async getQCCSID(): Promise<number> {

    let qccsid = 0;

    const [systemCCSID] = await this.connection.runSQL(`select SYSTEM_VALUE_NAME, CURRENT_NUMERIC_VALUE from QSYS2.SYSTEM_VALUE_INFO where SYSTEM_VALUE_NAME = 'QCCSID'`);
    if (typeof systemCCSID.CURRENT_NUMERIC_VALUE === 'number') {
      qccsid = systemCCSID.CURRENT_NUMERIC_VALUE;
    }

    return Promise.resolve(qccsid);

  }

  async getjobCCSID(userName: string): Promise<number> {

    let jobCCSID = CCSID_SYSVAL;

    const [userInfo] = await this.connection.runSQL(`select CHARACTER_CODE_SET_ID from table( QSYS2.QSYUSRINFO( USERNAME => upper('${userName}') ) )`);
    if (userInfo.CHARACTER_CODE_SET_ID !== `null` && typeof userInfo.CHARACTER_CODE_SET_ID === 'number') {
      jobCCSID = userInfo.CHARACTER_CODE_SET_ID;
    }

    return Promise.resolve(jobCCSID);

  }

  async getDefaultCCSID(): Promise<number> {

    let userDefaultCCSID = 0;

    try {
      const [activeJob] = await this.connection.runSQL(`Select DEFAULT_CCSID From Table(QSYS2.ACTIVE_JOB_INFO( JOB_NAME_FILTER => '*', DETAILED_INFO => 'ALL' ))`);
      userDefaultCCSID = Number(activeJob.DEFAULT_CCSID);
    }
    catch (error) {
      const [defaultCCSID] = (await this.connection.runCommand({ command: "DSPJOB OPTION(*DFNA)" }))
        .stdout
        .split("\n")
        .filter(line => line.includes("DFTCCSID"));

      const defaultCCSCID = Number(defaultCCSID.split("DFTCCSID").at(1)?.trim());
      if (defaultCCSCID && !isNaN(defaultCCSCID)) {
        userDefaultCCSID = defaultCCSCID;
      }
    }

    return Promise.resolve(userDefaultCCSID);

  }

  async getLocalEncodingValues(): Promise<string> {

    let localEncoding = '';

    const [variants] = await this.connection.runSQL(`With VARIANTS ( HASH, AT, DOLLARSIGN ) as (`
      + `  values ( cast( x'7B' as varchar(1) )`
      + `         , cast( x'7C' as varchar(1) )`
      + `         , cast( x'5B' as varchar(1) ) )`
      + `)`
      + `Select HASH concat AT concat DOLLARSIGN as LOCAL from VARIANTS`);

    if (typeof variants.LOCAL === 'string' && variants.LOCAL !== `null`) {
      localEncoding = variants.LOCAL;
    }

    return Promise.resolve(localEncoding);

  }

  async setBash(): Promise<boolean> {

    let bashset = false;

    const commandSetBashResult = await this.connection.sendCommand({
      command: `/QOpenSys/pkgs/bin/chsh -s /QOpenSys/pkgs/bin/bash`
    });

    if (!commandSetBashResult.stderr) bashset = true;

    return Promise.resolve(bashset);

  }

  async getEnvironmentVariable(envVar: string): Promise<string[]> {
    return (await this.connection.sendCommand({ command: `echo ${envVar}` })).stdout.split(":");
  }

  async checkPaths(requiredPaths: string[]): Promise<{ reason: string, missingPath: string }> {

    const currentPaths = await this.getEnvironmentVariable('$PATH');

    let reason = '';
    let missingPath = '';

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

    return Promise.resolve({ reason: reason, missingPath: missingPath });

  }

  async checkBashRCFile(bashrcFile: string): Promise<boolean> {

    let bashrcExists = false;

    bashrcExists = (await this.connection.sendCommand({ command: `test -e ${bashrcFile}` })).code === 0;

    return Promise.resolve(bashrcExists);
  }

  async createBashrcFile(bashrcFile: string, username: string): Promise<{ createBash: boolean, createBashMsg: string }> {

    let createBash = true;
    let createBashMsg = '';

    // Add "/usr/bin" and "/QOpenSys/usr/bin" to the end of the path. This way we know that the user has 
    // all the required paths, but we don't overwrite the priority of other items on their path.
    const createBashrc = await this.connection.sendCommand({ command: `echo "# Generated by Code for IBM i\nexport PATH=/QOpenSys/pkgs/bin:\\$PATH:/QOpenSys/usr/bin:/usr/bin" >> ${bashrcFile} && chown ${username.toLowerCase()} ${bashrcFile} && chmod 755 ${bashrcFile}` });

    if (createBashrc.code !== 0) {
      createBash = false;
      createBashMsg = createBashrc.stderr;
    }

    return Promise.resolve({ createBash, createBashMsg });

  }

  async updateBashrcFile(bashrcFile: string): Promise<{ updateBash: boolean, updateBashMsg: string }> {

    let updateBash = true;
    let updateBashMsg = '';

    try {
      const content = this.connection.content;
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
      updateBash = false;
      updateBashMsg = <string>error;
    }

    return Promise.resolve({ updateBash, updateBashMsg });
  }

  async validateLibraryList(defaultUserLibraries: string[], libraryList: string[]): Promise<{ validLibs: string[], badLibs: string[] }> {

    let validLibs: string[] = [];
    let badLibs: string[] = [];

    const result = await this.connection.sendQsh({
      command: [
        `liblist -d ` + defaultUserLibraries.join(` `).replace(/\$/g, `\\$`),
        ...libraryList.map(lib => `liblist -a ` + lib.replace(/\$/g, `\\$`))
      ].join(`; `)
    });

    if (result.stderr) {
      const lines = result.stderr.split(`\n`);

      lines.forEach(line => {
        const badLib = libraryList.find(lib => line.includes(`ibrary ${lib} `));

        // If there is an error about the library, store it
        if (badLib) badLibs.push(badLib);
      });
    }

    if (result && badLibs.length > 0) {
      validLibs = libraryList.filter(lib => !badLibs.includes(lib));
    }

    return Promise.resolve({ validLibs, badLibs });

  }
}