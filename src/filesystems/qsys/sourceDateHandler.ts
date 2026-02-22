import Crypto from "crypto";
import vscode from "vscode";
import { DiffComputer } from "vscode-diff";
import { instance } from "../../instantiate";

const editedTodayColor = new vscode.ThemeColor(`gitDecoration.modifiedResourceForeground`);
const seachGutterColor = new vscode.ThemeColor(`gitDecoration.addedResourceForeground`);

const annotationDecoration = vscode.window.createTextEditorDecorationType({
  before: {
    color: new vscode.ThemeColor(`editorLineNumber.foreground`),
    textDecoration: `none`,
    fontWeight: `normal`,
    fontStyle: `normal`,
    margin: `0 1em 0 0`,
    width: `7ch`,
    // Pull the decoration out of the document flow if we want to be scrollable
  },
  rangeBehavior: vscode.DecorationRangeBehavior.ClosedOpen,
});

const diffOptions = {
  shouldPostProcessCharChanges: false,
  shouldIgnoreTrimWhitespace: true,
  shouldMakePrettyDiff: false,
  shouldComputeCharChanges: false,
  maxComputationTime: 1000
}

const lineDecor = vscode.window.createTextEditorDecorationType({
  backgroundColor: new vscode.ThemeColor(`diffEditor.insertedTextBackground`),
  rangeBehavior: vscode.DecorationRangeBehavior.OpenOpen,
});

const SD_BASE = `$(history) Date Search`;
const SD_ACTIVE = `$(history) From `;

const lengthDiagnostics = vscode.languages.createDiagnosticCollection(`Record Lengths`);

export class SourceDateHandler {
  readonly baseDates: Map<string, string[]> = new Map;
  readonly baseSource: Map<string, string> = new Map;
  readonly recordLengths: Map<string, number> = new Map;
  readonly baseSequences: Map<string, number[]> = new Map;

  private enabled: boolean = false;

  private timeout?: NodeJS.Timeout;
  private readonly timeoutDelay = 2000;
  private decorationTimeout?: NodeJS.Timeout;

  private highlightSince?: number;
  private highlightBefore?: number;
  private lineEditedBefore?: number;
  private sequenceNumbersShowing: boolean = false;
  private readonly sourceDateSearchBarItem: vscode.StatusBarItem;

  constructor(context: vscode.ExtensionContext) {
    this.sourceDateSearchBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right);
    this.sourceDateSearchBarItem.command = {
      command: `code-for-ibmi.member.newDateSearch`,
      title: `Change Search Date Filter`,
    };
    this.sourceDateSearchBarItem.tooltip = `Search lines by source date`;
    this.sourceDateSearchBarItem.text = SD_BASE;

    context.subscriptions.push(
      vscode.workspace.onDidChangeTextDocument(event => this.onDidChangeTextDocument(event)),
      vscode.window.onDidChangeActiveTextEditor((editor) => this.onDidChangeEditor(editor)),
      vscode.workspace.onDidCloseTextDocument(event => this.onDidCloseDocument(event)),
      vscode.commands.registerCommand(`code-for-ibmi.toggleSourceDateGutter`, () => this.toggleSourceDateGutter()),
      vscode.commands.registerCommand(`code-for-ibmi.member.clearDateSearch`, () => this.clearDateSearch()),
      vscode.commands.registerCommand(`code-for-ibmi.member.newDateSearch`, () => this.newDateSearch()),
      vscode.commands.registerCommand(`code-for-ibmi.toggleSequenceNumbers`, () => this.toggleSequenceNumbers()),
      this.sourceDateSearchBarItem
    );
  }

  setEnabled(enabled: boolean) {
    if (enabled) {
      this.sourceDateSearchBarItem.show();
    } else {
      this.sourceDateSearchBarItem.hide();
    }

    if (this.enabled !== enabled) {
      this.enabled = enabled
      if (!this.enabled) {
        clearTimeout(this.timeout);
        this.highlightSince = undefined;
        this.highlightBefore = undefined;
        this.lineEditedBefore = undefined;
        this.baseDates.clear();
        this.baseSource.clear();
        this.recordLengths.clear();
        this.baseSequences.clear();
      }
    }
  }

  private onDidCloseDocument(document: vscode.TextDocument) {
    // Clean up things when a member is closed
    if (this.enabled && document.uri.scheme === `member` && document.isClosed) {
      const connection = instance.getConnection();
      if (connection) {
        const alias = getAliasName(document.uri);
        this.baseDates.delete(alias);
        this.baseSource.delete(alias);
        this.recordLengths.delete(alias);
      }
    }
  }

  private onDidChangeEditor(editor?: vscode.TextEditor) {
    if (this.enabled && editor) {
      this._diffRefreshGutter(editor.document);
    }
  }

  private onDidChangeTextDocument(event: vscode.TextDocumentChangeEvent) {
    if (this.enabled) {
      const document = event.document;
      if (document.uri.scheme === `member`) {
        clearTimeout(this.timeout);
        this.timeout = setTimeout(() => this._diffChangeTimeout(document), this.timeoutDelay);
        this._diffOnDidChange(event);
      }
    }
  }

  private _diffOnDidChange(event: vscode.TextDocumentChangeEvent) {
    const document = event.document;

    if (document.isDirty) {
      const isSingleLine =
        event.contentChanges.length === 1 &&
        event.contentChanges[0].range.isSingleLine &&
        !event.contentChanges[0].text.includes(`\n`);

      const isSpace = (isSingleLine && event.contentChanges[0].text === ` `);

      const currentEditingLine = isSingleLine ? event.contentChanges[0].range.start.line : undefined;

      const editedBefore = isSingleLine && currentEditingLine === this.lineEditedBefore;
      const isAtStartOfLine = (event.contentChanges[0] && event.contentChanges[0].range.start.character === 0);
      const isDelete = (event.contentChanges[0] && event.contentChanges[0].text === `` && event.contentChanges[0].range.isEmpty === false)
      const doRefresh = (!editedBefore || currentEditingLine !== this.lineEditedBefore || isAtStartOfLine || isDelete);

      if (doRefresh) {
        // Defer decoration update to allow editor layout to stabilize
        // This prevents visual artifacts where dates briefly appear at the caret
        this._deferredRefreshGutter(document);
      }

      if (isDelete || isSpace) {
        this.lineEditedBefore = 0;
      } else
        if (event.contentChanges.length > 0) {
          this.lineEditedBefore = currentEditingLine || 0;
        }
    }
  }

  private _diffChangeTimeout(document: vscode.TextDocument) {
    const connection = instance.getConnection();
    if (connection) {
      const lengthDiags: vscode.Diagnostic[] = [];
      const alias = getAliasName(document.uri);
      const recordLength = this.recordLengths.get(alias);

      if (recordLength) {
        for (let lineIndex = 0; lineIndex < document.lineCount; lineIndex++) {
          const lineLength = document.lineAt(lineIndex).text.length;
          if (lineLength > recordLength) {
            const badRange = new vscode.Range(lineIndex, recordLength + 1, lineIndex, lineLength);
            const diagnostic = new vscode.Diagnostic(badRange, `Content past record length of ${recordLength}`, vscode.DiagnosticSeverity.Error);

            lengthDiags.push(diagnostic);
          }
        }
      }

      lengthDiagnostics.set(document.uri, lengthDiags);
    }
  }

  private _deferredRefreshGutter(document: vscode.TextDocument) {
    // Clear any pending decoration update
    clearTimeout(this.decorationTimeout);

    // Defer decoration application to allow editor layout to stabilize after bulk changes
    this.decorationTimeout = setTimeout(() => {
      this._diffRefreshGutter(document);
    }, 0);
  }

  private _diffRefreshGutter(document: vscode.TextDocument) {
    const connection = instance.getConnection();
    if (connection && document.uri.scheme === `member`) {
      const config = connection.getConfig();
      const alias = getAliasName(document.uri);

      let lineGutters: vscode.DecorationOptions[] = [];

      if (config && config.sourceDateGutter) {
        const sourceDates = this.baseDates.get(alias);
        const sequenceNumbers = this.baseSequences.get(alias);
        const sequenceNumbersAvailable = !document.isDirty && sequenceNumbers && sequenceNumbers.length === document.lineCount;
        const shouldShowSequences = this.sequenceNumbersShowing && sequenceNumbersAvailable;

        if (shouldShowSequences) {
          const markdownString = [
            `[Show source dates](command:code-for-ibmi.toggleSequenceNumbers)`,
          ].join(`\n\n---\n\n`);

          const hoverMessage = new vscode.MarkdownString(markdownString);
          hoverMessage.isTrusted = true;

          for (let cLine = 0; cLine < sequenceNumbers.length && cLine < document.lineCount; cLine++) {
            const sequenceNumber = sequenceNumbers[cLine].toFixed(2).padStart(7, `0`);
            lineGutters.push({
              range: new vscode.Range(
                new vscode.Position(cLine, 0),
                new vscode.Position(cLine, 0)
              ),
              hoverMessage,
              renderOptions: {
                before: {
                  contentText: sequenceNumber,
                },
              },
            });
          }

          const activeEditor = vscode.window.activeTextEditor;
          if (activeEditor && activeEditor.document.uri.fsPath === document.uri.fsPath) {
            activeEditor.setDecorations(annotationDecoration, lineGutters);
          }

        } else if (sourceDates) {
          const dates = document.isDirty ? this.calcNewSourceDates(alias, document.getText()) : sourceDates;

          let changedLined: vscode.DecorationOptions[] = [];

          const currentDate = currentStamp();
          const currentDateNumber = Number(currentDate);

          const markdownString = [
            `[Show changes since last local save](command:workbench.files.action.compareWithSaved)`,
            `${this.highlightSince ? `[Clear date search](command:code-for-ibmi.member.clearDateSearch) | ` : ``}[New date search](command:code-for-ibmi.member.newDateSearch)`,
            sequenceNumbersAvailable ? `[Show sequence numbers](command:code-for-ibmi.toggleSequenceNumbers)` : undefined
          ].filter(i => i !== undefined) as string[];

          if (this.highlightSince) markdownString.push(`Changes from ${String(this.highlightSince) == currentDate ? `today` : this.highlightSince} highlighted`)

          const hoverMessage = new vscode.MarkdownString(markdownString.join(`\n\n---\n\n`));
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

          const currentHighlightSince = this.highlightSince ? this.highlightSince + (this.highlightSince <= currentDateNumber ? 1000000 : 0) : undefined;
          const currentHighlightBefore = this.highlightBefore ? this.highlightBefore + (this.highlightBefore <= currentDateNumber ? 1000000 : 0) : undefined;

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
          if (activeEditor && activeEditor.document.uri.fsPath === document.uri.fsPath) {
            activeEditor.setDecorations(annotationDecoration, lineGutters);
            activeEditor.setDecorations(lineDecor, changedLined);
          }
        }
      }
    }
  }

  calcNewSourceDates(alias: string, body: string) {
    const newDates = this.baseDates.get(alias)?.slice() || [];
    const oldSource = this.baseSource.get(alias);

    const diffComputer = new DiffComputer(oldSource?.split(`\n`) || [], body.split(`\n`), diffOptions);
    const diff = diffComputer.computeDiff();

    const currentDate = currentStamp();

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
          startIndex = change.modifiedStartLineNumber;
          removedLines = change.originalEndLineNumber - change.originalStartLineNumber + 1
        } else
          if (change.modifiedEndLineNumber >= change.modifiedStartLineNumber) {
            // Lines added
            // at index (change.modifiedStartLineNumber-1)
            // on lines (modifiedEndLineNumber - modifiedStartLineNumber + 1)
            removedLines = change.originalEndLineNumber - change.originalStartLineNumber + 1;
            changedLines = change.modifiedEndLineNumber - change.modifiedStartLineNumber + 1;
          }

      newDates.splice(startIndex, removedLines, ...Array(changedLines).fill(currentDate));
    });

    return newDates;
  }

  private toggleSourceDateGutter() {
    const connection = instance.getConnection();
    if (connection) {
      const config = connection.getConfig();
      const currentValue = config.sourceDateGutter;
      config.sourceDateGutter = !currentValue;

      const editor = vscode.window.activeTextEditor;
      if (editor) {
        this._diffRefreshGutter(editor.document);
      }
    }
  }

  private toggleSequenceNumbers() {
    this.sequenceNumbersShowing = !this.sequenceNumbersShowing;
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      this._diffRefreshGutter(editor.document);
    }
  }

  private clearDateSearch() {
    this.sourceDateSearchBarItem.text = SD_BASE;
    this.highlightSince = undefined;
    this.highlightBefore = undefined;

    const editor = vscode.window.activeTextEditor;
    if (editor) {
      this._diffRefreshGutter(editor.document);
    }
  }

  private async newDateSearch() {
    const value = await vscode.window.showInputBox({
      value: currentStamp(),
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

          if (/^\d+$/.test(date) === false) {
            return `Value ${date} is not a valid date.`;
          }
        }
      }
    })

    if (value) {
      const dates = value.split(`-`);
      this.sourceDateSearchBarItem.text = SD_ACTIVE + value;
      this.highlightSince = Number(dates[0]);
      this.highlightBefore = dates[1] !== undefined ? Number(dates[1]) : undefined;
    } else {
      this.sourceDateSearchBarItem.text = SD_BASE;
      this.highlightSince = undefined;
      this.highlightBefore = undefined;
    }

    const editor = vscode.window.activeTextEditor;
    const connection = instance.getConnection();
    if (editor) {
      connection!.getConfig().sourceDateGutter = true;
      this._diffRefreshGutter(editor.document);
    }
  }
}

export function getAliasName(uri: vscode.Uri) {
  return `TEMP_${Crypto.createHash('sha1').update(uri.toString()).digest('hex')}`.toUpperCase();
}

/**
   * @returns {string} Stamp in format for source date
   */
function currentStamp(): string {
  const today = new Date();
  const mm = today.getMonth() + 1; // getMonth() is zero-based
  const dd = today.getDate();
  const yy = String(today.getFullYear()).substring(2);

  return [yy, (mm > 9 ? `` : `0`) + mm, (dd > 9 ? `` : `0`) + dd].join(``);
}