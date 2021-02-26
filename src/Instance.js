
const vscode = require('vscode');

const IBMi = require('./api/IBMi');
const IBMiContent = require("./api/IBMiContent");
const CompileTools = require("./api/CompileTools");

/** @type {vscode.StatusBarItem} */
let statusBar;

let initialisedBefore = false;

module.exports = class Instance {
  static setConnection(conn) {
    instance.connection = conn;
    instance.content = new IBMiContent(instance.connection);
  };
  
  static getConnection() {return instance.connection};
  static getContent() {return instance.content};

  static disconnect() {
    if (instance.connection) {
      instance.connection.client.dispose();
      instance.connection = undefined;
    }
  }

  /**
   * We call this after we have made a connect to the IBM i to load the rest of the plugin in.
   * @param {vscode.ExtensionContext} context
   */
  static loadAllofExtension(context) {
    const memberBrowser = require('./views/memberBrowser');
    const qsysFs = new (require('./views/qsysFs'));
    
    const ifsBrowser = require('./views/ifsBrowser');
    const ifs = new (require('./views/ifs'));


    if (instance.connection) {
      CompileTools.register(context);

      if (!statusBar) {
        statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
        context.subscriptions.push(statusBar);
      }
      
      statusBar.text = `IBM i: ${instance.connection.currentHost}`;
      statusBar.show();

      //Update the status bar and that's that.
      if (initialisedBefore) {
        vscode.commands.executeCommand('code-for-ibmi.refreshMemberBrowser');
        vscode.commands.executeCommand('code-for-ibmi.refreshIFSBrowser');
        return;

      } else {

        context.subscriptions.push(
          vscode.commands.registerCommand('code-for-ibmi.disconnect', async () => {
            if (instance.connection) {
              statusBar.hide();
              vscode.window.showInformationMessage(`Disconnecting from ${instance.connection.currentHost}.`);
              this.disconnect();
            } else {
              vscode.window.showErrorMessage(`Not currently connected to any system.`);
            }
          })
        );

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
          vscode.window.registerTreeDataProvider(
            'ifsBrowser',
            new ifsBrowser(context)
        ));
  
        context.subscriptions.push(
          //@ts-ignore
          vscode.workspace.registerFileSystemProvider('streamfile', ifs, { 
            isCaseSensitive: false
          })
        );
  
        context.subscriptions.push(
          vscode.commands.registerCommand('code-for-ibmi.openEditable', async (path) => {
            console.log(path);
            let uri;
            if (path.startsWith('/')) {
              //IFS
              uri = vscode.Uri.parse(path).with({scheme: 'streamfile'});
            } else {
              uri = vscode.Uri.parse(path).with({scheme: 'member'});
            }
  
            try {
              let doc = await vscode.workspace.openTextDocument(uri); // calls back into the provider
              await vscode.window.showTextDocument(doc, { preview: false });
            } catch (e) {
              console.log(e);
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

        initialisedBefore = true;
      }
    }
  }
};

var instance = {
  /** @type {IBMi} */
  connection: undefined,
  /** @type {IBMiContent} */
  content: undefined, //IBM,
};