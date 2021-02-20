
const vscode = require('vscode');

var instance = require('../instance');

module.exports = class memberBrowserProvider {
  constructor() {
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

          item = new vscode.TreeItem(`${member.name.toLowerCase()}.${member.extension.toLowerCase()}`);
          item.description = member.text;
          item.resourceUri = vscode.Uri.parse(path).with({scheme: 'member'});
          item.command = {
            command: `ibmi-code.openEditable`,
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
      //Load list of chosen SPFs here
      items.push(new SPF("QSYSINC/H", "QSYSINC/H"));
      items.push(new SPF("BARRY/QRPGLESRC", "BARRY/QRPGLESRC"));
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