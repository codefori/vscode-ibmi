
const path = require("path");
const vscode = require(`vscode`);

const instance = require(`../../Instance`);
const Configuration = require(`../../api/Configuration`);

module.exports = class RPGLinter {
  /**
   * @param {vscode.ExtensionContext} context
   */
  constructor(context) {
    this.linterDiagnostics = vscode.languages.createDiagnosticCollection(`Lint`);

    /** @type {Declaration[]} */
    this.variables = [];
    /** @type {Declaration[]} */
    this.procedures = [];
    /** @type {Declaration[]} */
    this.structs = [];

    /** @type {{[path: string]: string[]}} */
    this.copyBooks = {};

    context.subscriptions.push(
      this.linterDiagnostics,

      vscode.workspace.onDidChangeTextDocument((event) => {
        if (Configuration.get(`rpgleIndentationEnabled`)) {
          if (event.document.languageId === `rpgle`) {
            const text = event.document.getText();
            if (text.startsWith(`**FREE`)) {
              this.linterDiagnostics.set(event.document.uri, this.parseFreeFormatDocument(text, {
                indent: Number(vscode.window.activeTextEditor.options.tabSize)
              }));
            }
          }
        }
      }),

      vscode.languages.registerHoverProvider({language: `rpgle`}, {
        provideHover: (document, position, token) => {
          if (Configuration.get(`rpgleContentAssistEnabled`)) {
            const range = document.getWordRangeAtPosition(position);
            const word = document.getText(range).toUpperCase();

            const procedure = this.procedures.find(proc => proc.name.toUpperCase() === word.toUpperCase());

            if (procedure) {
              let retrunValue = procedure.keywords.filter(keyword => keyword !== `EXTPROC`);
              if (retrunValue.length === 0) retrunValue = [`void`];

              const markdown = `\`\`\`vb\n${procedure.name}(\n  ${procedure.subItems.map(parm => `${parm.name}: ${parm.keywords.join(` `)}`).join(`,\n  `)}\n): ${retrunValue.join(` `)}\n\`\`\` \n` +
              `\n\n` +
              procedure.subItems.map(parm => `*@param* ${parm.name.replace(new RegExp(`\\*`, `g`), `\\*`)} ${parm.comments}`).join(`\n\n`) +
              `\n\n*@returns* ${retrunValue.join(` `)}`;

              return new vscode.Hover(
                new vscode.MarkdownString(
                  markdown
                )
              );
            }

            const linePieces = document.lineAt(position.line).text.trim().split(` `);
            if ([`/COPY`, `/INCLUDE`].includes(linePieces[0].toUpperCase())) {
              const {type, memberPath, finishedPath} = this.getPathInfo(document.uri, linePieces[1]);

              return new vscode.Hover(
                new vscode.MarkdownString(
                  `\`'${finishedPath}'\` (${type})`
                )
              )
            }
          }

          return null;
        }
      }),

      vscode.languages.registerCompletionItemProvider({language: `rpgle`}, {
        provideCompletionItems: (document, position) => {
          /** @type vscode.CompletionItem[] */
          let items = [];
          let item;

          for (const procedure of this.procedures) {
            item = new vscode.CompletionItem(`${procedure.name}(${procedure.subItems.map((parm) => parm.name).join(`:`)})`, vscode.CompletionItemKind.Function);
            item.detail = procedure.keywords.join(` `);
            item.documentation = procedure.comments;
            items.push(item);
          }

          return items;
        }
      }),

      vscode.workspace.onDidSaveTextDocument((event) => {
        if (event.languageId === `rpgle`) {
          if (Configuration.get(`rpgleContentAssistEnabled`)) {
            const text = event.getText();
            if (text.startsWith(`**FREE`)) {
              this.getDocs(event.uri, text);
            }
          }
        }
      }),

      vscode.workspace.onDidOpenTextDocument((event) => {
        if (event.languageId === `rpgle`) {
          if (Configuration.get(`rpgleContentAssistEnabled`)) {
            const text = event.getText();
            if (text.startsWith(`**FREE`)) {
              this.getDocs(event.uri, text);
            }
          }
        }
      })
    )
    
  }

  /**
   * @param {vscode.Uri} workingUri Path being worked with
   * @param {string} getPath IFS or member path to fetch
   */
  getPathInfo(workingUri, getPath) {
    const config = instance.getConfig();

    /** @type {string} */
    let finishedPath = undefined;

    /** @type {string[]} */
    let memberPath = undefined;

    /** @type {"streamfile"|"member"|undefined} */
    let type = undefined;

    if (getPath.includes(`/`) || getPath.includes(`.`)) {
      type = `streamfile`;
      //Fetch IFS

      if (getPath.startsWith(`'`)) getPath = getPath.substring(1);
      if (getPath.endsWith(`'`)) getPath = getPath.substring(0, getPath.length - 1);

      if (getPath.startsWith(`/`)) {
        //Get from root
        finishedPath = getPath;
      } 
      else if (getPath.startsWith(`.`)) {
        finishedPath = path.posix.join(config.homeDirectory, getPath);
      } else {
        finishedPath = path.posix.join(path.posix.dirname(workingUri.path), getPath);
      }

    } else {
      //Fetch member
      const getLib = getPath.split(`/`);
      const getMember = getLib[getLib.length-1].split(`,`);
      const workingPath = workingUri.path.split(`/`);
      memberPath = [undefined, undefined, `QRPGLEREF`, undefined];

      if (workingPath.length === 4) { //ASP not included
        memberPath[1] = workingPath[1];
      } else {
        memberPath[0] = workingPath[1];
        memberPath[1] = workingPath[2];
      }

      switch (getMember.length) {
      case 1:
        memberPath[3] = getMember[0];
        break;
      case 2:
        memberPath[2] = getMember[0];
        memberPath[3] = getMember[1];
      }

      if (getLib.length === 2) {
        memberPath[1] = getLib[0];
      }

      finishedPath = memberPath.join(`/`);

      type = `member`;
    }

    return {type, memberPath, finishedPath};
  }

  /**
   * @param {vscode.Uri} workingUri Path being worked with
   * @param {string} getPath IFS or member path to fetch
   * @returns {Promise<string[]>}
   */
  async getContent(workingUri, getPath) {
    const contentApi = instance.getContent();

    let content;
    let lines = undefined;
    
    // /** @type {string} */
    // let finishedPath = undefined;

    // /** @type {string[]} */
    // let memberPath = undefined;

    // /** @type {"streamfile"|"member"|undefined} */
    // let type = undefined;

    let {type, memberPath, finishedPath} = this.getPathInfo(workingUri, getPath);

    try {
      switch (type) {
      case `member`:
        if (this.copyBooks[finishedPath]) {
          lines = this.copyBooks[finishedPath];
        } else {
          content = await contentApi.downloadMemberContent(memberPath[0], memberPath[1], memberPath[2], memberPath[3]);
          lines = content.replace(new RegExp(`\\\r`, `g`), ``).split(`\n`);
          this.copyBooks[finishedPath] = lines;
        }
        break;

      case `streamfile`:
        if (this.copyBooks[finishedPath]) {
          lines = this.copyBooks[finishedPath];
        } else {
          content = await contentApi.downloadStreamfile(finishedPath);
          lines = content.replace(new RegExp(`\\\r`, `g`), ``).split(`\n`);
          this.copyBooks[finishedPath] = lines;
        }
        break;
      }
    } catch (e) {
      lines = [];
    }

    return lines;
  }

  /**
   * @param {vscode.Uri} workingUri
   * @param {string} content 
   */
  async getDocs(workingUri, content) {
    let lines = content.replace(new RegExp(`\\\r`, `g`), ``).split(`\n`);
    let currentComments = [], currentExample = [], currentItem, currentSub;

    let parts, partsLower, pieces;

    this.variables = [];
    this.structs = [];
    this.procedures = [];

    //First loop is for copy/include statements
    for (let i = lines.length - 1; i >= 0; i--) {
      let line = lines[i].trim(); //Paths are case insensitive so it's okay
      if (line === ``) continue;

      pieces = line.split(` `).filter(piece => piece !== ``);

      if ([`/COPY`, `/INCLUDE`].includes(pieces[0].toUpperCase())) {
        lines.splice(i, 1, ...(await this.getContent(workingUri, pieces[1])));
      }
    }

    //Now the real work
    for (let line of lines) {
      line = line.trim();

      if (line === ``) continue;

      pieces = line.split(`;`);
      parts = pieces[0].toUpperCase().split(` `).filter(piece => piece !== ``);
      partsLower = pieces[0].split(` `).filter(piece => piece !== ``);

      switch (parts[0]) {
      case `DCL-S`:
        if (!parts.includes(`TEMPLATE`)) {
          currentItem = new Declaration(`variable`);
          currentItem.name = partsLower[1];
          currentItem.keywords = parts.slice(2);
          currentItem.comments = currentComments.join(` `);
          this.variables.push(currentItem);
          currentItem = undefined;
          currentComments = [];
          currentExample = [];
        }
        break;

      case `DCL-DS`:
        if (!parts.includes(`TEMPLATE`)) {
          currentItem = new Declaration(`struct`);
          currentItem.name = partsLower[1];
          currentItem.keywords = parts.slice(2);
          currentItem.comments = currentComments.join(` `);
          currentItem.example = currentExample;

          currentComments = [];
          currentExample = [];
        }
        break;

      case `END-DS`:
        if (currentItem) {
          this.structs.push(currentItem);
          currentItem = undefined;
        }
        break;
        
      case `DCL-PR`:
        if (parts.find(element => element.startsWith(`EXTPROC`)) || parts.find(element => element.startsWith(`EXTPGM`))) {
          if (!this.procedures.find(proc => proc.name.toUpperCase() === parts[1])) {
            currentItem = new Declaration(`procedure`);
            currentItem.name = partsLower[1];
            currentItem.keywords = parts.slice(2);
            currentItem.comments = currentComments.join(` `);
            currentItem.example = currentExample;

            currentComments = [];
            currentExample = [];
          }
        } else {
          console.log(`Procedures require EXTPROC or EXTPGM`);
        }
        break;

      case `DCL-PI`:
        if (!this.procedures.find(proc => proc.name.toUpperCase() === parts[1])) {
          currentItem = new Declaration(`procedure`);
          currentItem.name = partsLower[1];
          currentItem.keywords = parts.slice(2);
          currentItem.comments = currentComments.join(` `);
          currentItem.example = currentExample;

          currentComments = [];
          currentExample = [];
        }
        break;

      case `END-PR`:
      case `END-PI`:
        if (currentItem) {
          this.procedures.push(currentItem);
          currentItem = undefined;
        }
        break;

      default:
        if (line.startsWith(`//@`)) {
          currentComments.push(line.substring(3).trim());

        } else if (line.startsWith(`//-`)) {
          if (line.length >= 4) {
            currentExample.push(line.substring(4).trimEnd());
          } else if (line.length === 3) {
            currentExample.push(``);
          }

        } else if (line.startsWith(`//`)) {
          //Do nothing. Because it's a comment.

        } else {
          if (currentItem) {
            if (parts[0].startsWith(`DCL`))
              parts.slice(1);

            currentSub = new Declaration(`subitem`);
            currentSub.name = (parts[0] === `*N` ? `parm${currentItem.subItems.length+1}` : partsLower[0]) ;
            currentSub.keywords = parts.slice(1);
            currentSub.comments = currentComments.join(` `);

            currentItem.subItems.push(currentSub);
            currentSub = undefined;
            currentComments = [];
          }
        }
        break;
      }
    }
  }

  /**
   * 
   * @param {string} content 
   * @param {{indent?: number}} rules 
   */
  parseFreeFormatDocument(content, rules) {
    /** @type {string[]} */
    const lines = content.replace(new RegExp(`\\\r`, `g`), ``).split(`\n`);

    const indent = rules.indent || 2;

    let lineNumber = -1;

    /** @type {vscode.Diagnostic[]} */
    let diagnostics = [];

    /** @type {Number} */
    let expectedIndent = 0;
    let currentIndent = 0;

    /** @type {string[]} */
    let pieces;

    let continuedStatement = false, skipIndentCheck = false;

    for (let line of lines) {
      currentIndent = line.search(/\S/);
      line = line.trim().toUpperCase();
      lineNumber += 1;

      if (line.startsWith(`//`)) continue;

      if (currentIndent >= 0) {
        skipIndentCheck = false;

        if (continuedStatement) {
          skipIndentCheck = true;

          if (currentIndent < expectedIndent) {
            diagnostics.push(
              new vscode.Diagnostic(
                new vscode.Range(lineNumber, 0, lineNumber, currentIndent), 
                `Incorrect indentation. Expectedat least ${expectedIndent}, got ${currentIndent}`, 
                vscode.DiagnosticSeverity.Warning
              )
            );
          }
        }

        if (line.endsWith(`;`)) {
          line = line.substr(0, line.length-1);
          continuedStatement = false;

        } else {
          continuedStatement = true;
        }

        pieces = line.split(` `);


        if ([
          `ENDIF`, `ENDFOR`, `ENDDO`, `ELSE`, `ELSEIF`, `ON-ERROR`, `ENDMON`, `ENDSR`, `WHEN`, `OTHER`, `END-PROC`, `END-PI`, `END-PR`, `END-DS`
        ].includes(pieces[0])) {
          expectedIndent -= indent; 
        }

        //Special case for `ENDSL`
        if ([
          `ENDSL`
        ].includes(pieces[0])) {
          expectedIndent -= (indent*2); 
        }
          
        if (currentIndent !== expectedIndent && !skipIndentCheck) {
          diagnostics.push(
            new vscode.Diagnostic(
              new vscode.Range(lineNumber, 0, lineNumber, currentIndent), 
              `Incorrect indentation. Expected ${expectedIndent}, got ${currentIndent}`, 
              vscode.DiagnosticSeverity.Warning
            )
          );
        }

        if ([
          `IF`, `ELSE`, `FOR`, `FOR-EACH`, `DOW`, `DOU`, `MONITOR`, `ON-ERROR`, `BEGSR`, `WHEN`, `OTHER`, `DCL-PROC`, `DCL-PI`, `DCL-PR`, `DCL-DS`
        ].includes(pieces[0])) {
          if (pieces[0] == `DCL-DS` && line.includes(`LIKEDS`)) {
            //No change
          } 
          else if (pieces[0] == `DCL-PI` && line.includes(`END-PI`)) {
            //No change
          }
          else
            expectedIndent += indent; 
        }

        if ([
          `SELECT`
        ].includes(pieces[0])) {
          expectedIndent += (indent*2);
        }
          
      }
    }

    return diagnostics;
  }
}

class Declaration {
  /**
   * 
   * @param {"procedure"|"struct"|"subitem"|"variable"} type 
   */
  constructor(type) {
    this.type = `procedure`;
    this.name = ``;
    this.keywords = [];
    this.comments = ``;

    //Not used in subitem:
    /** @type {Declaration[]} */
    this.subItems = [];
    this.example = [];
  }
}