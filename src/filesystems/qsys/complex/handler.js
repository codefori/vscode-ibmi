const vscode = require(`vscode`);
const instance = require(`../../../Instance`);

let allSourceDates = require(`./sourceDates`);

const annotationDecoration = vscode.window.createTextEditorDecorationType({
  after: {
    margin: `0 0 0 3em`,
    textDecoration: `none`,
  },
  rangeBehavior: vscode.DecorationRangeBehavior.ClosedOpen,
});

module.exports = class {
  static begin(context) {
    const config = instance.getConfig();

    let sourceDateBarItem;
    if (config.sourceDateLocation === `bar`) {
      sourceDateBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right);
      sourceDateBarItem.text = `$(clock)`;
      sourceDateBarItem.show();
    }

    context.subscriptions.push(
      vscode.workspace.onDidChangeTextDocument(event => {
        if (event.document.uri.scheme === `member`) {
          const path = event.document.uri.path.split(`/`);
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

          fullName = fullName.substr(0, fullName.lastIndexOf(`.`));
          const alias = `${lib}_${file}_${fullName.replace(/\./g, `_`)}`;

          let sourceDates = allSourceDates[alias];
          if (sourceDates) {
            for (const change of event.contentChanges) {
              
              const startLineNumber = change.range.start.line;
              const endLineNumber = change.range.end.line;

              const startChar = change.range.start.character;
              const endChar = change.range.end.character;
              const line = startLineNumber;

              const currentDate = this.currentStamp();
  
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
                  startLineNumber === endLineNumber && startChar < endChar
                ) {
                  //backspace
                  sourceDates[line] = currentDate;
                  return;
                }
              } else {
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

    if (config.sourceDateLocation !== `none`) {
      context.subscriptions.push(
        vscode.window.onDidChangeTextEditorSelection(event => {
          if (event.textEditor.document.uri.scheme === `member`) {
            const editor = event.textEditor;

            const line = event.selections[0].active.line;

            const path = event.textEditor.document.uri.path.split(`/`);
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

            fullName = fullName.substr(0, fullName.lastIndexOf(`.`));
            const alias = `${lib}_${file}_${fullName.replace(/\./g, `_`)}`;

            const sourceDates = allSourceDates[alias];

            if (sourceDates && sourceDates[line]) {

              switch (config.sourceDateLocation) {
              case `bar`:
                sourceDateBarItem.text = `$(calendar) ${sourceDates[line]}`;
                break;
                
              case `inline`:
                /** @type {vscode.DecorationOptions[]} */
                let annotations = [];

                annotations.push({
                  range: new vscode.Range(
                    new vscode.Position(line, Number.MAX_SAFE_INTEGER),
                    new vscode.Position(line, Number.MAX_SAFE_INTEGER)
                  ),
                  renderOptions: {
                    after: {
                      color: new vscode.ThemeColor(`editorLineNumber.foreground`),
                      contentText: sourceDates[line],
                      fontWeight: `normal`,
                      fontStyle: `normal`,
                      // Pull the decoration out of the document flow if we want to be scrollable
                      textDecoration: `position: absolute;`,
                    },
                  },
                });


                editor.setDecorations(annotationDecoration, annotations);
                break;
              }
            } else {
              if (sourceDateBarItem) {
                sourceDateBarItem.text = `$(clock)`;
              }
            }

          } else {
            if (sourceDateBarItem) {
              sourceDateBarItem.text = `$(clock)`;
            }
          }
        })
      );
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