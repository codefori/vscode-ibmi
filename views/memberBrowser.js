
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
    var items = [], item;

    if (element) { //Chosen SPF
      //Fetch members
      console.log(element.path);
      const [lib, spf] = element.path.split('/');

      try {
        const members = await content.getMemberList(lib, spf);

        for (const member of members) {
          item = new vscode.TreeItem(`${member.name}.${member.extension.toLowerCase()}`);
          item.resourceUri = vscode.Uri.parse(`member:///${member.library}/${member.file}/${member.name}.${member.extension}`);
          items.push(item);
        }
      } catch (e) {
        console.log(e);
        item = new vscode.TreeItem("Error loading members.");
        items = [item];
      }

    } else {
      //Load list of chosen SPFs here
      
      item = new SPF("QSYSINC/H", "QSYSINC/H");
      item.tooltip = "A source physical file";
      //item.description = "A source physical file with source members in";

      items.push(item);
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