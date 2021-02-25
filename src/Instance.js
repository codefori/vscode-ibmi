
const vscode = require('vscode');

const IBMi = require('./api/IBMi');
const IBMiContent = require("./api/IBMiContent");
const CompileTools = require("./api/CompileTools");

module.exports = class Instance {
  static setConnection(conn) {
    instance.connection = conn;
    instance.content = new IBMiContent(instance.connection);
  };
  
  static getConnection() {return instance.connection};
  static getContent() {return instance.content};

  /**
   * We call this after we have made a connect to the IBM i to load the rest of the plugin in.
   * @param {vscode.ExtensionContext} context
   */
  static loadAllofExtension(context) {
    const memberBrowser = require('./views/memberBrowser');
    const qsysFs = new (require('./views/qsysFs'));

    if (instance.connection) {
      CompileTools.register(context);

      const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
      statusBar.text = `IBM i: ${instance.connection.currentHost}`;
      statusBar.show();
      context.subscriptions.push(statusBar);

      context.subscriptions.push(
        vscode.window.registerTreeDataProvider(
          'memberBrowser',
          new memberBrowser(context)
      ));

      context.subscriptions.push(
        //@ts-ignore
        vscode.workspace.registerFileSystemProvider('member', qsysFs, { 
          isCaseSensitive: false
        })
      );

      context.subscriptions.push(
        vscode.commands.registerCommand('code-for-ibmi.openEditable', async (path) => {
          console.log(path);
          if (path.startsWith('/')) {
            //IFS
          } else {
            let uri = vscode.Uri.parse(path).with({scheme: 'member'});
            try {
              let doc = await vscode.workspace.openTextDocument(uri); // calls back into the provider
              await vscode.window.showTextDocument(doc, { preview: false });
            } catch (e) {
              console.log(e);
            }
          }
        })
      );

      context.subscriptions.push(
        vscode.commands.registerCommand('code-for-ibmi.runAction', async () => {
          const editor = vscode.window.activeTextEditor;
          if (editor) {
            if (editor.document.isDirty)
              vscode.window.showInformationMessage("Cannot run action while file is not saved.");
            else
              CompileTools.RunAction(this, editor.document.uri);
          }
        })
      );
      
      context.subscriptions.push(
        vscode.commands.registerCommand(`code-for-ibmi.runActionFromView`, async (node) => {
          CompileTools.RunAction(this, node.resourceUri);
        })
      );
    }
  }
};

var instance = {
  /** @type {IBMi} */
  connection: undefined,
  /** @type {IBMiContent} */
  content: undefined, //IBM,
};