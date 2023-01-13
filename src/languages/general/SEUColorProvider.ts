import vscode from 'vscode';

import { SEUColors } from './SEUColors';

const hidden = vscode.window.createTextEditorDecorationType({
  letterSpacing: `-1em`,
  opacity: `0`,
});

export namespace SEUColorProvider {
  let _timeout: NodeJS.Timeout;

  export function intitialize(context: vscode.ExtensionContext) {
    context.subscriptions.push(
      vscode.workspace.onDidChangeTextDocument(event => {
        clearTimeout(_timeout);
        _timeout = setTimeout(() => {
          refreshDocumentColors(event.document);
        }, 2000);
      }),

      vscode.window.onDidChangeActiveTextEditor(event => {
        if (event?.document) {
          refreshDocumentColors(event.document);
        }
      })

    );
  }

  function refreshDocumentColors(document: vscode.TextDocument) {
    if (document.uri.scheme === `member`) {
      // This should only work for members.
      // We don't want to support this everywhere because it's ugly.

      const activeEditor = vscode.window.activeTextEditor;
      if (document.uri.path === activeEditor?.document.uri.path) {
        const hiddenDecorations : vscode.DecorationOptions[] = [];
        const colorDecorations : Record<string,vscode.DecorationOptions[]> = {};

        // Set up the arrays
        SEUColors.forEach(name => {
          colorDecorations[name] = [];
        });

        // Find the lines and the bytes and all that...
        for (let lineIndex = 0; lineIndex < document.lineCount; lineIndex++) {
          const line = document.lineAt(lineIndex);

          const lineBytes = Buffer.from(line.text);

          SEUColors.forEach((name, definition) => {
            const byteIndex = lineBytes.indexOf(definition.bytes);
            if (byteIndex >= 0) {
              colorDecorations[name].push({
                range: new vscode.Range(lineIndex, byteIndex + definition.bytes.length - 1, lineIndex, line.text.length)
              });

              hiddenDecorations.push({
                range: new vscode.Range(lineIndex, byteIndex, lineIndex, byteIndex + 1),
                renderOptions: {
                  after: {
                    contentText: ``.padEnd(definition.bytes.length),
                  }
                }
              });
            }
          })
        }

        // Then set the decorations
        SEUColors.forEach((name, definition) => {
          activeEditor.setDecorations(definition.decoration, colorDecorations[name]);
        });

        activeEditor.setDecorations(hidden, hiddenDecorations);
      }
    }
  }
}