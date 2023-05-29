
import vscode from 'vscode';
import IBMi from '../api/IBMi';
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
      new HelpOpenUrlItem(`book`, `Get started`, `https://halcyon-tech.github.io/vscode-ibmi/#/`),
      new HelpOpenUrlItem(`output`, `Open official Forum`, `https://github.com/halcyon-tech/vscode-ibmi/discussions`),
      new HelpOpenUrlItem(`eye`, `Review Issues`, `https://github.com/halcyon-tech/vscode-ibmi/issues/`),
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

class HelpOpenUrlItem extends HelpItem {
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

async function openNewIssue() {
  const code4ibmi = vscode.extensions.getExtension("halcyontechltd.code-for-ibmi");
  const issueUrl = [
    `Issue text goes here.`,
    ``,
    `Code for IBM i version: ${code4ibmi?.packageJSON.version}`,
    `${vscode.env.appName} version: ${vscode.version}`,
    `Platform: ${process.platform}_${process.arch}`,
    getExtensions(true),
    ``,
    await getRemoteSection(),
  ].join(`\n`);

  vscode.commands.executeCommand(`vscode.open`, `https://github.com/halcyon-tech/vscode-ibmi/issues/new?body=${encodeURIComponent(issueUrl)}`);
}

function getExtensions(active: boolean) {
  return createSection(
    `${active ? 'Active' : 'Disabled'} extensions`,
    `\`\`\``,
    ...vscode.extensions.all.filter(extension => extension.isActive === active)
      .map(extension => extension.packageJSON)
      .map(p => `${p.displayName} (${p.name}): ${p.version}`)
      .sort(),
    `\`\`\``,
  );
}

async function getRemoteSection() {
  const connection = instance.getConnection();
  const config = instance.getConfig();
  if (connection && config) {
    return [
      createSection(`Remote system`,
        `* QCCSID: ${connection?.qccsid || '?'}`,
        `* Enabled features:`,
      ...Object.keys(connection?.remoteFeatures || {}).filter(f => connection?.remoteFeatures[f]).map(f =>`  * ${f}`).sort(),
      `* SQL enabled: ${config ? config.enableSQL : '?'}`,
      `* Source dates enabled: ${config ? config.enableSourceDates : '?'}`),
      ``,
    createSection(`Shell env`, `\`\`\`bash`, ...await getEnv(connection), `\`\`\``,),
      ``,
    createSection(`Variants`,
      `\`\`\`json`,
     JSON.stringify(connection?.variantChars || {}, null, 2),
      `\`\`\``),
    ``,
    createSection(`Errors`,
      `\`\`\`json`,
      JSON.stringify(connection?.lastErrors || [], null, 2),
      `\`\`\``)
    ].join("\n");
  }
  else {
    return "*_Not connected_*";
  }
}

async function getEnv(connection: IBMi) {
  const result = await connection.runCommand({ command: "env", environment: 'pase' });
  if (result?.code === 0 && result.stdout) {
    return result.stdout.split("\n")
      .map(e => e.trim())
      .sort();
  }
  else {
    return [];
  }
}

function createSection(summary: string, ...details: string[]) {
  return ['<details>',
    `<summary>${summary}</summary>`,
    '',
    ...details,
    `</details>`
  ].join("\n");
}