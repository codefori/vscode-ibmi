
const vscode = require(`vscode`);

const errorText = {
  'BlankStructNamesCheck': `Struct names cannot be blank (\`*N\`).`,
  'QualifiedCheck': `Struct names must be qualified (\`QUALIFIED\`).`,
  'PrototypeCheck': `Prototypes can only be defined with either \`EXT\`, \`EXTPGM\` or \`EXTPROC\``,
  'ForceOptionalParens': `Expressions must be surrounded by brackets.`,
  'NoOCCURS': `\`OCCURS\` is not allowed.`,
  'NoSELECTAll': `\`SELECT *\` is not allowed in Embedded SQL.`,
  'UselessOperationCheck': `Redundant operation code.`,
}

module.exports = class Linter {
  static getErrorText(error) {
    return errorText[error];
  }

  /**
   * @param {string} content 
   * @param {{indent?: number}} rules 
   */
  static getErrors(content, rules) {
    /** @type {string[]} */
    const lines = content.replace(new RegExp(`\\\r`, `g`), ``).split(`\n`);

    const indent = rules.indent || 2;

    let lineNumber = -1;

    /** @type {{line: number, expectedIndent: number, currentIndent: number}[]} */
    let indentErrors = [];

    /** @type {{range: vscode.Range, type: "BlankStructNamesCheck"|"QualifiedCheck"|"PrototypeCheck"|"ForceOptionalParens"|"NoOCCURS"|"NoSELECTAll"|"UselessOperationCheck"}[]} */
    let errors = [];

    /** @type {Number} */
    let expectedIndent = 0;
    let currentIndent = 0;

    /** @type {string[]} */
    let pieces;

    let continuedStatement = false, skipIndentCheck = false;

    let currentStatement = ``;

    /** @type {vscode.Position} */
    let statementStart;
    /** @type {vscode.Position} */
    let statementEnd;

    for (let currentLine of lines) {
      currentIndent = currentLine.search(/\S/);
      let line = currentLine.trim().toUpperCase();

      lineNumber += 1;

      if (line.startsWith(`//`)) continue;

      if (currentIndent >= 0) {
        skipIndentCheck = false;

        if (continuedStatement) {
          skipIndentCheck = true;
          statementEnd = new vscode.Position(lineNumber, currentLine.length);

          if (currentIndent < expectedIndent) {
            indentErrors.push({
              line: lineNumber,
              expectedIndent,
              currentIndent
            });
          }
        } else {
          statementStart = new vscode.Position(lineNumber, currentIndent);
          statementEnd = new vscode.Position(lineNumber, currentLine.length);
        }

        if (line.endsWith(`;`)) {
          statementEnd = new vscode.Position(lineNumber, currentLine.length - 1);
          line = line.substr(0, line.length-1);
          currentStatement += line;
          continuedStatement = false;

        } else {

          const semiIndex = line.lastIndexOf(`;`);
          const commentIndex = line.lastIndexOf(`//`);

          if (commentIndex > semiIndex && semiIndex >= 0) {
            statementEnd = new vscode.Position(lineNumber, currentLine.lastIndexOf(`;`));
            line = line.substr(0, semiIndex);
          } else {
            continuedStatement = true;
          }

          currentStatement += line;
        }

        // Linter checking
        if (continuedStatement === false) {
          pieces = currentStatement.split(` `);

          if (pieces.length > 0) {
            const opcode = pieces[0].toUpperCase();

            switch (opcode) {
            case `IF`:
            case `ELSEIF`:
            case `WHEN`:
            case `DOW`:
            case `DOU`:
              if (pieces[1].includes(`(`) && pieces[pieces.length-1].includes(`)`)) {
                // Looking good
              } else {
                statementStart = new vscode.Position(statementStart.line, statementStart.character + opcode.length + 1);

                errors.push({
                  range: new vscode.Range(statementStart, statementEnd),
                  type: `ForceOptionalParens`
                });
              }
              break;

            case `DCL-PR`:
              // Unneeded PR
              if (!currentStatement.includes(` EXT`)) {
                errors.push({
                  range: new vscode.Range(statementStart, statementEnd),
                  type: `PrototypeCheck`
                });
              }
              break;

            case `DCL-DS`:
              if (currentStatement.includes(` OCCURS`)) {
                errors.push({
                  range: new vscode.Range(statementStart, statementEnd),
                  type: `NoOCCURS`
                });
              }

              if (!currentStatement.includes(`QUALIFIED`)) {
                errors.push({
                  range: new vscode.Range(statementStart, statementEnd),
                  type: `QualifiedCheck`
                });
              }

              if (pieces[1] === `*N`) {
                errors.push({
                  range: new vscode.Range(statementStart, statementEnd),
                  type: `BlankStructNamesCheck`
                });
              }
              break;

            case `EXEC`:
              if (currentStatement.includes(`SELECT *`)) {
                errors.push({
                  range: new vscode.Range(statementStart, statementEnd),
                  type: `NoSELECTAll`
                });
              }
              break;

            case `EVAL`:
            case `CALLP`:
              statementEnd = new vscode.Position(statementEnd.line, statementStart.character + opcode.length + 1);
              errors.push({
                range: new vscode.Range(statementStart, statementEnd),
                type: `UselessOperationCheck`
              });
              break;
            }
          }

          currentStatement = ``;
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
          indentErrors.push({
            line: lineNumber,
            expectedIndent,
            currentIndent
          });
        }

        if ([
          `IF`, `ELSE`, `ELSEIF`, `FOR`, `FOR-EACH`, `DOW`, `DOU`, `MONITOR`, `ON-ERROR`, `BEGSR`, `SELECT`, `WHEN`, `OTHER`, `DCL-PROC`, `DCL-PI`, `DCL-PR`, `DCL-DS`
        ].includes(pieces[0])) {
          if (pieces[0] == `DCL-DS` && (line.includes(`LIKEDS`) || line.includes(`END-DS`))) {
            //No change
          } 
          else if (pieces[0] == `DCL-PI` && line.includes(`END-PI`)) {
            //No change
          }
          else if (pieces[0] == `SELECT`) {
            if (skipIndentCheck === false) expectedIndent += (indent*2); 
          }
          else {
            expectedIndent += indent; 
          }
        }
          
      }
    }

    return {
      indentErrors,
      errors
    };
  }
}