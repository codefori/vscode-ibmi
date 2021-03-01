
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
    vscode.commands.executeCommand('setContext', 'code-for-ibmi:connected', true);
  };
  
  static getConnection() {return instance.connection};
  static getContent() {return instance.content};

  /**
   * @returns {Promise<boolean>} Indicates whether it was disconnect succesfully or not.
   */
  static async disconnect() {
    let doDisconnect = true;

    for (const document of vscode.workspace.textDocuments) {
      console.log(document);
      if (!document.isClosed && ['member', 'streamfile'].includes(document.uri.scheme)) {
        if (document.isDirty) {
          if (doDisconnect) {
            await Promise.all([
              vscode.window.showErrorMessage(`Cannot disconnect while files have not been saved.`),
              vscode.window.showTextDocument(document)
            ]);

            doDisconnect = false;
          }

        } else {
          await vscode.window.showTextDocument(document); 
          await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
        }
      }
    }

    if (doDisconnect) {
      if (instance.connection) {
        instance.connection.client.dispose();
        instance.connection = undefined;
        vscode.commands.executeCommand('setContext', 'code-for-ibmi:connected', false);
      }


      await vscode.commands.executeCommand('code-for-ibmi.refreshMemberBrowser');
      await vscode.commands.executeCommand('code-for-ibmi.refreshIFSBrowser');
      await vscode.commands.executeCommand('code-for-ibmi.refreshObjectList');
      await vscode.commands.executeCommand('code-for-ibmi.refreshDatabaseBrowser');
    }

    return doDisconnect;
  }

  /**
   * We call this after we have made a connect to the IBM i to load the rest of the plugin in.
   * @param {vscode.ExtensionContext} context
   */
  static async loadAllofExtension(context) {
    const memberBrowser = require('./views/memberBrowser');
    const qsysFs = new (require('./views/qsysFs'));
    
    const ifsBrowser = require('./views/ifsBrowser');
    const ifs = new (require('./views/ifs'));

    const objectBrowser = require('./views/objectBrowser');
    const databaseBrowser = require('./views/databaseBrowser');

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
        await Promise.all([
          vscode.commands.executeCommand('code-for-ibmi.refreshMemberBrowser'),
          vscode.commands.executeCommand('code-for-ibmi.refreshIFSBrowser'),
          vscode.commands.executeCommand('code-for-ibmi.refreshObjectList'),
          vscode.commands.executeCommand('code-for-ibmi.refreshDatabaseBrowser')
        ]);
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

        //********* Member Browser */

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

        //********* IFS Browser */

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

        //********* Object Browser */
        
        context.subscriptions.push(
          vscode.window.registerTreeDataProvider(
            'objectBrowser',
            new objectBrowser(context)
        ));
        
        context.subscriptions.push(
          vscode.window.registerTreeDataProvider(
            'databaseBrowser',
            new databaseBrowser(context)
        ));

        //********* General editing */
  
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
        

        //********* Actions */

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