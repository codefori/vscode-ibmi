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

const editedTodayColor = new vscode.ThemeColor(`gitDecoration.modifiedResourceForeground`);
const seachGutterColor = new vscode.ThemeColor(`gitDecoration.addedResourceForeground`);

const gutterDecor = vscode.window.createTextEditorDecorationType({
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

const lineDecor = vscode.window.createTextEditorDecorationType({
  backgroundColor: new vscode.ThemeColor(`diffEditor.insertedTextBackground`),
  rangeBehavior: vscode.DecorationRangeBehavior.OpenOpen,
});

const SD_BASE = `$(history) Date Search`;
const SD_ACTIVE = `$(history) Since `;

/** @type {number|undefined} */
let highlightSince;
/** @type {number|undefined} */
let highlightBefore;

module.exports = class Handler {
  static begin(context) {
    const config = instance.getConfig();

    const lengthDiagnostics = vscode.languages.createDiagnosticCollection(`Record Lengths`);

    let lineEditedBefore;
    let lengthTimeout;

    const sourceDateSearchBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right);
    sourceDateSearchBarItem.command = {
      command: `code-for-ibmi.member.newDateSearch`,
      title: `Change Search Date Filter`,
    };
    sourceDateSearchBarItem.tooltip = `Search lines by source date`;
    sourceDateSearchBarItem.text = SD_BASE;
    sourceDateSearchBarItem.show();

    context.subscriptions.push(sourceDateSearchBarItem);

    /** 
     * Provides the quick fixes on errors.
     */
    context.subscriptions.push(
      vscode.workspace.onDidChangeTextDocument(event => {
        const document = event.document;
        if (document && document.uri.scheme === `member`) {
          const connection = instance.getConnection();
          clearTimeout(lengthTimeout);

          lengthTimeout = setTimeout(() => {
            const path = connection.parserMemberPath(document.uri.path);
            const lib = path.library, file = path.file, fullName = path.member;

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
      vscode.commands.registerCommand(`code-for-ibmi.toggleSourceDateGutter`, async () => {
        const currentValue = config.sourceDateGutter;
        await config.set(`sourceDateGutter`, !currentValue);

        const editor = vscode.window.activeTextEditor;
        if (editor) {
          this.refreshGutter(editor.document);
        }
      }),

      vscode.commands.registerCommand(`code-for-ibmi.member.clearDateSearch`, () => {
        sourceDateSearchBarItem.text = SD_BASE;
        highlightSince = undefined;
        highlightBefore = undefined;

        const editor = vscode.window.activeTextEditor;
        if (editor) {
          this.refreshGutter(editor.document);
        }
      }),

      vscode.commands.registerCommand(`code-for-ibmi.member.newDateSearch`, () => {
        vscode.window.showInputBox({
          value: this.currentStamp(),
          prompt: `Show everything on or after date provided`,
          title: `Source Date search`,
          ignoreFocusOut: true,
          validateInput: (input) => {
            const ranges = input.split(`-`);

            if (ranges.length > 2) {
              return `Up to two ranges allowed. (FROM-TO, both YYMMDD)`;
            }

            for (let date of ranges) {
              if (date.length !== 6) {
                return `Source date ${date} must be length of 6. (YYMMDD)`;
              }

              if (Number.isNaN(Number.parseFloat(date))) {
                return `Value ${date} is not a valid number.`;
              }
            }
          }
        }).then(async value => {
          if (value) {
            sourceDateSearchBarItem.text = SD_ACTIVE + value;
            const dates = value.split(`-`);
            highlightSince = Number(dates[0]);
            highlightBefore = dates[1] !== undefined ? Number(dates[1]) : undefined;
          } else {
            sourceDateSearchBarItem.text = SD_BASE;
            highlightSince = undefined;
            highlightBefore = undefined;
          }

          const editor = vscode.window.activeTextEditor;
          if (editor) {
            await config.set(`sourceDateGutter`, true);
            this.refreshGutter(editor.document);
          }
        })
      }),

      vscode.workspace.onDidChangeTextDocument(event => {
        const document = event.document;

        if (document.isDirty) {
          const currentEditingLine = 
            event.contentChanges.length === 1 && 
            event.contentChanges[0].range.isSingleLine && 
            !event.contentChanges[0].text.includes(`\n`) && 
            event.contentChanges[0].range.start.character === 0 
              ? event.contentChanges[0].range.start.line : undefined;
          
          if (lineEditedBefore === undefined || currentEditingLine !== lineEditedBefore) {
            this.refreshGutter(document);
          }

          lineEditedBefore = currentEditingLine;
        }
      }),

      vscode.window.onDidChangeActiveTextEditor(editor => {
        if (editor) {
          this.refreshGutter(editor.document);
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
   * @param {vscode.TextDocument} document 
   */
  static refreshGutter(document) {
    if (document.uri.scheme === `member`) {
      const connection = instance.getConnection();
      const config = instance.getConfig();

      if (config.sourceDateGutter) {
        const path = document.uri.path;
        const {library, file, member} = connection.parserMemberPath(path);

        const alias = `${library}_${file}_${member.replace(/\./g, `_`)}`;

        const sourceDates = baseDates[alias];

        if (sourceDates) {
          const dates = document.isDirty ? this.calcNewSourceDates(alias, document.getText()) : sourceDates;

          /** @type {vscode.DecorationOptions[]} */
          let lineGutters = [];

          /** @type {vscode.DecorationOptions[]} */
          let changedLined = [];

          const currentDate = this.currentStamp();
          const currentDateNumber = Number(currentDate);

          const markdownString = [
            `[Show changes since last local save](command:workbench.files.action.compareWithSaved)`, 
            `---`,
            `${highlightSince ? `[Clear date search](command:code-for-ibmi.member.clearDateSearch) | ` : ``}[New date search](command:code-for-ibmi.member.newDateSearch)`
          ];

          if (highlightSince) markdownString.push(`---`, `Changes since ${String(highlightSince) == currentDate ? `today` : highlightSince} highlighted`)

          const hoverMessage = new vscode.MarkdownString(markdownString.join(`\n\n`));
          hoverMessage.isTrusted = true;

          // Due to the way source dates are stored, we're doing some magic.
          // Dates are stored in zoned/character columns, which means 26th 
          // August 2022 is 220826, 4th May 1997 means 970504.

          // We support the ability to search and highlight dates after a
          // certain date. The issue with these dates value when converted
          // to numeric is that 970504 is more than 220826, even though
          // 220826 is after 970504 in terms of dates.

          // To get around this, if the line date or search date is less than
          // or equal to the date of today, we add 1000000 (one million).
          // 220826 + 1000000 = 1220826, which is more than 970504.

          const currentHighlightSince = highlightSince ? highlightSince + (highlightSince <= currentDateNumber ? 1000000 : 0) : undefined;
          const currentHighlightBefore = highlightBefore ? highlightBefore + (highlightBefore <= currentDateNumber ? 1000000 : 0) : undefined;

          for (let cLine = 0; cLine < dates.length && cLine < document.lineCount; cLine++) {
            let highlightForSearch = false;

            // Add 1000000 to date if less than today.
            let lineDateNumber = Number(dates[cLine]);
            if (lineDateNumber <= currentDateNumber && lineDateNumber !== 0) {
              lineDateNumber += 1000000;
            }

            if (currentHighlightSince && currentHighlightBefore)
              highlightForSearch = lineDateNumber >= currentHighlightSince && lineDateNumber <= currentHighlightBefore;
            else if (currentHighlightSince)
              highlightForSearch = lineDateNumber >= currentHighlightSince;
            else if (currentHighlightBefore)
              highlightForSearch = lineDateNumber <= currentHighlightBefore;

            lineGutters.push({
              hoverMessage,
              range: new vscode.Range(
                new vscode.Position(cLine, 0),
                new vscode.Position(cLine, 0)
              ),
              renderOptions: {
                before: {
                  contentText: dates[cLine],
                  color: highlightForSearch ? seachGutterColor : (currentDate === dates[cLine] ? editedTodayColor : undefined)
                },
              },
            });

            if (highlightForSearch) {
              changedLined.push({
                range: document.lineAt(cLine).range
              })
            }
          }

          const activeEditor = vscode.window.activeTextEditor;
          if (activeEditor.document.uri.fsPath === document.uri.fsPath) {
            activeEditor.setDecorations(gutterDecor, lineGutters);
            activeEditor.setDecorations(lineDecor, changedLined);
          }
        }
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


    console.log(diff.changes);
    diff.changes.forEach(change => {
      let startIndex = change.modifiedStartLineNumber - 1;
      let removedLines = 0;
      let changedLines = 0;

      if (change.originalEndLineNumber === 0) {
        // New line was added 
        // at index (modifiedStartLineNumber-1)
        removedLines = 0;
        changedLines = change.modifiedEndLineNumber - change.modifiedStartLineNumber + 1;
      } else
      if (change.modifiedEndLineNumber === 0) {
        // Line removed
        // at index (modifiedStartIndex-1)
        // for lines (originalEndLineNumber - originalStartLineNumber)
        startIndex = change.originalStartLineNumber - 1;
        removedLines = change.originalEndLineNumber - change.originalStartLineNumber + 1
      } else
      if (change.modifiedEndLineNumber >= change.modifiedStartLineNumber) {
        // Lines added
        // at index (change.modifiedStartLineNumber-1)
        // on lines (modifiedEndLineNumber - modifiedStartLineNumber + 1) 
        removedLines = 1;
        changedLines = change.modifiedEndLineNumber - change.modifiedStartLineNumber + 1;
      }

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