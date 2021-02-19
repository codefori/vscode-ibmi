const IBMi = require("./api/IBMi");
const IBMiContent = require("./api/IBMiContent");

const vscode = require('vscode');

module.exports = class {
  static setConnection(conn) {
    instance.connection = conn;
    instance.content = new IBMiContent(instance.connection);
  };

  static getConnection() {return instance.connection};
  static getContent() {return instance.content};

  //We call this after we have made a connect to the IBM i to load the rest of the plugin in.
  static loadAllofExtension() {
    const memberBrowser = require('./views/memberBrowser');

    if (instance.connection) {
      vscode.window.registerTreeDataProvider(
        'memberBrowser',
        new memberBrowser()
      );

      vscode.workspace.registerTextDocumentContentProvider('member', {
        async provideTextDocumentContent(uri) {
          const [library, file, fullName] = uri.path.split('/');
          let name = fullName.substring(0, fullName.lastIndexOf('.'));
          
          const content = instance.content.downloadMemberContent(undefined, library, file, name);
          
          return content;
        }
      });

      vscode.workspace.registerTextDocumentContentProvider('streamfile', {
        async provideTextDocumentContent(uri) {
          const [library, file, fullName] = uri.path.split('/');
          let name = fullName.substring(0, fullName.lastIndexOf('.'));
          
          const content = instance.content.downloadMemberContent(undefined, library, file, name);
          
          return content;
        }
      });

      vscode.commands.registerCommand('ibmi-code.openEditable', async (path) => {
        console.log('hi', path);
        if (path.startsWith('/')) {
          //IFS
        } else {
          let uri = vscode.Uri.parse(`member:${path.toLowerCase()}`);
          let doc = await vscode.workspace.openTextDocument(uri); // calls back into the provider
          await vscode.window.showTextDocument(doc, { preview: false });
        }
      });
    }
  }
};

var instance = {
  /** @type {IBMi} */
  connection: undefined,
  /** @type {IBMiContent} */
  content: undefined, //IBM
};