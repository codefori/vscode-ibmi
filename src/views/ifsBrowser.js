
const { throws } = require('assert');
const vscode = require('vscode');

var instance = require('../Instance');

module.exports = class ifsBrowserProvider {
  /**
   * @param {vscode.ExtensionContext} context
   */
  constructor(context) {
    this.emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.emitter.event;

    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration(event => {
        let affected = event.affectsConfiguration("code-for-ibmi.homeDirectory");
        if (affected) {
          this.refresh();
        }
      }),

      vscode.commands.registerCommand(`code-for-ibmi.refreshIFSBrowser`, async () => {
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
   * @param {Object?} element
   * @returns {Promise<vscode.TreeItem[]>};
   */
  async getChildren(element) {
    const connection = instance.getConnection();
    const content = instance.getContent();
    var items = [], item;

    if (element) { //Chosen SPF
      //Fetch members
      console.log(element.path);

      try {
        const objects = await content.getFileList(element.path);

        for (const object of objects) {
          items.push(new Object(object.type, object.name, object.path));
        }

      } catch (e) {
        console.log(e);
        item = new vscode.TreeItem("Error loading members.");
        vscode.window.showErrorMessage(e);
        items = [item];
      }

    } else {
      const objects = await content.getFileList(connection.homeDirectory);

      for (var object of objects) {
        items.push(new Object(object.type, object.name, object.path));
      }
    }

    return items;
  }
}

class Object extends vscode.TreeItem {
  /**
   * @param {"directory"|"streamfile"} type 
   * @param {string} label 
   * @param {string} path
   */
  constructor(type, label, path) {
    super(label);

    this.contextValue = type;
    this.path = path;

    if (type === 'directory') {
      this.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
    } else {
      this.resourceUri = vscode.Uri.parse(path).with({scheme: 'streamfile'});
      this.command = {
        command: `code-for-ibmi.openEditable`,
        title: `Open Streamfile`,
        arguments: [path]
      };
    }
  }
}