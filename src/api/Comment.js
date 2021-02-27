
const vscode = require('vscode');

/**
 * @param {string} string 
 */
function getSpaces(string) {
  return string.search(/\S/);
}

/**
 * 
 * @param {string} line 
 * @param {string} commentString 
 * @returns {Boolean}
 */
function isCommented(line, commentString = '//') {
  const index = getSpaces(line);

  line = line.substring(index);

  return line.startsWith(commentString);
}

/**
 * 
 * @param {string} line 
 * @param {boolean} comment 
 * @param {string} commentString 
 * @returns {string}
 */
function setCommented(line, comment = true, commentString = '//') {
  const index = getSpaces(line);

  if (comment)
    return line.substr(0, index) + commentString + line.substr(index);
  else {
    line = line.substr(index);
    if (line.startsWith(commentString)) {
      line = line.substring(2);
    }
    return ''.padStart(index, ' ') + line;
  }
}

/**
 * 
 * @param {string} type 
 * @param {vscode.TextEditor} editor 
 */
module.exports = async (type, editor) => {
  
  /** @type {vscode.Selection|null} */
  let selection = null;

  if (editor.selection) {
    selection = editor.selection;

    if (selection.isSingleLine) {
      const cursor = editor.selection.active;
      if (cursor) {
        selection = new vscode.Selection(cursor.line, 0, cursor.line, 100);
      }
    }
  }

  if (selection) {
    const lines = editor.document.getText(selection).split('\n') || [''];
    let giveComment;
    let isValid = false;

    if (lines) {
      switch (type) {
        case 'sqlrpgle':
        case 'rpgle':
          isValid = true;
          giveComment = !isCommented(lines[0]);

          for (let i = 0; i < lines.length; i++) {
            if (lines[i].trim() !== '')
              if (isCommented(lines[i]) !== giveComment)
                lines[i] = setCommented(lines[i], giveComment);
          }
          break;

        case 'cl':
          isValid = true;
          //CL only supports group comments
          lines[0] = '/*' + lines[0];
          lines[lines.length - 1] += '*/';
          break;
      }

      if (isValid) {
        await editor.edit((edit) => {
          edit.replace(selection, lines.join('\n'));
        });
      }
    }
  }
};
