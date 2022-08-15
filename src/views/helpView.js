
const vscode = require(`vscode`);
const Instance = require(`../Instance`);

module.exports = class helpView {
  /**
   * @param {vscode.TreeItem} element
   * @returns {vscode.TreeItem};
   */
  getTreeItem(element) {
    return element;
  }

  /**
   * @returns {Promise<HelpItem[]>};
   */
  async getChildren() {
    const connection = Instance.getConnection();
    const config = Instance.getConfig();

    const issueUrl = [
      `Issue text goes here.`,
      ``,
      `* QCCSID: ${connection.qccsid}`,
      `* Features:`,
      ...Object.keys(connection.remoteFeatures).map(
        (feature) => `   * ${feature}: ${connection.remoteFeatures[feature] !== undefined}`
      ),
      `* SQL enabled: ${config.enableSQL}`,
      `* Source dates enabled: ${config.enableSourceDates}`,
      ``,
      `Variants`,
      `\`\`\`json`,
      JSON.stringify(connection.variantChars, null, 2),
      `\`\`\``,
      ``,
      `Errors:`,
      `\`\`\`json`,
      JSON.stringify(connection.lastErrors, null, 2),
      `\`\`\``,
    ].join(`\n`);

    const items = [
      new HelpItem(`book`, `Get started`, `https://halcyon-tech.github.io/vscode-ibmi/#/`),
      new HelpItem(`output`, `Open official Forum`, `https://github.com/halcyon-tech/vscode-ibmi/discussions`),
      new HelpItem(`eye`, `Review Issues`, `https://github.com/halcyon-tech/vscode-ibmi/issues/`),
      new HelpItem(`bug`, `Report an Issue`, `https://github.com/halcyon-tech/vscode-ibmi/issues/new?body=${encodeURIComponent(issueUrl)}`),
    ];

    return items;
  }
}

class HelpItem extends vscode.TreeItem {
  constructor(icon, text, url) {
    super(text, vscode.TreeItemCollapsibleState.None);

    this.contextValue = `hitSource`;
    
    this.iconPath = new vscode.ThemeIcon(icon);

    this.command = {
      command: `vscode.open`,
      title: text,
      arguments: [vscode.Uri.parse(url)]
    };
  }
}
