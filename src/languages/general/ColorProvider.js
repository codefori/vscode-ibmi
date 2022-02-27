const vscode = require(`vscode`);

const Colors = require(`./colors`);

const hidden = vscode.window.createTextEditorDecorationType({
  letterSpacing: `-1em`,
  opacity: `0`,
});

module.exports = class ColorProvider {
  /** 
   * @param {vscode.ExtensionContext} context
   */
  constructor(context) {
    this.timeout = undefined;

    context.subscriptions.push(
      vscode.workspace.onDidChangeTextDocument(event => {
        clearTimeout(this.timeout);
        this.timeout = setTimeout(() => {
          this.refreshDocumentColors(event.document);
        }, 2000);
      }),

      vscode.window.onDidChangeActiveTextEditor(event => {
        if (event && event.document) {
          this.refreshDocumentColors(event.document);
        }
      })

    );
  }

  /**
   * @param {vscode.TextDocument} document 
   */
  refreshDocumentColors(document) {
    if (document.uri.scheme === `member`) {
      // This should only work for members.
      // We don't want to support this everywhere because it's ugly.

      const activeEditor = vscode.window.activeTextEditor;
    
      if (document.uri.path === activeEditor.document.uri.path) {
        const hiddenDecorations = [];

        /** @type {{[color: string]: vscode.DecorationOptions[]}} */
        const colorDecorations = {};

        // Set up the arrays
        Colors.list.forEach(byte => {
          colorDecorations[byte] = [];
        });

        // Find the lines and the bytes and all that...
        for (let lineIndex = 0; lineIndex < document.lineCount; lineIndex++) {
          const line = document.lineAt(lineIndex);

          const lineBytes = Buffer.from(line.text);

          Colors.list.forEach(color => {
            const byteIndex = lineBytes.indexOf(Colors.definitions[color].bytes);
            if (byteIndex >= 0) {
              const definition = Colors.definitions[color];
              colorDecorations[color].push({
                range: new vscode.Range(lineIndex, byteIndex+definition.bytes.length-1, lineIndex, line.text.length)
              });

              hiddenDecorations.push({
                range: new vscode.Range(lineIndex, byteIndex, lineIndex, byteIndex+1),
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
        Colors.list.forEach(color => {
          activeEditor.setDecorations(Colors.definitions[color].decoration, colorDecorations[color]);
        });

        activeEditor.setDecorations(hidden, hiddenDecorations);
      }
    } 
  }
}