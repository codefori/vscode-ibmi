
import vscode from 'vscode';
import { instance } from '../instantiate';

export class HelpView {

  constructor() {
    vscode.commands.registerCommand("code-for-ibmi.openNewIssue", openNewIssue)
  }

  public getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  public async getChildren(): Promise<HelpItem[]> {
    return [
      new HelpOpenUrkItem(`book`, `Get started`, `https://halcyon-tech.github.io/vscode-ibmi/#/`),
      new HelpOpenUrkItem(`output`, `Open official Forum`, `https://github.com/halcyon-tech/vscode-ibmi/discussions`),
      new HelpOpenUrkItem(`eye`, `Review Issues`, `https://github.com/halcyon-tech/vscode-ibmi/issues/`),
      new HelpIssueItem(),
    ];
  }
}

class HelpItem extends vscode.TreeItem {
  constructor(icon: string, readonly text: string) {
    super(text, vscode.TreeItemCollapsibleState.None);

    this.contextValue = `helpItem`;
    this.iconPath = new vscode.ThemeIcon(icon);
  }
}

class HelpOpenUrkItem extends HelpItem {
  constructor(icon: string, text: string, url: string) {
    super(icon, text);

    this.command = {
      command: `vscode.open`,
      title: text,
      arguments: [vscode.Uri.parse(url)]
    };
  }
}

class HelpIssueItem extends HelpItem {
  constructor() {
    super(`bug`, `Report an Issue`);

    this.command = {
      command: "code-for-ibmi.openNewIssue",
      title: this.text
    };
  }
}

function openNewIssue() {
  const code4ibmi = vscode.extensions.getExtension("halcyontechltd.code-for-ibmi");
  const issueUrl = [
    `Issue text goes here.`,
    ``,
    `Code for IBM i version: ${code4ibmi?.packageJSON.version}`,
    `${vscode.env.appName} version: ${vscode.version}`,
    `Platform: ${process.platform}`,
    ``,
    getRemoteSection(),
  ].join(`\n`);

  vscode.commands.executeCommand(`vscode.open`, `https://github.com/halcyon-tech/vscode-ibmi/issues/new?body=${encodeURIComponent(issueUrl)}`);
}

function getRemoteSection() {
  const connection = instance.getConnection();
  const config = instance.getConfig();
  if (connection && config) {
    return [`* QCCSID: ${connection?.qccsid || '?'}`,
      `* Features:`,
    ...Object.keys(connection?.remoteFeatures || {}).map(
      (feature) => `   * ${feature}: ${connection?.remoteFeatures[feature] !== undefined}`
    ),
    `* SQL enabled: ${config ? config.enableSQL : '?'}`,
    `* Source dates enabled: ${config ? config.enableSourceDates : '?'}`,
      ``,
      `Variants`,
      `\`\`\`json`,
    JSON.stringify(connection?.variantChars || {}, null, 2),
      `\`\`\``,
      ``,
      `Errors:`,
      `\`\`\`json`,
    JSON.stringify(connection?.lastErrors || [], null, 2),
      `\`\`\``].join("\n");
  }
  else {
    return "*_Not connected_*";
  }
}