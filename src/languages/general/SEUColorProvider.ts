import vscode from 'vscode';

import { SEUColors } from './SEUColors';

const hidden = vscode.window.createTextEditorDecorationType({
  //letterSpacing: `-1em`,
  opacity: `0`,
  rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
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

        // Helper function: record a segment of a member line that should be hidden
        function addSegmentToHide(lineIndex:number, startIndex:number, endIndex:number) {
          hiddenDecorations.push({
            range: new vscode.Range(lineIndex, startIndex, lineIndex, endIndex),
            renderOptions: {
              before: {
                contentText: Buffer.from([156]).toString(),
                width: `0`,
                textDecoration: `; opacity: 0;`
              },
              after: {
                contentText: Buffer.from([152]).toString(),
                width: `0`,
                textDecoration: `; opacity: 0;`
              },
            }
          });
        }

        // Helper function: record a segment of a member line that should be colored
        function addSegmentToColor(lineIndex:number, startIndex:number, endIndex:number, colorName:string) {
          colorDecorations[colorName].push({
            range: new vscode.Range(lineIndex, startIndex, lineIndex, endIndex)
          });
        }

        // Iterate over each line of text in the document
        for (let lineIndex = 0; lineIndex < document.lineCount; lineIndex++) {
          const line = document.lineAt(lineIndex);
          const lineBytes = Buffer.from(line.text);

          // Character index and definition of the previously found color sequence
          let prevColorSeqCharIndex = 0;
          let prevColorSeqDef = null;

          // Check the line byte-by-byte
          for (let byteIndex = 0; byteIndex < lineBytes.byteLength; ++byteIndex) {
            const nextByte = lineBytes[byteIndex];
            // If the current byte is NOT 194 (0xC2), only check the current byte.
            // Otherwise, check both the current byte and the following byte
            let bytesToCheck = [nextByte];
            if(nextByte === 194)
              bytesToCheck.push(lineBytes[byteIndex+1]);
            // Find the color sequence, if any, indicated by the checked byte(s)
            const colorDef = SEUColors.getColorDef(Buffer.from(bytesToCheck));
            if(colorDef) {
              // VS Code ranges are based on characters rather than bytes, and one byte is not always 
              // interpreted as one character. So, find the character-based index where the color
              // sequence appears.
              const charIndex = lineBytes.slice(0,byteIndex).toString().length;
              const seqCharLength = Buffer.from(bytesToCheck).toString().length;

              addSegmentToHide(lineIndex, charIndex, charIndex + seqCharLength);
              // If a color sequence was found earlier in the line,
              // mark this as the end of the line segment to be colored according to that seuqnece
              if(prevColorSeqDef)
                addSegmentToColor(lineIndex, prevColorSeqCharIndex, charIndex, prevColorSeqDef);
              prevColorSeqCharIndex = charIndex + seqCharLength;
              prevColorSeqDef = colorDef;
            }
          }
          // For the last color sequence on the line, color all characters until the end of the line
          if(prevColorSeqDef)
            addSegmentToColor(lineIndex, prevColorSeqCharIndex, line.text.length, prevColorSeqDef);
        }

        // Finally, set the decorations
        SEUColors.forEach((name, definition) => {
          activeEditor.setDecorations(definition.decoration, colorDecorations[name]);
        });
        activeEditor.setDecorations(hidden, hiddenDecorations);
        
      }
    }
  }
}