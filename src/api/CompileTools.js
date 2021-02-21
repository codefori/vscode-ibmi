
const vscode = require('vscode');

module.exports = class CompileTools {

  /**
   * @param {*} instance
   * @param {vscode.Uri} uri 
   */
  static async Compile(instance, uri) {
    const config = vscode.workspace.getConfiguration('code-for-ibmi');
    const compileCommands = config.get('compileCommands');

    const extension = uri.path.substring(uri.path.lastIndexOf('.')+1);

    const compileOptions = compileCommands.filter(item => item.fileSystem === uri.scheme && item.extension === extension);

    if (compileOptions.length > 0) {
      const options = compileOptions.map(item => item.name);

      var chosenOptionName, command;

      if (options.length === 1) {
        chosenOptionName = options[0]
      } else {
        chosenOptionName = await vscode.window.showQuickPick(options);
      }

      if (chosenOptionName) {
        command = compileCommands.find(item => item.fileSystem === uri.scheme && item.extension === extension && item.name === chosenOptionName).command;

        switch (uri.scheme) {
          case 'member':
            const [blank, lib, file, fullName] = uri.path.split('/');
            const name = fullName.substring(0, fullName.lastIndexOf('.'));

            command = command.replace(new RegExp('&OPENLIB', 'g'), lib.toUpperCase());
            command = command.replace(new RegExp('&OPENSPF', 'g'), file.toUpperCase());
            command = command.replace(new RegExp('&OPENMBR', 'g'), name.toUpperCase());

            break;
        }

        command = `system -s "${command}"`;

        const connection = instance.getConnection();
        const libl = connection.libraryList.slice(0).reverse();

        var output, compiled = false;

        try {
          output = await connection.qshCommand([
            'liblist -d ' + connection.defaultUserLibraries.join(' '),
            'liblist -a ' + libl.join(' '),
            command,
          ]);

          compiled = true;
        } catch (e) {
          output = e;
          compiled = false;
        }

        console.log({compiled, output});
        vscode.window.showInformationMessage(`Compiled: ${compiled}. Command: ${command}`);
      }

    } else {
      //No compile commands
      vscode.window.showErrorMessage(`No compile commands found for ${uri.scheme}-${extension}.`);
    }
  }
}