
const vscode = require(`vscode`);

const instance = require(`../Instance`);
const Configuration = require(`../api/Configuration`);
const IBMi = require(`../api/IBMi`);

const strc4icl = require(`./strc4icl.js`);
const strc4icmd = require(`./strc4icmd.js`);

const init = async () => {
  /** @type {IBMi} */
  const connection = instance.getConnection();

  if (!connection.remoteFeatures[`STRC4I.PGM`] || !connection.remoteFeatures[`STRC4I.CMD`]) {
    //We need to install the STRC4I components
    vscode.window.showInformationMessage(`Would you like to install the STRC4I command onto your system?`, `Yes`, `No`)
      .then(async result => {
        switch (result) {
        case `Yes`:
          try {
            await install();
            vscode.window.showInformationMessage(`STRC4I installed.`);
          } catch (e) {
            vscode.window.showInformationMessage(`Failed to install STRC4I components.`);
          }
          break;
        }
      });
 
  }
}

const install = async () => {
  /** @type {IBMi} */
  const connection = instance.getConnection();

  const content = instance.getContent();

  /** @type {Configuration} */
  const config = instance.getConfig();

  const tempLib = config.tempLibrary;

  try {
    await connection.remoteCommand(`CRTSRCPF ${tempLib}/QTOOLS`, undefined)
  } catch (e) {
    //It may exist already so we just ignore the error
  }

  if (!connection.remoteFeatures[`STRC4I.PGM`]) {
    await content.uploadMemberContent(undefined, tempLib, `QTOOLS`, `STRC4ICL`, strc4icl);
    await connection.remoteCommand(
      `CRTBNDCL PGM(${tempLib}/STRC4I) SRCFILE(${tempLib}/QTOOLS) SRCMBR(STRC4ICL) DBGVIEW(*SOURCE) TEXT('vscode-ibmi open from IBM i')`
    );
  }
 
  if (!connection.remoteFeatures[`STRC4I.CMD`]) {
    await content.uploadMemberContent(undefined, tempLib, `QTOOLS`, `STRC4ICMD`, strc4icmd);
    await connection.remoteCommand(
      `CRTCMD CMD(${tempLib}/STRC4I) PGM(${tempLib}/STRC4I) SRCFILE(${tempLib}/QTOOLS) SRCMBR(STRC4ICMD) TEXT('vscode-ibmi open from IBM i')`
    );

    await connection.remoteCommand(
      `CHGCMDDFT CMD(${tempLib}/STRC4I) NEWDFT('TMPPATH(''${config.tempDir}'')')`
    );
  }
}

module.exports = { init }