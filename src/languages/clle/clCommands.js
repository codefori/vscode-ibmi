
const vscode = require(`vscode`);
const util = require(`util`);
const fs = require(`fs`);

const parseString = util.promisify(require(`xml2js`).parseString);

const {instance} = require(`../../Instance`);
const Configuration = require(`../../api/Configuration`);
const {default: IBMi} = require(`../../api/IBMi`);

const gencmdxml = require(`./gencmdxml.js`).join(`\n`);

module.exports = class CLCommands {
  /**
   * @param {vscode.ExtensionContext} context
   */
  constructor(context) {
    this.enabled = false;
  }

  async init() {
    const clComponentsInstalled = await CLCommands.checkRequirements();

    if (clComponentsInstalled) {
      this.enabled = true;
    } else {
      //We need to install the CL components
      vscode.window.showInformationMessage(`Would you like to install the CL prompting tools onto your system?`, `Yes`, `No`)
        .then(async result => {
          switch (result) {
          case `Yes`:
            try {
              await CLCommands.install();
              this.enabled = true;
              vscode.window.showInformationMessage(`CL components installed.`);
            } catch (e) {
              vscode.window.showInformationMessage(`Failed to install CL components.`);
            }
            break;
          }
        });
    }
  }

  /**
   * @param {vscode.Range} range
   * @returns {string[]}
   * */
  static getCLParts(document, range) {
    const eol = (document.eol === vscode.EndOfLine.LF ? `\n` : `\r\n`);
    let content = document.getText(range);
    const commentIndex = content.lastIndexOf(`*/`);

    if (commentIndex > -1) {
      content = content.substring(commentIndex + 2);
    }

    content = content.split(eol).join(` `);

    content = content.split(`'`).filter((part, index) => index % 2 === 0).join(``);

    return content
      .trim()
      .split(` `)
      .filter(part => part.length > 0 && part.trim() !== `+`);
  }

  static async checkRequirements() {
    /** @type {IBMi} */
    const connection = instance.getConnection();

    return (connection.remoteFeatures[`GENCMDXML.PGM`] !== undefined);
  }

  static async install() {
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
}