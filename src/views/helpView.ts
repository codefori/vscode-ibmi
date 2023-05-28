
import vscode from 'vscode';
import {instance} from '../instantiate';

export class HelpView {
  private _extension_version: string;

  constructor(context: vscode.ExtensionContext) {
    this._extension_version = context.extension.packageJSON.version;
  }

  public getTreeItem(element : vscode.TreeItem) : vscode.TreeItem {
    return element;
  }

  public async getChildren() : Promise<HelpItem[]>{
    const connection = instance.getConnection();
    const config = instance.getConfig();

    const issueUrl = [
      `Issue text goes here.`,
      ``,
      `Code for IBM i version: ${this._extension_version}`,
      `${vscode.env.appName} version: ${vscode.version}`,
      `Platform: ${process.platform}`,
      ``,
      `* QCCSID: ${connection?.qccsid || '?'}`,
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
      `\`\`\``,
    ].join(`\n`);

    return [
      new HelpItem(`book`, `Get started`, `https://halcyon-tech.github.io/vscode-ibmi/#/`),
      new HelpItem(`output`, `Open official Forum`, `https://github.com/halcyon-tech/vscode-ibmi/discussions`),
      new HelpItem(`eye`, `Review Issues`, `https://github.com/halcyon-tech/vscode-ibmi/issues/`),
      new HelpItem(`bug`, `Report an Issue`, `https://github.com/halcyon-tech/vscode-ibmi/issues/new?body=${encodeURIComponent(issueUrl)}`),
    ];
  }
}

class HelpItem extends vscode.TreeItem {
  constructor(icon : string, text: string, url: string) {
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
