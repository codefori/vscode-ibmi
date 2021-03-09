
const vscode = require(`vscode`);

/** @type {vscode.DiagnosticCollection} */
let linterDiagnostics;

module.exports = class RPGLinter {
  /**
   * @param {vscode.ExtensionContext} context
   */
  constructor(context) {
    if (!linterDiagnostics) {
      linterDiagnostics = vscode.languages.createDiagnosticCollection(`Lint`);
    }

    context.subscriptions.push(
      linterDiagnostics,

      vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.document.languageId === `rpgle`) {
          const text = event.document.getText();
          if (text.startsWith(`**FREE`)) {
            linterDiagnostics.set(event.document.uri, RPGLinter.parseFreeFormatDocument(text, {
              indent: Number(vscode.window.activeTextEditor.options.tabSize)
            }));
          }
        }
      })
    )
    
  }

  /**
   * 
   * @param {string} content 
   * @param {{indent?: number}} rules 
   */
  static parseFreeFormatDocument(content, rules) {
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