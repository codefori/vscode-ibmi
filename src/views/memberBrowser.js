
const vscode = require('vscode');

var instance = require('../instance');

module.exports = class memberBrowserProvider {
  /**
   * @param {vscode.ExtensionContext} context
   */
  constructor(context) {
    this.emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.emitter.event;

    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration(event => {
        let affected = event.affectsConfiguration("code-for-ibmi.sourceFileList");
        if (affected) {
          this.emitter.fire();
        }
      })
    )
  }

  /**
   * @param {vscode.TreeItem} element
   * @returns {vscode.TreeItem};
   */
  getTreeItem(element) {
    return element;
  }

  /**
   * @param {SPF?} element
   * @returns {Promise<vscode.TreeItem[]>};
   */
  async getChildren(element) {
    const content = instance.getContent();
    var items = [], item, path;

    if (element) { //Chosen SPF
      //Fetch members
      console.log(element.path);
      const [lib, spf] = element.path.split('/');

      try {
        const members = await content.getMemberList(lib, spf);

        for (const member of members) {
          path = `${member.library}/${member.file}/${member.name}.${member.extension}`;

          item = new vscode.TreeItem(`${member.name}.${member.extension}`);
          item.description = member.text;
          item.resourceUri = vscode.Uri.parse(path).with({scheme: 'member'});
          item.command = {
            command: `code-for-ibmi.openEditable`,
            title: `Open Member`,
            arguments: [path]
          };
          
          items.push(item);
        }
      } catch (e) {
        console.log(e);
        item = new vscode.TreeItem("Error loading members.");
        items = [item];
      }

    } else {
      const shortcuts = instance.getConnection().spfShortcuts;

      for (var shortcut of shortcuts) {
        shortcut = shortcut.toUpperCase();
        items.push(new SPF(shortcut, shortcut));
      }
    }

    return items;
  }
}

class SPF extends vscode.TreeItem {
  /**
   * @param {string} label 
   * @param {string} path
   */
  constructor(label, path) {
    super(label, vscode.TreeItemCollapsibleState.Collapsed);

    this.path = path;
  }
}