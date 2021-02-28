
const vscode = require('vscode');

var instance = require('../Instance');

module.exports = class databaseBrowserProvider {
  /**
   * @param {vscode.ExtensionContext} context
   */
  constructor(context) {
    this.emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.emitter.event;

    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration(event => {
        let affected = event.affectsConfiguration("code-for-ibmi.libraryList");
        if (affected) {
          this.refresh();
        }
      }),

      vscode.commands.registerCommand(`code-for-ibmi.refreshDatabaseBrowser`, async () => {
        this.refresh();
      })
    )
  }

  refresh() {
    this.emitter.fire();
  }

  /**
   * @param {vscode.TreeItem} element
   * @returns {vscode.TreeItem};
   */
  getTreeItem(element) {
    return element;
  }

  /**
   * @param {vscode.TreeItem?} element
   * @returns {Promise<vscode.TreeItem[]>};
   */
  async getChildren(element) {
    const content = instance.getContent();
    var items = [], item;

    if (element) { 
      
    } else {
      const connection = instance.getConnection();
      if (connection) {
        const libraries = connection.libraryList;

        for (var library of libraries) {
          library = library.toUpperCase();
          items.push(new SPF(shortcut, shortcut));
        }
      }
    }
    return items;
  }
}
