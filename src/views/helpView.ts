
import { parse } from 'path';
import vscode from 'vscode';
import IBMi from '../api/IBMi';
import { instance } from '../instantiate';
import { t } from "../locale";

export class HelpView {

  constructor() {
    vscode.commands.registerCommand("code-for-ibmi.openNewIssue", openNewIssue)
  }

  public getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  public async getChildren(): Promise<HelpItem[]> {
    return [
      new HelpOpenUrlItem(`book`, t(`helpView.getStarted`), `https://codefori.github.io/docs/#/`),
      new HelpOpenUrlItem(`output`, t(`helpView.officialForum`), `https://github.com/codefori/vscode-ibmi/discussions`),
      new HelpOpenUrlItem(`eye`, t(`helpView.reviewIssues`), `https://github.com/codefori/vscode-ibmi/issues/`),
      new HelpIssueItem(),
    ];
  }
}

class HelpItem extends vscode.TreeItem {
  constructor(icon: string, readonly text: string) {
    super(text, vscode.TreeItemCollapsibleState.None);

    this.contextValue = `helpItem`;
    this.iconPath = new vscode.ThemeIcon(icon);
    this.tooltip = ``;
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
    super(`bug`, t(`helpView.reportIssue`));

    this.command = {
      command: "code-for-ibmi.openNewIssue",
      title: this.text
    };
  }
}

async function openNewIssue() {
  const code4ibmi = vscode.extensions.getExtension("halcyontechltd.code-for-ibmi");
  const issue = [
    `👉🏻 Issue text goes here.`,
    ``,
    `<hr />`,
    ``,
    `⚠️ **REMOVE THIS LINE AND ANY SENSITIVE INFORMATION BELOW!** ⚠️`,
    ``,
    '|Context|Version|',
    '|-|-|',
    `|Code for IBM i version|${code4ibmi?.packageJSON.version}|`,
    `|${vscode.env.appName} version|${vscode.version}|`,
    `|Operating System|${process.platform}_${process.arch}|`,
    ``,
    getExtensions(true),
    ``,
    `<hr />`,
    ``,
    await getRemoteSection(),
  ].join(`\n`);

  let issueUrl = encodeURIComponent(issue);
  if (issueUrl.length > 8130) {
    //Empirically tested: issueUrl must not exceed 8130 characters
    if (await vscode.window.showWarningMessage("Issue data is too long. It will be truncated.", "Copy full data to clipboard")) {
      await vscode.env.clipboard.writeText(issue);
    }

    issueUrl = issueUrl.substring(0, 8130);
  }

  vscode.commands.executeCommand(`vscode.open`, `https://github.com/codefori/vscode-ibmi/issues/new?body=${issueUrl}`);
}

function getExtensions(active: boolean) {
  return createSection(
    `${active ? 'Active' : 'Disabled'} extensions`,
    `\`\`\``,
    ...vscode.extensions.all
      .filter(extension => extension.isActive === active)
      .map(extension => extension.packageJSON)
      .filter(p => p.name !== "code-for-ibmi")
      .map(p => `${p.displayName} (${p.name}): ${p.version}`)
      .sort(),
    `\`\`\``,
  );
}

async function getRemoteSection() {
  const connection = instance.getConnection();
  const config = instance.getConfig();
  const content = instance.getContent();
  if (connection && config && content) {
    return await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: `Gathering issue details...`,
    }, async progress => {
      let osVersion = {
        OS: "n/a",
        TR: "n/a"
      };
      try {
        const [osVersionRow] = await content.runSQL(
          `SELECT PTF_GROUP_TARGET_RELEASE as OS, PTF_GROUP_LEVEL AS TR ` +
          `FROM QSYS2.GROUP_PTF_INFO ` +
          `WHERE PTF_GROUP_DESCRIPTION = 'TECHNOLOGY REFRESH' AND PTF_GROUP_STATUS = 'INSTALLED' ` +
          `ORDER BY PTF_GROUP_TARGET_RELEASE, PTF_GROUP_LEVEL DESC ` +
          `LIMIT 1`
        );
        Object.assign(osVersion, osVersionRow);
      }
      catch (error) {
        console.log(`Couldn't run QSYS2.GROUP_PTF_INFO: ${error}`);
        try {
          const [osVersionRow] = await content.runSQL(`Select Substring(DATA_AREA_VALUE, 0, 7) as OS ` +
            `From TABLE(QSYS2.DATA_AREA_INFO(` +
            `DATA_AREA_NAME => 'QSS1MRI',` +
            `DATA_AREA_LIBRARY => 'QUSRSYS'))` +
            `Fetch first row only`);

            Object.assign(osVersion, osVersionRow);
        }
        catch (anotherError) {
          console.log(`Couldn't run QSYS2.DATA_AREA_INFO and read QUSRSYS/QSS1MRI: ${error}`);
        }
      }

      const ccsids = connection.getCcsids();

      return [
        createSection(`Remote system`,
          '|Setting|Value|',
          '|-|-|',
          `|IBM i OS|${osVersion?.OS || '?'}|`,
          `|Tech Refresh|${osVersion?.TR || '?'}|`,
          `|CCSID Origin|${ccsids.qccsid}|`,
          `|Runtime CCSID|${ccsids.runtimeCcsid || '?'}|`,
          `|Default CCSID|${ccsids.userDefaultCCSID || '?'}|`,
          `|SQL|${connection.enableSQL ? 'Enabled' : 'Disabled'}`,
          `|Source dates|${config.enableSourceDates ? 'Enabled' : 'Disabled'}`,
          '',
          `### Enabled features`,
          '',
          ...getRemoteFeatures(connection)
        ),
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
    });
  }
  else {
    return "**_Not connected_** 🔌";
  }
}

function getRemoteFeatures(connection: IBMi) {
  const features: Map<string, string[]> = new Map;
  Object.values(connection.remoteFeatures).forEach(feature => {
    if (feature) {
      const featurePath = parse(feature);
      let featureDir = features.get(featurePath.dir);
      if (!featureDir) {
        featureDir = [];
        features.set(featurePath.dir, featureDir);
      }
      featureDir.push(featurePath.base);
      featureDir.sort();
    }
  });

  const maxLine = Array.from(features.values()).map(e => e.length).sort((len1, len2) => len1 - len2).reverse()[0];
  const dirs = Array.from(features.keys());
  const rows = [];
  for (let i = 0; i < maxLine; i++) {
    rows.push(`|${dirs.map(dir => features.get(dir)![i] || '').join('|')}|`);
  }
  return [
    `|${dirs.join('|')}|`,
    `|${dirs.map(d => '-').join('|')}|`,
    ...rows
  ]
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
  return [
    '',
    '<details>',
    `<summary>${summary}</summary>`,
    '',
    ...details,
    `</details>`,
    ''
  ].join("\n");
}
