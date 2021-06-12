// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const vscode = require(`vscode`);

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed

let instance = require(`./Instance`);
let {CustomUI, Field} = require(`./api/CustomUI`);
const Configuration = require(`./api/Configuration`);

const LoginPanel = require(`./webviews/login`);

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {

  // Use the console to output diagnostic information (console.log) and errors (console.error)
  // This line of code will only be executed once when your extension is activated
  console.log(`Congratulations, your extension "code-for-ibmi" is now active!`);

  //We setup the event emitter.
  instance.setupEmitter();

  // Upgrade existing configurations to have names
  // This is derived per host as per the current UI restrictions
  const configData = vscode.workspace.getConfiguration(`code-for-ibmi`);
  let connections = configData.get(`connections`);
  let connectionSettings = configData.get(`connectionSettings`);

  for (let connection of connections) {
    if (!connection.name) {
      connection.name = `${connection.username}@${connection.host}:${connection.port}`;

      const index = connectionSettings.findIndex(conn => conn.host === connection.host);

      if (index >= 0) {
        connectionSettings[index][`name`] = connection.name;
      }

      configData.update(`connections`, connections, vscode.ConfigurationTarget.Global);
      configData.update(`connectionSettings`, connectionSettings, vscode.ConfigurationTarget.Global);
    }
    
  };

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

  if (vscode.workspace.workspaceFile) {
    const workspaceConnection = Configuration.get(`vscode-ibmi-connection`);
    if (workspaceConnection) {
      LoginPanel.LoginByName(context, workspaceConnection);
    }
  }

  return {instance, CustomUI, Field, baseContext: context};
}

// this method is called when your extension is deactivated
function deactivate() {}

module.exports = {
  activate,
  deactivate
}
