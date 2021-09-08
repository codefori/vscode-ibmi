
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

            const parts = CLCommands.getCLParts(document, new vscode.Range(new vscode.Position(0, 0), position));

            if (parts.length >= 1) {
              /** @type {string|undefined} */
              let currentParameter = undefined;
              let nameIndex = -1;
              
              for (let i = parts.length - 1; i >= 0; i--) {
                if (parts[i].includes(`(`) === false && parts[i].includes(`)`) === false) {
                  nameIndex = i;
                  break;
                }
              }

              let parmIdx = parts[parts.length-1].indexOf(`(`);
              if (parmIdx > -1 && parts[parts.length-1].includes(`)`) === false) currentParameter = parts[parts.length-1].substr(0, parmIdx);

              if (nameIndex > -1) {
                const name = parts[nameIndex].toUpperCase();
                const existingParms = parts.slice(nameIndex).map(part => part.includes(`(`) ? part.substr(0, part.indexOf(`(`)) : undefined);

                const docs = await this.getCommand(name);
                
                if (docs) {
                  let { parms, commandInfo } = docs;
                  let item;

                  if (currentParameter) {
                    const singleParm = parms.find(parm => parm.keyword === currentParameter);
                    if (singleParm) {
                      for (const parm of singleParm.specialValues) {
                        item = new vscode.CompletionItem(parm, vscode.CompletionItemKind.Property);
                        item.insertText = new vscode.SnippetString(`${parm}\$0`);
                        items.push(item);
                      }
                    }

                  } else {
                    parms = parms.filter(parm => existingParms.includes(parm.keyword) === false);
  
                    if (parms.length > 0) {
                      item = new vscode.CompletionItem(`All parameters`, vscode.CompletionItemKind.Interface);
                      item.insertText = new vscode.SnippetString(parms.map((parm, idx) => `${parm.keyword}(\${${idx+1}:})`).join(` `) + `\$0`);
                      item.detail = commandInfo.Prompt;
                      items.push(item);
                    }
  
                    for (const parm of parms) {
                      item = new vscode.CompletionItem(parm.keyword, vscode.CompletionItemKind.TypeParameter);
                      item.insertText = new vscode.SnippetString(`${parm.keyword}(\${1:})\$0`);
                      item.detail = parm.prompt + ` ${parm.type ? `(${parm.choice || parm.type})` : ``}`.trimEnd();
                      items.push(item);
                    }
                  }

                  return items;
                }
              }
            }

          }
        }
      }),

      vscode.languages.registerHoverProvider({language: `cl`}, {
        provideHover: async (document, position, token) => {
          if (this.enabled) {
            const range = document.getWordRangeAtPosition(position);
            let command = document.getText(range).toUpperCase();
            let possibleParm = document.getText(new vscode.Range(range.start.line, range.start.character, range.end.line, range.end.character + 1));

            if (possibleParm.endsWith(`(`)) {
              possibleParm = possibleParm.substr(0, possibleParm.length - 1);

              const parts = CLCommands.getCLParts(document, new vscode.Range(new vscode.Position(0, 0), position));
  
              if (parts.length >= 1) {
                let nameIndex = -1;
                
                //We minus two here to not include the highlighed word
                for (let i = parts.length - 2; i >= 0; i--) {
                  if (parts[i].includes(`(`) === false && parts[i].includes(`)`) === false) {
                    nameIndex = i;
                    break;
                  }
                }

                if (nameIndex > -1) {
                  command = parts[nameIndex].toUpperCase();
                  const docs = await this.getCommand(command);
                  
                  if (docs) {
                    let { parms, commandInfo } = docs;

                    const singleParm = parms.find(parm => parm.keyword === possibleParm);
                    if (singleParm) {
                      let markdown = [];
  
                      markdown.push(`**${commandInfo.CmdName}** ${singleParm.keyword}`, ``);
                      markdown.push(`${singleParm.prompt} - ${singleParm.type || ``}`, ``);

                      if (singleParm.specialValues) {
                        for (const opt of singleParm.specialValues) {
                          markdown.push(`* \`${opt}\``);
                        }
                      }
        
                      return new vscode.Hover(
                        new vscode.MarkdownString(
                          markdown.join(`\n`)
                        )
                      );
                    }
                  }
                }
              }

            } else {
              const docs = await this.getCommand(command);

              if (docs) {
                const { parms, commandInfo } = docs;
  
                let markdown = [];
  
                markdown.push(`**${commandInfo.CmdName}** (${parms.length} parameters)`, ``);

                for (const parm of parms) {
                  markdown.push(`* **\`${parm.keyword}\`**: ${parm.prompt} - ${parm.choice || parm.type}`);
                }
  
                return new vscode.Hover(
                  new vscode.MarkdownString(
                    markdown.join(`\n`)
                  )
                );
              }
            }

          }
          return undefined;
        }
      }),
    );
  }

  /**
   * @param {string} name
   */
  async getCommand(name) {
    let docs;
    if (this.commands[name]) {
      docs = this.commands[name];
    } else {
      this.commands[name] = await CLCommands.genDefinition(name);
      docs = this.commands[name];
    }

    if (docs) {
      return CLCommands.getPrettyDocs(docs);
    }
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
   * 
   * @param {*} docs 
   * @returns {{commandInfo: {CmdName: string, Prompt: string, Choice: string}, parms: {keyword: string, prompt: string, type: string, choice: string, specialValues: string[]}[]}}}
   */
  static getPrettyDocs(docs) {
    const commandInfo = docs.QcdCLCmd.Cmd[0][`$`];
    const paramaters = docs.QcdCLCmd.Cmd[0].Parm;

    /** @type {any[]} */
    const parms = paramaters.map(parm => {
      const info = parm[`$`];
      const qual = parm.Qual;
      const spcVal = parm.SpcVal;

      let specialValues = [];

      if (spcVal && spcVal.length > 0) {
        const opts = spcVal[0].Value;

        specialValues = opts.map(value => value[`$`].Val);
      }

      return {
        keyword: info.Kwd,
        prompt: info.Prompt,
        choice: info.Choice,
        type: info.Type,
        position: Number(info.PosNbr),
        specialValues
      }
    });

    return {
      commandInfo,
      parms
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

    return content.trim().split(` `).filter(part => part.length > 0);
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