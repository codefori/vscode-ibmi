
const vscode = require(`vscode`);
const util = require(`util`);
const fs = require(`fs`);

const parseString = util.promisify(require(`xml2js`).parseString);

const instance = require(`../../Instance`);
const Configuration = require(`../../api/Configuration`);
const IBMi = require(`../../api/IBMi`);

const gencmdxml = require(`./gencmdxml.js`).join(`\n`);

module.exports = class Commands {
  static async checkRequirements() {
    /** @type {IBMi} */
    const connection = instance.getConnection();

    /** @type {Configuration} */
    const config = instance.getConfig();

    const tempLib = config.tempLibrary;

    try {
      await connection.remoteCommand(
        `CHKOBJ OBJ(${tempLib}/GENCMDXML) OBJTYPE(*PGM)`
      );

      // GENCMDXML is installed
      return true;

    } catch (e) {
      // GENCMDXML is not installed
      return false;
    }
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

  static async genDefinition(command, library = `*LIBL`) {
    /** @type {IBMi} */
    const connection = instance.getConnection();

    const content = instance.getContent();

    /** @type {Configuration} */
    const config = instance.getConfig();

    const tempLib = config.tempLibrary;

    const targetCommand = command.padEnd(10) + library.padEnd(10);
    const targetName = command.toUpperCase().padEnd(10);

    await connection.remoteCommand(`CALL PGM(${tempLib}/GENCMDXML) PARM('${targetName}' '${targetCommand}')`);

    const xml = await content.downloadStreamfile(`/tmp/${targetName}`);

    const commandData = await parseString(xml);

    return commandData;
  }
}