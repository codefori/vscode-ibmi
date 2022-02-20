const vscode = require(`vscode`);

exports.hex = {
  22: `#c99400`
}

exports.decorations = {
  // YLW_CS 
  22: vscode.window.createTextEditorDecorationType({
    color: this.hex[22],
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedOpen,
  }), 
}

exports.bytes = Object.keys(this.decorations).map(byte => Number(byte));