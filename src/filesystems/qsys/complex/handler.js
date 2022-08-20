const vscode = require(`vscode`);
const { DiffComputer } = require(`vscode-diff`)

const instance = require(`../../../Instance`);

const diffOptions = {
  shouldPostProcessCharChanges: false,
  shouldIgnoreTrimWhitespace: true,
  shouldMakePrettyDiff: false,
  shouldComputeCharChanges: true,
  maxComputationTime: 1000
}

let { baseDates, recordLengths, baseSource } = require(`./data`);

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

module.exports = class Handler {
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
          const connection = instance.getConnection();
          clearTimeout(editTimeout);

          editTimeout = setTimeout(() => {
            const path = connection.parserMemberPath(document.uri.path);
            let lib = path.library, file = path.file, fullName = path.member;

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
      }),

      vscode.workspace.onDidCloseTextDocument(document => {
        // Clean up things when a member is closed
        if (document.uri.scheme === `member` && document.isClosed) {
          const connection = instance.getConnection();
          const {library, file, member} = connection.parserMemberPath(document.uri.path);
    
          const alias = `${library}_${file}_${member.replace(/\./g, `_`)}`;
          
          baseDates[alias] = undefined;
          baseSource[alias] = undefined;
        }
      })
    );
  }

  /**
   * @param {vscode.TextEditor} editor 
   */
  static refreshGutter(editor) {
    if (editor.document.uri.scheme === `member`) {
      const connection = instance.getConnection();
      const path = editor.document.uri.path;
      const {library, file, member} = connection.parserMemberPath(path);

      const alias = `${library}_${file}_${member.replace(/\./g, `_`)}`;

      const sourceDates = baseDates[alias];

      if (sourceDates) {
        const document = editor.document;
        const dates = document.isDirty ? this.calcNewSourceDates(alias, document.getText()) : sourceDates;

        /** @type {vscode.DecorationOptions[]} */
        let annotations = [];

        const currentDate = this.currentStamp();

        for (let cLine = 0; cLine < dates.length && cLine < document.lineCount; cLine++) {
          annotations.push({
            range: new vscode.Range(
              new vscode.Position(cLine, 0),
              new vscode.Position(cLine, 0)
            ),
            renderOptions: {
              before: {
                contentText: dates[cLine],
                color: currentDate === dates[cLine] ? highlightedColor : undefined
              },
            },
          });
        }

        editor.setDecorations(annotationDecoration, annotations);
      }
    }
  }

  /**
   * @param {string} alias 
   * @param {string} body 
   */
  static calcNewSourceDates(alias, body) {
    const newDates = baseDates[alias].slice();
    const oldSource = baseSource[alias];

    const diffComputer = new DiffComputer(oldSource.split(`\n`), body.split(`\n`), diffOptions);
    const diff = diffComputer.computeDiff();

    const currentDate = this.currentStamp();

    diff.changes.forEach(change => {
      const startIndex = change.modifiedStartLineNumber - 1;
      const removedLines = (change.modifiedEndLineNumber < change.modifiedStartLineNumber ? 1 : 0); 
      const changedLines = change.modifiedEndLineNumber >= change.modifiedStartLineNumber ? (change.modifiedEndLineNumber - change.modifiedStartLineNumber) + 1 : 0;
      newDates.splice(startIndex, removedLines, ...Array(changedLines).fill(currentDate));
    });

    return newDates;
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