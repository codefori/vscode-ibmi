import { ExtensionContext, Position, Range, Selection, TextDocument, commands, window } from "vscode";
import { instance } from "../../instantiate";
import { GlobalConfiguration } from "../../api/Configuration";
import { EndOfLine } from "vscode";

export function initialise(context: ExtensionContext) {
  context.subscriptions.push(
    commands.registerCommand(`code-for-ibmi.cl.runSelected`, async () => {
      const editor = window.activeTextEditor;

      if (editor) {
        const document = editor.document;

        if (document && document.languageId === `cl`) {
          const connection = instance.getConnection();

          if (connection) {
            const selectedCommand = getCommandString(editor.selection, document);
            
            if (selectedCommand.range) {
              editor.selection = new Selection(
                new Position(selectedCommand.range.start, 0), 
                new Position(selectedCommand.range.end, document.lineAt(selectedCommand.range.end).range.end.character)
              );
            }
            
            const commandResult = await connection!.runCommand({
              command: selectedCommand.content,
              environment: `ile`
            });

            if (commandResult) {
              if (commandResult.code === 0 || commandResult.code === null) {
                window.showErrorMessage(
                  `Command was successful.`,
                  GlobalConfiguration.get<boolean>(`logCompileOutput`) ? `Show Output` : ''
                ).then(async (item) => {
                  if (item === `Show Output`) {
                    commands.executeCommand(`code-for-ibmi.showOutputPanel`);
                  }
                });
              } else {
                window.showErrorMessage(
                  `Command did not end successfully.`,
                  GlobalConfiguration.get<boolean>(`logCompileOutput`) ? `Show Output` : ''
                ).then(async (item) => {
                  if (item === `Show Output`) {
                    commands.executeCommand(`code-for-ibmi.showOutputPanel`);
                  }
                });
              }
            }
          }
        }
      }
    })
  )
}

function getCommandString(selection: Selection, document: TextDocument): {content: string, range?: {start: number, end: number}} {
  if (selection.isEmpty) {
    let line = selection.start.line;

    // First let's find out if this command belong to another command
    if ((line-1) >= 0) {
      let preLine = document.lineAt(line-1).text.trim();

      while ((line-1) >= 0 && preLine.endsWith(`+`)) {
        line--;
        preLine = document.lineAt(line-1).text.trim();
      };
    }

    // Then fetch all the lines
    const startLine = line;
    let content = [document.lineAt(line).text.trim()];

    // Then we fetch the next continuation lines
    while (content[content.length - 1].endsWith(`+`)) {
      line += 1;
      content.push(document.lineAt(line).text.trim());
    }

    return {
      content: removePlusJoins(content).join(` `),
      range: {
        start: startLine,
        end: line
      }
    };
  } else {
    const lines = document.getText(new Range(selection.start, selection.end)).split(document.eol === EndOfLine.CRLF ? `\r\n` : `\n`);
    return {
      content: removePlusJoins(lines).join(` `)
    };
  }
}

function removePlusJoins(lines: string[]) {
  for (let i = 0; i < lines.length; i++) {
    lines[i] = lines[i].trim();
    if (lines[i].endsWith(`+`)) lines[i] = lines[i].substring(0, lines[i].length - 1);
  }

  return lines;
}