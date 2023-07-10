import vscode from "vscode";
import { DiffComputer } from "vscode-diff";

import { SourceDateMode } from "../../api/Configuration";
import { instance } from "../../instantiate";

const editedTodayColor = new vscode.ThemeColor(`gitDecoration.modifiedResourceForeground`);
const seachGutterColor = new vscode.ThemeColor(`gitDecoration.addedResourceForeground`);
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
  readonly baseSource: Map<string, string> = new Map
  readonly recordLengths: Map<string, number> = new Map

  sourceDateMode: SourceDateMode = "diff";
  private enabled: boolean = false;

  private timeout?: NodeJS.Timeout;
  private readonly timeoutDelay = 2000;

  private highlightSince?: number;
  private highlightBefore?: number;
  private lineEditedBefore?: number;
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
      vscode.window.onDidChangeTextEditorSelection(event => this.onDidChangeTextSelection(event)),
      vscode.workspace.onDidCloseTextDocument(event => this.onDidCloseDocument(event)),
      vscode.commands.registerCommand(`code-for-ibmi.toggleSourceDateGutter`, () => this.toggleSourceDateGutter()),
      vscode.commands.registerCommand(`code-for-ibmi.member.clearDateSearch`, () => this.clearDateSearch()),
      vscode.commands.registerCommand(`code-for-ibmi.member.newDateSearch`, () => this.newDateSearch()),
      this.sourceDateSearchBarItem
    );
  }

  setEnabled(enabled: boolean) {
    if (this.enabled !== enabled) {
      this.enabled = enabled
      if (!this.enabled) {
        clearTimeout(this.timeout);
        this.sourceDateSearchBarItem.hide();
        this.highlightSince = undefined;
        this.highlightBefore = undefined;
        this.lineEditedBefore = undefined;
        this.baseDates.clear();
        this.baseSource.clear();
        this.recordLengths.clear();
        this.updateContext();
      }

      if (vscode.window.visibleTextEditors.some(e => e.document.uri.scheme === 'member')) {
        vscode.window.showWarningMessage("Source date support has changed; reopen opened editor(s) for the change to take effect.");
      }
    }
  }

  changeSourceDateMode(sourceDateMode: SourceDateMode) {
    this.sourceDateMode = sourceDateMode;
    if (this.sourceDateMode === "diff") {
      this.sourceDateSearchBarItem.show();
    }
    else {
      this.sourceDateSearchBarItem.hide();
    }
    this.updateContext(sourceDateMode);
  }

  private updateContext(sourceDateMode?: SourceDateMode) {
    vscode.commands.executeCommand(`setContext`, `code-for-ibmi:sourceDateMode`, sourceDateMode);
  }

  private onDidCloseDocument(document: vscode.TextDocument) {
    // Clean up things when a member is closed
    if (this.enabled && document.uri.scheme === `member` && document.isClosed) {
      const connection = instance.getConnection();
      if (connection) {
        const { library, file, name: member } = connection.parserMemberPath(document.uri.path);

        const alias = getAliasName(library, file, member);
        this.baseDates.delete(alias);
        this.baseSource.delete(alias);
        this.recordLengths.delete(alias);
      }
    }
  }

  private onDidChangeTextSelection(event: vscode.TextEditorSelectionChangeEvent) {
    if (this.enabled && this.sourceDateMode === "edit" && instance.getConfig()?.sourceDateGutter) {
      this._editRefreshGutter(event.textEditor);
    }
  }

  private onDidChangeEditor(editor?: vscode.TextEditor) {
    if (this.enabled && editor) {
      if (this.sourceDateMode === "edit" && instance.getConfig()?.sourceDateGutter) {
        this._editRefreshGutter(editor);
      }
      else if (this.sourceDateMode === "diff") {
        this._diffRefreshGutter(editor.document);
      }
    }
  }

  private onDidChangeTextDocument(event: vscode.TextDocumentChangeEvent) {
    if (this.enabled) {
      const document = event.document;
      if (document.uri.scheme === `member`) {
        clearTimeout(this.timeout);
        if (this.sourceDateMode === "edit") {
          this.timeout = setTimeout(() => this._editChangeTimeout(document), this.timeoutDelay);
          this._editOnDidChange(event);
        }
        else {
          this.timeout = setTimeout(() => this._diffChangeTimeout(document), this.timeoutDelay);
          this._diffOnDidChange(event);
        }
      }
    }
  }

  private _editOnDidChange(event: vscode.TextDocumentChangeEvent) {
    const connection = instance.getConnection();
    if (connection) {
      const path = event.document.uri.path;
      const { library, file, name: member } = connection.parserMemberPath(path);

      const alias = getAliasName(library, file, member);
      const sourceDates = this.baseDates.get(alias);
      if (sourceDates) {
        for (const change of event.contentChanges) {

          const startLineNumber = change.range.start.line;
          const endLineNumber = change.range.end.line;
          const line = startLineNumber;

          const currentDate = currentStamp();

          const startNewLine = change.text[0] === `\n`;

          // Is a space
          if (change.text.trim() === ``) {
            // Removing a line
            if (startLineNumber < endLineNumber) {
              const lineCount = endLineNumber - startLineNumber;
              sourceDates.splice(line + 1, lineCount);
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
            sourceDates.splice(line + 1, 0, ...newSourceDates);
          }
        }
      }
    }
  }

  private _editChangeTimeout(document: vscode.TextDocument) {
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

    const lengthDiags: vscode.Diagnostic[] = [];
    const alias = getAliasName(lib, file, fullName);
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

  private _editRefreshGutter(editor: vscode.TextEditor) {
    if (editor.document.uri.scheme === `member`) {
      const connection = instance.getConnection();
      if (connection) {
        const path = editor.document.uri.path;
        const { library, file, name: member } = connection.parserMemberPath(path);

        const alias = getAliasName(library, file, member);;

        const sourceDates = this.baseDates.get(alias);
        if (sourceDates) {
          const annotations: vscode.DecorationOptions[] = [];
          const currentDate = currentStamp();

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
        this._diffRefreshGutter(document);
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
      const path = connection.parserMemberPath(document.uri.path);
      const lib = path.library, file = path.file, fullName = path.name;
      const alias = getAliasName(lib, file, fullName);
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

  private _diffRefreshGutter(document: vscode.TextDocument) {
    if (document.uri.scheme === `member`) {
      const connection = instance.getConnection();
      const config = instance.getConfig();

      if (connection && config && config.sourceDateGutter) {
        const path = document.uri.path;
        const { library, file, name: member } = connection.parserMemberPath(path);
        const alias = getAliasName(library, file, member);;

        const sourceDates = this.baseDates.get(alias);
        if (sourceDates) {
          const dates = document.isDirty ? this.calcNewSourceDates(alias, document.getText()) : sourceDates;

          let lineGutters: vscode.DecorationOptions[] = [];
          let changedLined: vscode.DecorationOptions[] = [];

          const currentDate = currentStamp();
          const currentDateNumber = Number(currentDate);

          const markdownString = [
            `[Show changes since last local save](command:workbench.files.action.compareWithSaved)`,
            `---`,
            `${this.highlightSince ? `[Clear date search](command:code-for-ibmi.member.clearDateSearch) | ` : ``}[New date search](command:code-for-ibmi.member.newDateSearch)`
          ];

          if (this.highlightSince) markdownString.push(`---`, `Changes from ${String(this.highlightSince) == currentDate ? `today` : this.highlightSince} highlighted`)

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
    if (this.sourceDateMode === "diff") {
      const config = instance.getConfig();
      if (config) {
        const currentValue = config.sourceDateGutter;
        config.sourceDateGutter = !currentValue;

        const editor = vscode.window.activeTextEditor;
        if (editor) {
          this._diffRefreshGutter(editor.document);
        }
      }
    }
  }

  private clearDateSearch() {
    if (this.sourceDateMode === "diff") {
      this.sourceDateSearchBarItem.text = SD_BASE;
      this.highlightSince = undefined;
      this.highlightBefore = undefined;

      const editor = vscode.window.activeTextEditor;
      if (editor) {
        this._diffRefreshGutter(editor.document);
      }
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
    if (editor) {
      instance.getConfig()!.sourceDateGutter = true;
      this._diffRefreshGutter(editor.document);
    }
  }
}

export function getAliasName(library: string, sourceFile: string, member: string) {
  return `${library}_${sourceFile}_${member}`.replace(/\./g, `_`)
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