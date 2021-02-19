const vscode = require('vscode');

module.exports = class memberBrowserProvider {
  /**
   * @param {string} workspaceRoot 
   */
  constructor(workspaceRoot) {
    this.workspaceRoot = workspaceRoot;
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
    if (element) { //Chosen SPF
      //Fetch members
    } else {
      var item;
      var items = [];
      
      item = new SPF("QSYSINC/H", {path: "QSYSINC/H", recordLength: 80});
      item.tooltip = "A source physical file";
      item.description = "A source physical file with source members in";

      items.push(item);

      return items;
    }
  }
}

class SPF extends vscode.TreeItem {
  /**
   * @param {string} label 
   * @param {{path: string, recordLength: number}} info
   */
  constructor(label, info) {
    super(label, vscode.TreeItemCollapsibleState.Collapsed);

    this.path = info.path;
    this.recordLength = info.recordLength;
  }
}