const vscode = require(`vscode`);
const Tools = require(`../../../api/Tools`);

const instance = require(`../../../Instance`);

let { allSourceDates, recordLengths } = require(`./data`);

const highlightedColor = new vscode.ThemeColor(`gitDecoration.modifiedResourceForeground`);

const annotationDecoration = vscode.window.createTextEditorDecorationType({
  before: {
    color: new vscode.ThemeColor(`editorLineNumber.foreground`),
    textDecoration: `none`,
    fontWeight: `normal`,
    fontStyle: `normal`,
    margin: `0 1em 0 0`,
    // Pull the decoration out of the document flow if we want to be scrollable
  },
  rangeBehavior: vscode.DecorationRangeBehavior.ClosedOpen,
});

module.exports = class {
  static begin(context) {
    const config = instance.getConfig();

    const lengthDiagnostics = vscode.languages.createDiagnosticCollection(`Record Lengths`);

    let editTimeout;

    /** 
     * Provides the quick fixes on errors.
     */
    context.subscriptions.push(
      vscode.workspace.onDidChangeTextDocument(event => {
        const document = event.document;
        if (document && document.uri.scheme === `member`) {
          clearTimeout(editTimeout);

          editTimeout = setTimeout(() => {
            const path = document.uri.path.split(`/`);
            let lib, file, fullName;

            if (path.length === 4) {
              lib = path[1];
              file = path[2];
              fullName = path[3];
            } else {
              lib = path[2];
              file = path[3];
              fullName = path[4];
            }

            fullName = fullName.substring(0, fullName.lastIndexOf(`.`));
            const alias = `${lib}_${file}_${fullName.replace(/\./g, `_`)}`;
            const recordLength = recordLengths[alias];

            /** @type {vscode.Diagnostic[]} */
            const lengthDiags = [];

            if (recordLength) {
              for (let lineIndex = 0; lineIndex < document.lineCount; lineIndex++) {
                const lineLength = document.lineAt(lineIndex).text.length;
                if (lineLength > recordLength) {
                  const badRange = new vscode.Range(lineIndex, recordLength+1, lineIndex, lineLength);
                  const diagnostic = new vscode.Diagnostic(badRange, `Content past record length of ${recordLength}`, vscode.DiagnosticSeverity.Error);

                  lengthDiags.push(diagnostic);
                }
              }
            }

            lengthDiagnostics.set(document.uri, lengthDiags);
          }, 2000);
        }
        
      })
    );

    context.subscriptions.push(
      vscode.workspace.onDidChangeTextDocument(event => {
        if (event.document.uri.scheme === `member`) {
          const path = event.document.uri.path;
          const {library, file, member} = Tools.parserMemberPath(path);


          const alias = `${library}_${file}_${member.replace(/\./g, `_`)}`;

          let sourceDates = allSourceDates[alias];
          if (sourceDates) {
            for (const change of event.contentChanges) {
              
              const startLineNumber = change.range.start.line;
              const endLineNumber = change.range.end.line;

              const startChar = change.range.start.character;
              const endChar = change.range.end.character;
              const line = startLineNumber;

              const currentDate = this.currentStamp();
  
              const startNewLine = change.text[0] === `\n`;

              // Is a space
              if (change.text.trim() === ``) {
              // Removing a line
                if (startLineNumber < endLineNumber) {
                  const lineCount = endLineNumber - startLineNumber;
                  sourceDates.splice(line+1, lineCount);
                  return;

                } else if (
                  startLineNumber !== endLineNumber
                ) {
                  // Backspace within a line
                  sourceDates.splice(line, 0, currentDate);
                  return;
                } else if (
                  startLineNumber === endLineNumber
                ) {
                  //backspace
                  if (startNewLine === false) {
                    sourceDates[line] = currentDate;
                    return;
                  }
                }
              } else if (startNewLine === false) {
                sourceDates[line] = currentDate;
              }
  
              // Contains new lines
              if (change.text.indexOf(`\n`) !== -1) {
                const len = change.text.split(`\n`).length - 1;
  
                if (change.text[0] !== `\n`) {
                  sourceDates[line] = currentDate;
                }
  
                // Multiple newlines
                const newSourceDates = Array(len).fill(currentDate);
                sourceDates.splice(line+1, 0, ...newSourceDates);
              }
            }
          }
        }
      })
    );

    context.subscriptions.push(
      vscode.commands.registerCommand(`code-for-ibmi.toggleSourceDateGutter`, () => {
        const currentValue = config.sourceDateGutter;
        config.set(`sourceDateGutter`, !currentValue);
      }),

      vscode.window.onDidChangeTextEditorSelection(event => {
        if (config.sourceDateGutter) {
          const editor = event.textEditor;
          this.refreshGutter(editor);
        }
      }),

      vscode.window.onDidChangeActiveTextEditor(editor => {
        if (editor) {
          if (config.sourceDateGutter) {
            this.refreshGutter(editor);
          }
        }
      })
    );
  }

  /**
   * @param {vscode.TextEditor} editor 
   */
  static refreshGutter(editor) {
    if (editor.document.uri.scheme === `member`) {
      const path = editor.document.uri.path;
      const {library, file, member} = Tools.parserMemberPath(path);

      const alias = `${library}_${file}_${member.replace(/\./g, `_`)}`;

      const sourceDates = allSourceDates[alias];

      if (sourceDates) {

        /** @type {vscode.DecorationOptions[]} */
        let annotations = [];

        const currentDate = this.currentStamp();

        for (let cLine = 0; cLine < sourceDates.length && cLine < editor.document.lineCount; cLine++) {
          annotations.push({
            range: new vscode.Range(
              new vscode.Position(cLine, 0),
              new vscode.Position(cLine, 0)
            ),
            renderOptions: {
              before: {
                contentText: sourceDates[cLine],
                color: currentDate === sourceDates[cLine] ? highlightedColor : undefined
              },
            },
          });
        }

        editor.setDecorations(annotationDecoration, annotations);
      }
    }
  }


  /**
   * @returns {string} Stamp in format for source date
   */
  static currentStamp() {
    const today = new Date();
    const mm = today.getMonth() + 1; // getMonth() is zero-based
    const dd = today.getDate();
    const yy = String(today.getFullYear()).substring(2);
  
    return [yy, (mm > 9 ? `` : `0`) + mm, (dd > 9 ? `` : `0`) + dd].join(``);
  }
}