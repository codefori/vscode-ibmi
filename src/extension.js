// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const vscode = require(`vscode`);

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed

let instance = require(`./Instance`);
const Configuration = require(`./api/Configuration`);

const LoginPanel = require(`./webviews/login`);

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {

  // Use the console to output diagnostic information (console.log) and errors (console.error)
  // This line of code will only be executed once when your extension is activated
  console.log(`Congratulations, your extension "code-for-ibmi" is now active!`);

  // The command has been defined in the package.json file
  // Now provide the implementation of the command with  registerCommand
  // The commandId parameter must match the command field in package.json
  context.subscriptions.push(
    vscode.commands.registerCommand(`code-for-ibmi.connect`, function () {
      LoginPanel.show(context);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(`code-for-ibmi.connectPrevious`, function () {
      LoginPanel.LoginToPrevious(context);
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(async event => {
      const connection = instance.getConnection();
      if (connection) {
        const config = instance.getConfig();

        if (event.affectsConfiguration(`code-for-ibmi.connectionSettings`)) {
          await config.reload();
        }
      }
    })
  )
}

// this method is called when your extension is deactivated
function deactivate() {}

module.exports = {
  activate,
  deactivate
}
