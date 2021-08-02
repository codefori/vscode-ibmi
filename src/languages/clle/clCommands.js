
const vscode = require(`vscode`);
const util = require(`util`);
const fs = require(`fs`);

const parseString = util.promisify(require(`xml2js`).parseString);

const instance = require(`../../Instance`);
const Configuration = require(`../../api/Configuration`);
const IBMi = require(`../../api/IBMi`);

const gencmdxml = require(`./gencmdxml.js`).join(`\n`);

module.exports = class CLCommands {
  /**
   * @param {vscode.ExtensionContext} context
   */
  constructor(context) {
    this.enabled = false;
    this.commands = {};

    context.subscriptions.push(
      vscode.languages.registerCompletionItemProvider({language: `cl`}, {
        provideCompletionItems: async (document, position) => {
          if (this.enabled) {
            /** @type vscode.CompletionItem[] */
            let items = [];

            const line = document.getText(new vscode.Range(position.line, 0, 100, position.line)).toUpperCase();
            const parts = line.trim().split(` `);
            const existingParms = parts.map(part => part.includes(`(`) ? part.substr(0, part.indexOf(`(`)) : undefined);

            if (parts.length >= 1) {
              const name = parts[0];

              let docs;
              if (this.commands[name]) {
                docs = this.commands[name];
              } else {
                this.commands[name] = await CLCommands.genDefinition(parts[0]);
                docs = this.commands[name];
              }

              const commandInfo = docs.QcdCLCmd.Cmd[0][`$`];
              const paramaters = docs.QcdCLCmd.Cmd[0].Parm;

              let parms = paramaters.map(parm => {
                const info = parm[`$`];
                const qual = parm.Qual;

                return {
                  keyword: info.Kwd,
                  prompt: info.Prompt,
                  type: info.Type,
                  position: Number(info.PosNbr),
                }
              });

              parms = parms.filter(parm => existingParms.includes(parm.keyword) === false);

              let item;
              for (const parm of parms) {
                item = new vscode.CompletionItem(parm.keyword, vscode.CompletionItemKind.TypeParameter);
                item.insertText = new vscode.SnippetString(`${parm.keyword}(\${1:value})\$0`)
                item.detail = parm.prompt + ` ${parm.type ? `(${parm.type})` : ``}`.trimEnd();
                items.push(item);
              }

              return items;
            }

          }
        }
      }),
    );
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