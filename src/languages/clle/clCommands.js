
const vscode = require(`vscode`);

const Configuration = require(`../../api/Configuration`);
const { default: IBMi } = require(`../../api/IBMi`);

const gencmdxml = require(`./gencmdxml.js`).join(`\n`);

exports.init = async () => {
  const clComponentsInstalled = checkRequirements();

  if (!clComponentsInstalled) {
    //We need to install the CL components
    vscode.window.showInformationMessage(`Would you like to install the CL prompting tools onto your system?`, `Yes`, `No`)
      .then(async result => {
        switch (result) {
        case `Yes`:
          try {
            await install();
            vscode.window.showInformationMessage(`CL components installed.`);
          } catch (e) {
            vscode.window.showInformationMessage(`Failed to install CL components.`);
          }
          break;
        }
      });
  }
}

function checkRequirements() {  
  const {instance} = require(`../../instantiate`);
  /** @type {IBMi} */
  const connection = instance.getConnection();

  return (connection.remoteFeatures[`GENCMDXML.PGM`] !== undefined);
}

async function install() {
  const {instance} = require(`../../instantiate`);
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

  await content.uploadMemberContent(undefined, tempLib, `QTOOLS`, `GENCMDXML`, gencmdxml);
  await connection.remoteCommand(
    `CRTBNDCL PGM(${tempLib}/GENCMDXML) SRCFILE(${tempLib}/QTOOLS) DBGVIEW(*SOURCE) TEXT('vscode-ibmi xml generator for commands')`
  );
}