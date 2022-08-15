// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const vscode = require(`vscode`);

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed

let instance = require(`./Instance`);
let {CustomUI, Field} = require(`./api/CustomUI`);

const connectionBrowser = require(`./views/connectionBrowser`);
const IBMi = require("./api/IBMi");

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {

  // Use the console to output diagnostic information (console.log) and errors (console.error)
  // This line of code will only be executed once when your extension is activated
  console.log(`Congratulations, your extension "code-for-ibmi" is now active!`);

  //We setup the event emitter.
  instance.setupEmitter();

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider(
      `connectionBrowser`,
      new connectionBrowser(context)
    ),

    vscode.commands.registerCommand(`code-for-ibmi.connectDirect`, 
      /**
       * @param {ConnectionData} connectionData 
       * @returns {Promise<Boolean>}
       */
      async (connectionData) => {
        const existingConnection = instance.getConnection();

        if (existingConnection) return false;

        const connection = new IBMi();
        const connected = await connection.connect(connectionData);
        if (connected.success) {
          instance.setConnection(connection);
          instance.loadAllofExtension(context);
        }

        return connected.success;
      }
    ),

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

  return {instance, CustomUI, Field, baseContext: context};
}

// this method is called when your extension is deactivated
function deactivate() {}

module.exports = {
  activate,
  deactivate
}
