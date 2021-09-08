
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
            const eol = (document.eol === vscode.EndOfLine.LF ? `\n` : `\r\n`);

            /** @type vscode.CompletionItem[] */
            let items = [];

            let content = document.getText(new vscode.Range(new vscode.Position(0, 0), position));
            const commentIndex = content.lastIndexOf(`*/`);

            if (commentIndex > -1) {
              content = content.substring(commentIndex + 2);
            }

            content = content.split(`\n`).join(` `);

            const parts = content.trim().split(` `).filter(part => part.length > 0);

            if (parts.length >= 1) {
              let nameIndex = -1;
              
              for (let i = parts.length - 1; i >= 0; i--) {
                if (parts[i].includes(`(`) === false && parts[i].includes(`)`) === false) {
                  nameIndex = i;
                  break;
                }
              }

              if (nameIndex > -1) {
                const name = parts[nameIndex];
                const existingParms = parts.slice(nameIndex).map(part => part.includes(`(`) ? part.substr(0, part.indexOf(`(`)) : undefined);

                let docs;
                if (this.commands[name]) {
                  docs = this.commands[name];
                } else {
                  this.commands[name] = await CLCommands.genDefinition(name);
                  docs = this.commands[name];
                }

                const commandInfo = docs.QcdCLCmd.Cmd[0][`$`];
                const paramaters = docs.QcdCLCmd.Cmd[0].Parm;

                /** @type {any[]} */
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

                if (parms.length > 0) {
                  item = new vscode.CompletionItem(`All parameters`, vscode.CompletionItemKind.Interface);
                  item.insertText = new vscode.SnippetString(parms.map((parm, idx) => `${parm.keyword}(\${${idx+1}:x})`).join(` `) + `\$0`);
                  item.detail = commandInfo.Prompt;
                  items.push(item);
                }

                for (const parm of parms) {
                  item = new vscode.CompletionItem(parm.keyword, vscode.CompletionItemKind.TypeParameter);
                  item.insertText = new vscode.SnippetString(`${parm.keyword}(\${1:value})\$0`);
                  item.detail = parm.prompt + ` ${parm.type ? `(${parm.type})` : ``}`.trimEnd();
                  items.push(item);
                }

                return items;
              }
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