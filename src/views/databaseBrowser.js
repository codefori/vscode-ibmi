
const { throws } = require('assert');
const vscode = require('vscode');

var instance = require('../Instance');
const {Database, Table, Column} = require('./databaseFs');

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
    var items = [], item;

    if (element) { 

      if (element instanceof SchemaItem) {
        const objects = await Database.getObjects(element.path);
        items.push(...objects.map(object => new TableItem(object)));
      } else 
      
      if (element instanceof TableItem) {
        console.log(element.table.columns);
      }

    } else {
      const connection = instance.getConnection();
      if (connection) {
        if (connection.remoteFeatures.db2util) {
          const libraries = connection.libraryList;

          for (var library of libraries) {
            items.push(new SchemaItem(library));
          }
        } else {
          items.push(new vscode.TreeItem("'db2util' not installed on system.", vscode.TreeItemCollapsibleState.None));
        }
      }
    }
    return items;
  }
}



class SchemaItem extends vscode.TreeItem {
  constructor(name) {
    super(name.toLowerCase(), vscode.TreeItemCollapsibleState.Collapsed);

    this.contextValue = 'schema';
    this.path = name;
  }
}

class TableItem extends vscode.TreeItem {
  /**
   * @param {Table} table 
   */
  constructor(table) {
    super(table.name.toLowerCase(), vscode.TreeItemCollapsibleState.Collapsed);

    /** @type {Table} */
    this.table = table;
    this.description = table.text;
  }
}