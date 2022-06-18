// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const vscode = require(`vscode`);

const Reporter = require(`./reporter`);

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed

let instance = require(`./Instance`);
let {CustomUI, Field} = require(`./api/CustomUI`);

const connectionBrowser = require(`./views/connectionBrowser`);

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {

  // Use the console to output diagnostic information (console.log) and errors (console.error)
  // This line of code will only be executed once when your extension is activated

  console.log(`Congratulations, your extension "code-for-ibmi" is now active!`);
  
  if (vscode.env.isTelemetryEnabled) {
    const extensionName = process.env.EXT_NAME;
    const extensionVersion = process.env.EXT_VERSION;
    const azureKey = process.env.AZURE_COLLECT_KEY;

    console.log(`Extension name: ${extensionName}`);
    console.log(`Extension version: ${extensionVersion}`);
    console.log(`Azure key: ${azureKey}`);

    const reporter = Reporter.create(extensionName, extensionVersion, azureKey);
    context.subscriptions.push(reporter);
  }

  //We setup the event emitter.
  instance.setupEmitter();

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider(
      `connectionBrowser`,
      new connectionBrowser(context)
    )
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

  return {instance, CustomUI, Field, baseContext: context};
}

// this method is called when your extension is deactivated
function deactivate() {}

module.exports = {
  activate,
  deactivate
}
