
const vscode = require(`vscode`);

const Cache = require(`./models/cache`);
const Statement = require(`./statement`);

const errorText = {
  'BlankStructNamesCheck': `Struct names cannot be blank (\`*N\`).`,
  'QualifiedCheck': `Struct names must be qualified (\`QUALIFIED\`).`,
  'PrototypeCheck': `Prototypes can only be defined with either \`EXT\`, \`EXTPGM\` or \`EXTPROC\``,
  'ForceOptionalParens': `Expressions must be surrounded by brackets.`,
  'NoOCCURS': `\`OCCURS\` is not allowed.`,
  'NoSELECTAll': `\`SELECT *\` is not allowed in Embedded SQL.`,
  'UselessOperationCheck': `Redundant operation codes (EVAL, CALLP) not allowed.`,
  'UppercaseConstants': `Constants must be in uppercase.`,
  'SpecificCasing': `Does not match required case.`,
  'InvalidDeclareNumber': `Variable names cannot start with a number`,
  'IncorrectVariableCase': `Variable name casing does not match definition.`,
  'RequiresParameter': `Procedure calls require brackets.`,
  'RequiresProcedureDescription': `Proceudres require a title and description.`,
}

const oneLineTriggers = {
  'DCL-DS': [`LIKEDS`, `LIKEREC`, `END-DS`],
  'DCL-PI': [`END-PI`],
}

module.exports = class Linter {
  static getErrorText(error) {
    return errorText[error];
  }

  /**
   * @param {string} content 
   * @param {{
   *  indent?: number,
   *  BlankStructNamesCheck?: boolean,
   *  QualifiedCheck?: boolean,
   *  PrototypeCheck?: boolean,
   *  ForceOptionalParens?: boolean,
   *  NoOCCURS?: boolean,
   *  NoSELECTAll?: boolean,
   *  UselessOperationCheck?: boolean,
   *  UppercaseConstants?: boolean,
   *  IncorrectVariableCase?: boolean,
   *  RequiresParameter?: boolean,
   *  SpecificCasing?: {operation: string, expected: string}[],
   * }} rules 
   * @param {Cache|null} [definitions]
   */
  static getErrors(content, rules, definitions) {
    /** @type {string[]} */
    const lines = content.replace(new RegExp(`\\\r`, `g`), ``).split(`\n`);

    const indent = rules.indent || 2;

    let definedNames = [];

    if (definitions) {
      definedNames = [
        ...definitions.constants.map(def => def.name), 
        ...definitions.variables.map(def => def.name), 
        ...definitions.procedures.map(def => def.name), 
        ...definitions.subroutines.map(def => def.name), 
        ...definitions.structs.map(def => def.name)
      ];
    }

    let lineNumber = -1;

    /** @type {{line: number, expectedIndent: number, currentIndent: number}[]} */
    let indentErrors = [];

    /** @type {{
     *  range: vscode.Range, 
     *  offset?: {position: number, length: number}
     *  type: "BlankStructNamesCheck"|"QualifiedCheck"|"PrototypeCheck"|"ForceOptionalParens"|"NoOCCURS"|"NoSELECTAll"|"UselessOperationCheck"|"UppercaseConstants"|"SpecificCasing"|"InvalidDeclareNumber"|"IncorrectVariableCase"|"RequiresParameter"|"RequiresProcedureDescription", 
     *  newValue?: string}[]
     * } */
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
      let line = currentLine;

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
          currentStatement += line + ` `;
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

          currentStatement += line + ` `;
        }

        const upperLine = line.trim().toUpperCase();

        // Generally ignore comments and directives.
        if (upperLine.trimStart().startsWith(`/`)) {
          currentStatement = ``;
        }

        // Ignore free directive.
        if (upperLine === `**FREE`) {
          currentStatement = ``;
          continuedStatement = false;
        }

        // Linter checking
        if (continuedStatement === false && currentStatement.length > 0) {
          const currentStatementUpper = currentStatement.toUpperCase();
          currentStatement = currentStatement.trim();

          const statement = Statement.parseStatement(currentStatement);
          let value;

          if (statement.length >= 2) {
            switch (statement[0].type) {
            case `declare`:
              value = statement[1].value;

              if (value.match(/^\d/)) {
                errors.push({
                  range: new vscode.Range(
                    statementStart,
                    statementEnd
                  ),
                  offset: {position: statement[1].position, length: statement[1].position + value.length},
                  type: `InvalidDeclareNumber`
                });
              }

              switch (statement[0].value.toUpperCase()) {
              case `DCL-PROC`:
                value = statement[1].value;
                const procDef = definitions.procedures.find(def => def.name.toUpperCase() === value.toUpperCase());
                if (procDef) {
                  if (!procDef.description) {
                    errors.push({
                      range: new vscode.Range(
                        statementStart,
                        statementEnd
                      ),
                      type: `RequiresProcedureDescription`
                    });
                  }
                }
                break;
              case `DCL-C`:
                if (rules.UppercaseConstants) {
                  if (value !== value.toUpperCase()) {
                    errors.push({
                      range: new vscode.Range(
                        statementStart,
                        statementEnd
                      ),
                      offset: {position: statement[1].position, length: statement[1].position + value.length},
                      type: `UppercaseConstants`,
                      newValue: value.toUpperCase()
                    });
                  }
                }
                break;

              case `DCL-PR`:
                if (rules.PrototypeCheck) {
                  // Unneeded PR
                  if (!statement.some(part => part.value && part.value.toUpperCase().startsWith(`EXT`))) {
                    errors.push({
                      range: new vscode.Range(statementStart, statementEnd),
                      type: `PrototypeCheck`
                    });
                  }
                }
                break;

              case `DCL-DS`:
                if (rules.NoOCCURS) {
                  if (statement.some(part => part.value && part.value.toUpperCase() === `OCCURS`)) {
                    errors.push({
                      range: new vscode.Range(statementStart, statementEnd),
                      type: `NoOCCURS`
                    });
                  }
                }
    
                if (rules.QualifiedCheck) {
                  if (!statement.some(part => part.value && part.value.toUpperCase() === `QUALIFIED`)) {
                    errors.push({
                      range: new vscode.Range(statementStart, statementEnd),
                      type: `QualifiedCheck`
                    });
                  }
                }
    
                if (rules.BlankStructNamesCheck) {
                  if (statement.some(part => part.type === `special`)) {
                    errors.push({
                      range: new vscode.Range(statementStart, statementEnd),
                      type: `BlankStructNamesCheck`
                    });
                  }
                }
                break;
              }

              break;

            case `word`:
              value = statement[0].value.toUpperCase();

              if (rules.SpecificCasing) {
                const caseRule = rules.SpecificCasing.find(rule => rule.operation.toUpperCase() === value);
                if (caseRule) {
                  if (statement[0].value !== caseRule.expected) {
                    errors.push({
                      range: new vscode.Range(
                        statementStart,
                        statementEnd
                      ),
                      offset: {position: statement[0].position, length: statement[0].position + value.length},
                      type: `SpecificCasing`,
                      newValue: caseRule.expected
                    });
                  }
                }
              }

              switch (value.toUpperCase()) {
              case `EVAL`:
              case `CALLP`:
                if (rules.UselessOperationCheck) {
                  errors.push({
                    range: new vscode.Range(
                      statementStart,
                      statementEnd
                    ),
                    offset: {position: statement[0].position, length: statement[0].position + value.length},
                    type: `UselessOperationCheck`
                  });
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

              case `IF`:
              case `ELSEIF`:
              case `WHEN`:
              case `DOW`:
              case `DOU`:
                if (rules.ForceOptionalParens) {
                  if (statement[1].type !== `block`) {
                    const lastStatement = statement[statement.length-1];
                    errors.push({
                      range: new vscode.Range(
                        statementStart, 
                        statementEnd
                      ),
                      offset: {position: statement[1].position, length: lastStatement.position + lastStatement.value.length},
                      type: `ForceOptionalParens`
                    });
                  }
                }
                break;
              }
              break;
            }
          }
          
          if (rules.IncorrectVariableCase || rules.RequiresParameter) {
            let part;

            if (statement.length > 0 && statement[0].type !== `declare`) {

              for (let i = 0; i < statement.length; i++) {
                part = statement[i];

                if (part.type === `word` && part.value) {
                  const upperName = part.value.toUpperCase();
              
                  if (rules.IncorrectVariableCase) {
                    // Check the casing of the reference matches the definition
                    const definedName = definedNames.find(defName => defName.toUpperCase() === upperName);
                    if (definedName && definedName !== part.value) {
                      errors.push({
                        range: new vscode.Range(
                          statementStart,
                          statementEnd
                        ),
                        offset: {position: part.position, length: part.position + part.value.length},
                        type: `IncorrectVariableCase`,
                        newValue: definedName
                      });
                    }
                  }

                  if (rules.RequiresParameter) {
                    // Check the procedure reference has a block following it
                    const definedProcedure = definitions.procedures.find(proc => proc.name.toUpperCase() === upperName);
                    if (definedProcedure) {
                      let requiresBlock = false;
                      if (statement.length <= i+1) {
                        requiresBlock = true;
                      } else if (statement[i+1].type !== `block`) {
                        requiresBlock = true;
                      }

                      if (requiresBlock) {
                        errors.push({
                          range: new vscode.Range(
                            statementStart,
                            statementEnd
                          ),
                          offset: {position: part.position, length: part.position + part.value.length},
                          type: `RequiresParameter`,
                        });
                      }
                    }
                  }
                }
              }
            }
          }

          currentStatement = ``;
        }

        // Next, check for indentation errors

        pieces = upperLine.split(` `).filter(piece => piece !== ``);
        opcode = pieces[0];

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
          if (opcode == `DCL-DS` && oneLineTriggers[opcode].some(trigger => upperLine.includes(trigger))) {
            //No change
          } 
          else if (opcode == `DCL-PI` && oneLineTriggers[opcode].some(trigger => upperLine.includes(trigger))) {
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