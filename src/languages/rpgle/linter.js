
const path = require(`path`);
const vscode = require(`vscode`);

const instance = require(`../../Instance`);
const Configuration = require(`../../api/Configuration`);

module.exports = class RPGLinter {
  /**
   * @param {vscode.ExtensionContext} context
   */
  constructor(context) {
    this.linterDiagnostics = vscode.languages.createDiagnosticCollection(`Lint`);

    /** @type {{[path: string]: string[]}} */
    this.copyBooks = {};

    /** @type {{[path: string]: {subroutines, procedures, variables, structs}}} */
    this.parsedCache = {};

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

      vscode.commands.registerCommand(`code-for-ibmi.rpgleOpenInclude`, async => {
        if (Configuration.get(`rpgleContentAssistEnabled`)) {
          const editor = vscode.window.activeTextEditor;
          
          if (editor) {
            const document = editor.document;
            const position = editor.selection.active;
            if (document.languageId === `rpgle`) {
              const linePieces = document.lineAt(position.line).text.trim().split(` `);
              if ([`/COPY`, `/INCLUDE`].includes(linePieces[0].toUpperCase())) {
                const {finishedPath, type} = this.getPathInfo(document.uri, linePieces[1]);

                switch (type) {
                case `member`:
                  vscode.commands.executeCommand(`code-for-ibmi.openEditable`, `${finishedPath.substr(1)}.rpgle`);
                  break;

                case `streamfile`:
                  vscode.commands.executeCommand(`code-for-ibmi.openEditable`, finishedPath);
                  break;
                }
              }
            }
          }
        }
      }),

      vscode.languages.registerHoverProvider({language: `rpgle`}, {
        provideHover: async (document, position, token) => {
          if (Configuration.get(`rpgleContentAssistEnabled`)) {
            const text = document.getText();
            const doc = await this.getDocs(document.uri, text);
            const range = document.getWordRangeAtPosition(position);
            const word = document.getText(range).toUpperCase();

            const procedure = doc.procedures.find(proc => proc.name.toUpperCase() === word.toUpperCase());

            if (procedure) {
              let retrunValue = procedure.keywords.filter(keyword => keyword !== `EXTPROC`);
              if (retrunValue.length === 0) retrunValue = [`void`];

              const markdown = `\`\`\`vb\n${procedure.name}(\n  ${procedure.subItems.map(parm => `${parm.name}: ${parm.keywords.join(` `)}`).join(`,\n  `)}\n): ${retrunValue.join(` `)}\n\`\`\` \n` +
              `\n\n${procedure.comments !== `` ? `${procedure.comments}\n\n` : ``}` +
              procedure.subItems.map(parm => `*@param* \`${parm.name.replace(new RegExp(`\\*`, `g`), `\\*`)}\` ${parm.comments}`).join(`\n\n`) +
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

      vscode.languages.registerDocumentSymbolProvider({ language: `rpgle` }, 
        {
          provideDocumentSymbols: async (document, token) => {
            if (Configuration.get(`rpgleContentAssistEnabled`)) {
              const text = document.getText();
              if (text.startsWith(`**FREE`)) {
                const doc = await this.getDocs(document.uri, text);

                const currentPath = document.uri.path;

                /** @type vscode.SymbolInformation[] */
                let currentDefs = [
                  ...doc.procedures.filter(proc => proc.position && proc.position.path === currentPath),
                  ...doc.subroutines.filter(sub => sub.position && sub.position.path === currentPath),
                ].map(def => new vscode.SymbolInformation(
                  def.name,
                  vscode.SymbolKind.Function,
                  new vscode.Range(def.position.line, 0, def.position.line, 0),
                  document.uri
                ));

                return currentDefs;
              }
            }

            return [];
          }
        }),

      vscode.languages.registerCompletionItemProvider({language: `rpgle`}, {
        provideCompletionItems: async (document, position) => {
          if (Configuration.get(`rpgleContentAssistEnabled`)) {
            const text = document.getText();
            if (text.startsWith(`**FREE`)) {
              const doc = await this.getDocs(document.uri, text);

              /** @type vscode.CompletionItem[] */
              let items = [];
              let item;

              for (const procedure of doc.procedures) {
                item = new vscode.CompletionItem(`${procedure.name}`, vscode.CompletionItemKind.Function);
                item.insertText = new vscode.SnippetString(`${procedure.name}(${procedure.subItems.map((parm, index) => `\${${index+1}:${parm.name}}`).join(`:`)})\$0`)
                item.detail = procedure.keywords.join(` `);
                item.documentation = procedure.comments;
                items.push(item);
              }

              for (const subroutine of doc.subroutines) {
                item = new vscode.CompletionItem(`${subroutine.name}`, vscode.CompletionItemKind.Function);
                item.insertText = new vscode.SnippetString(`Exsr ${subroutine.name}\$0`);
                item.documentation = subroutine.comments;
                items.push(item);
              }

              return items;
            }
          }
        }
      }),

      vscode.workspace.onDidSaveTextDocument((event) => {
        if (Configuration.get(`rpgleContentAssistEnabled`)) {
          const {type, finishedPath} = this.getPathInfo(event.uri, path.basename(event.uri.path));
          const text = event.getText();

          if (this.copyBooks[finishedPath]) {
            //Update stored copy book
            const lines = text.replace(new RegExp(`\\\r`, `g`), ``).split(`\n`);
            this.copyBooks[finishedPath] = lines;
          }
          else if (event.languageId === `rpgle`) {
            //Else fetch new info from source being edited
            if (text.startsWith(`**FREE`)) {
              this.updateCopybookCache(event.uri, text);
            }
          }
          
        }
      }),

      vscode.workspace.onDidOpenTextDocument((event) => {
        if (event.languageId === `rpgle`) {
          if (Configuration.get(`rpgleContentAssistEnabled`)) {
            const text = event.getText();
            if (text.startsWith(`**FREE`)) {
              this.updateCopybookCache(event.uri, text);
            }
          }
        }
      })
    )
    
  }

  /**
   * @param {vscode.Uri} workingUri Path being worked with
   * @param {string} getPath IFS or member path to fetch (in the format of an RPGLE copybook)
   */
  getPathInfo(workingUri, getPath) {
    const config = instance.getConfig();

    /** @type {string} */
    let finishedPath = undefined;

    /** @type {string[]} */
    let memberPath = undefined;

    /** @type {"streamfile"|"member"|undefined} */
    let type = undefined;

    if (workingUri.scheme === `streamfile`) {
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
        memberPath[2] = workingPath[2];
      } else {
        memberPath[0] = workingPath[1];
        memberPath[1] = workingPath[2];
        memberPath[2] = workingPath[3];
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

      if (memberPath[3].includes(`.`)) {
        memberPath[3] = memberPath[3].substr(0, memberPath[3].lastIndexOf(`.`));
      }

      finishedPath = memberPath.join(`/`);

      if (workingPath.length === 5) {
        finishedPath = `/${finishedPath}`;
      }

      type = `member`;
    }

    finishedPath = finishedPath.toUpperCase();

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
  async updateCopybookCache(workingUri, content) {
    this.parsedCache[workingUri.path] = undefined; //Clear parsed data

    let baseLines = content.replace(new RegExp(`\\\r`, `g`), ``).split(`\n`);

    //First loop is for copy/include statements
    for (let i = baseLines.length - 1; i >= 0; i--) {
      const line = baseLines[i].trim(); //Paths are case insensitive so it's okay
      if (line === ``) continue;

      const pieces = line.split(` `).filter(piece => piece !== ``);

      if ([`/COPY`, `/INCLUDE`].includes(pieces[0].toUpperCase())) {
        await this.getContent(workingUri, pieces[1]);
      }
    }
  }

  /**
   * @param {vscode.Uri} workingUri
   * @param {string} content 
   * @param {boolean} [withIncludes] To make sure include statements are parsed
   * @returns {Promise<{
   *   variables: Declaration[],
   *   structs: Declaration[],
   *   procedures: Declaration[],
   *   subroutines: Declaration[]
   * }>}
   */
  async getDocs(workingUri, content, withIncludes = true) {
    if (this.parsedCache[workingUri.path]) {
      return this.parsedCache[workingUri.path];
    };

    let files = {};
    let baseLines = content.replace(new RegExp(`\\\r`, `g`), ``).split(`\n`);
    let currentComments = [], currentExample = [], currentItem, currentSub;

    let lineNumber, parts, partsLower, pieces;

    const variables = [];
    const structs = [];
    const procedures = [];
    const subroutines = [];

    files[workingUri.path] = baseLines;

    if (withIncludes) {
    //First loop is for copy/include statements
      for (let i = baseLines.length - 1; i >= 0; i--) {
        let line = baseLines[i].trim(); //Paths are case insensitive so it's okay
        if (line === ``) continue;

        pieces = line.split(` `).filter(piece => piece !== ``);

        if ([`/COPY`, `/INCLUDE`].includes(pieces[0].toUpperCase())) {
          files[pieces[1]] = (await this.getContent(workingUri, pieces[1]));
        }
      }
    }

    //Now the real work
    for (const file in files) {
      lineNumber = -1;
      for (let line of files[file]) {
        lineNumber += 1;

        line = line.trim();

        if (line === ``) continue;

        pieces = line.split(`;`);
        parts = pieces[0].toUpperCase().split(` `).filter(piece => piece !== ``);
        partsLower = pieces[0].split(` `).filter(piece => piece !== ``);

        switch (parts[0]) {
        case `DCL-S`:
          if (currentItem === undefined) {
            if (!parts.includes(`TEMPLATE`)) {
              currentItem = new Declaration(`variable`);
              currentItem.name = partsLower[1];
              currentItem.keywords = parts.slice(2);
              currentItem.comments = currentComments.join(` `);
              variables.push(currentItem);
              currentItem = undefined;
              currentComments = [];
              currentExample = [];
            }
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
            structs.push(currentItem);
            currentItem = undefined;
          }
          break;
        
        case `DCL-PR`:
          if (!procedures.find(proc => proc.name.toUpperCase() === parts[1])) {
            currentItem = new Declaration(`procedure`);
            currentItem.name = partsLower[1];
            currentItem.keywords = parts.slice(2);
            currentItem.comments = currentComments.join(` `);
            currentItem.example = currentExample;

            currentItem.position = {
              path: file,
              line: lineNumber
            }

            currentItem.readParms = true;

            currentComments = [];
            currentExample = [];
          }
          break;

        
        case `DCL-PROC`:
          //We can overwrite it.. it might have been a PR before.
          currentItem = procedures.find(proc => proc.name.toUpperCase() === parts[1]) || new Declaration(`procedure`);

          currentItem.name = partsLower[1];
          currentItem.keywords = parts.slice(2);
          currentItem.comments = currentComments.join(` `);
          currentItem.example = currentExample;

          currentItem.position = {
            path: file,
            line: lineNumber
          }

          currentItem.readParms = false;

          currentComments = [];
          currentExample = [];
          break;

        case `DCL-PI`:
          if (currentItem) {
            currentItem.keywords = parts.slice(2);
            currentItem.readParms = true;

            currentComments = [];
            currentExample = [];
          }
          break;

        case `END-PROC`:
        case `END-PR`:
        case `END-PI`:
          if (currentItem) {
            procedures.push(currentItem);
            currentItem = undefined;
          }
          break;

        case `BEGSR`:
          if (!subroutines.find(sub => sub.name.toUpperCase() === parts[1])) {
            currentItem = new Declaration(`subroutine`);
            currentItem.name = partsLower[1];
            currentItem.comments = currentComments.join(` `);
            currentItem.example = currentExample;

            currentItem.position = {
              path: file,
              line: lineNumber
            }

            currentComments = [];
            currentExample = [];
          }
          break;
    
        case `ENDSR`:
          if (currentItem) {
            subroutines.push(currentItem);
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
            if (currentItem && currentItem.type === `procedure`) {
              if (currentItem.readParms) {
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
          }
          break;
        }
      
      }
    }

    const parsedData = {
      procedures,
      structs,
      subroutines,
      variables
    };

    this.parsedCache[workingUri.path] = parsedData

    return parsedData;
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
                `Incorrect indentation. Expected ${expectedIndent}, got ${currentIndent}`, 
                vscode.DiagnosticSeverity.Warning
              )
            );
          }
        }

        if (line.endsWith(`;`)) {
          line = line.substr(0, line.length-1);
          continuedStatement = false;

        } else {

          const semiIndex = line.lastIndexOf(`;`);
          const commentIndex = line.lastIndexOf(`//`);

          if (commentIndex > semiIndex) {
            line = line.substr(0, semiIndex);
          } else {
            continuedStatement = true;
          }
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
   * @param {"procedure"|"subroutine"|"struct"|"subitem"|"variable"} type 
   */
  constructor(type) {
    this.type = type;
    this.name = ``;
    this.keywords = [];
    this.comments = ``;

    /** @type {{path: string, line: number}} */
    this.position = undefined;

    //Not used in subitem:
    /** @type {Declaration[]} */
    this.subItems = [];
    this.example = [];

    //Only used in procedure
    this.readParms = false;
  }
}