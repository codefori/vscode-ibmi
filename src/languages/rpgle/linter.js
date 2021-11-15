
const vscode = require(`vscode`);

const errorText = {
  'BlankStructNamesCheck': `Struct names cannot be blank (\`*N\`).`,
  'QualifiedCheck': `Struct names must be qualified (\`QUALIFIED\`).`,
  'PrototypeCheck': `Prototypes can only be defined with either \`EXT\`, \`EXTPGM\` or \`EXTPROC\``,
  'ForceOptionalParens': `Expressions must be surrounded by brackets.`,
  'NoOCCURS': `\`OCCURS\` is not allowed.`,
  'NoSELECTAll': `\`SELECT *\` is not allowed in Embedded SQL.`,
  'UselessOperationCheck': `Redundant operation codes (EVAL, CALLP) not allowed.`,
  'UppercaseConstants': `Constants must be in uppercase.`,
}

module.exports = class Linter {
  static getErrorText(error) {
    return errorText[error];
  }

  /**
   * @param {string} content 
   * @param {{
   *  indent?: number
   *  BlankStructNamesCheck?: boolean,
   *  QualifiedCheck?: boolean,
   *  PrototypeCheck?: boolean,
   *  ForceOptionalParens?: boolean,
   *  NoOCCURS?: boolean,
   *  NoSELECTAll?: boolean,
   *  UselessOperationCheck?: boolean,
   *  UppercaseConstants?: boolean
   * }} rules 
   */
  static getErrors(content, rules) {
    /** @type {string[]} */
    const lines = content.replace(new RegExp(`\\\r`, `g`), ``).split(`\n`);

    const indent = rules.indent || 2;

    let lineNumber = -1;

    /** @type {{line: number, expectedIndent: number, currentIndent: number}[]} */
    let indentErrors = [];

    /** @type {{range: vscode.Range, type: "BlankStructNamesCheck"|"QualifiedCheck"|"PrototypeCheck"|"ForceOptionalParens"|"NoOCCURS"|"NoSELECTAll"|"UselessOperationCheck"|"UppercaseConstants"}[]} */
    let errors = [];

    /** @type {Number} */
    let expectedIndent = 0;
    let currentIndent = 0;

    /** @type {string[]} */
    let pieces;

    let continuedStatement = false, skipIndentCheck = false;

    let currentStatement = ``, opcode;

    /** @type {vscode.Position} */
    let statementStart;
    /** @type {vscode.Position} */
    let statementEnd;

    for (let currentLine of lines) {
      currentIndent = currentLine.search(/\S/);
      let line = currentLine.trim();

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
          const currentStatementUpper = currentStatement.toUpperCase();
          pieces = currentStatement.split(` `);

          if (pieces.length > 0) {
            opcode = pieces[0].toUpperCase();

            switch (opcode) {
            case `DCL-C`:
              if (rules.UppercaseConstants) {
                if (pieces[1] !== pieces[1].toUpperCase()) {
                  errors.push({
                    range: new vscode.Range(lineNumber, 6, lineNumber, 6 + pieces[1].length),
                    type: `UppercaseConstants`
                  });
                }
              }
              break;

            case `IF`:
            case `ELSEIF`:
            case `WHEN`:
            case `DOW`:
            case `DOU`:
              if (rules.ForceOptionalParens) {
                if (pieces[1].includes(`(`) && pieces[pieces.length-1].includes(`)`)) {
                // Looking good
                } else {
                  statementStart = new vscode.Position(statementStart.line, statementStart.character + opcode.length + 1);

                  errors.push({
                    range: new vscode.Range(statementStart, statementEnd),
                    type: `ForceOptionalParens`
                  });
                }
              }
              break;

            case `DCL-PR`:
              if (rules.PrototypeCheck) {
              // Unneeded PR
                if (!currentStatementUpper.includes(` EXT`)) {
                  errors.push({
                    range: new vscode.Range(statementStart, statementEnd),
                    type: `PrototypeCheck`
                  });
                }
              }
              break;

            case `DCL-DS`:
              if (rules.NoOCCURS) {
                if (currentStatementUpper.includes(` OCCURS`)) {
                  errors.push({
                    range: new vscode.Range(statementStart, statementEnd),
                    type: `NoOCCURS`
                  });
                }
              }

              if (rules.QualifiedCheck) {
                if (!currentStatementUpper.includes(`QUALIFIED`)) {
                  errors.push({
                    range: new vscode.Range(statementStart, statementEnd),
                    type: `QualifiedCheck`
                  });
                }
              }

              if (rules.BlankStructNamesCheck) {
                if (pieces[1] === `*N`) {
                  errors.push({
                    range: new vscode.Range(statementStart, statementEnd),
                    type: `BlankStructNamesCheck`
                  });
                }
              }
              break;

            case `EXEC`:
              if (rules.NoSELECTAll) {
                if (currentStatementUpper.includes(`SELECT *`)) {
                  errors.push({
                    range: new vscode.Range(statementStart, statementEnd),
                    type: `NoSELECTAll`
                  });
                }
              }
              break;

            case `EVAL`:
            case `CALLP`:
              if (rules.UselessOperationCheck) {
                statementEnd = new vscode.Position(statementEnd.line, statementStart.character + opcode.length + 1);
                errors.push({
                  range: new vscode.Range(statementStart, statementEnd),
                  type: `UselessOperationCheck`
                });
                break;
              }
            }
          }

          currentStatement = ``;
        }

        pieces = line.split(` `);
        opcode = pieces[0].toUpperCase();

        if ([
          `ENDIF`, `ENDFOR`, `ENDDO`, `ELSE`, `ELSEIF`, `ON-ERROR`, `ENDMON`, `ENDSR`, `WHEN`, `OTHER`, `END-PROC`, `END-PI`, `END-PR`, `END-DS`
        ].includes(opcode)) {
          expectedIndent -= indent; 
        }

        //Special case for `ENDSL`
        if ([
          `ENDSL`
        ].includes(opcode)) {
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
        ].includes(opcode)) {
          if (opcode == `DCL-DS` && (line.includes(`LIKEDS`) || line.includes(`END-DS`))) {
            //No change
          } 
          else if (opcode == `DCL-PI` && line.includes(`END-PI`)) {
            //No change
          }
          else if (opcode == `SELECT`) {
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