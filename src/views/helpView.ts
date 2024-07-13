
import { parse } from 'path';
import vscode from 'vscode';
import IBMi from '../api/IBMi';
import { instance } from '../instantiate';
import path from 'path';
import { t } from "../locale";
import AdmZip from 'adm-zip';
import { DebugConfiguration } from '../api/debug/config';

export class HelpView implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor() {
    vscode.commands.registerCommand("code-for-ibmi.openNewIssue", openNewIssue)
    vscode.commands.registerCommand("code-for-ibmi.downloadLogs", downloadLogs)

    instance.onEvent(`connected`, () => {
      this.refresh();
    });

    instance.onEvent(`disconnected`, () => {
      this.refresh();
    });
  }

  refresh(element?: vscode.TreeItem) {
    this._onDidChangeTreeData.fire(element);
  }

  public getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  public async getChildren(): Promise<HelpItem[]> {
    const children = [
      new HelpOpenUrlItem(`book`, t(`helpView.getStarted`), `https://codefori.github.io/docs/#/`),
      new HelpOpenUrlItem(`output`, t(`helpView.officialForum`), `https://github.com/codefori/vscode-ibmi/discussions`),
      new HelpOpenUrlItem(`eye`, t(`helpView.reviewIssues`), `https://github.com/codefori/vscode-ibmi/issues/`),
      new HelpIssueItem()
    ];

    const connection = instance.getConnection();
    if (connection) {
      children.push(new HelpLogItem());
    }

    return children;
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

class HelpLogItem extends HelpItem {
  constructor() {
    super(`archive`, t(`helpView.downloadLogs`));

    this.command = {
      command: "code-for-ibmi.downloadLogs",
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

async function downloadLogs() {
  const connection = instance.getConnection();
  const config = instance.getConfig();
  const content = instance.getContent();
  const logs: any[] = [];

  if (connection && config && content) {
    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: t(`helpView.downloadLogs.gatheringLogs`),
    }, async () => {
      const codeForIBMiLog = connection.outputChannelContent;
      if (codeForIBMiLog !== undefined) {
        logs.push({
          label: t(`helpView.downloadLogs.codeForIBMiLog`),
          detail: `${connection?.currentUser}@${connection?.currentHost}`,
          picked: true,
          fileName: 'CodeForIBMi.txt',
          fileContent: Buffer.from(codeForIBMiLog, 'utf8')
        });
      }

      const debugConfig = await new DebugConfiguration().load();
      try {
        const debugServiceLogPath = `${debugConfig.getRemoteServiceWorkDir()}/DebugService_log.txt`;
        const debugServiceLog = (await content.downloadStreamfileRaw(debugServiceLogPath));
        if (debugServiceLog) {
          logs.push({
            label: t(`helpView.downloadLogs.debugServiceLog`),
            detail: debugServiceLogPath,
            picked: true,
            fileName: 'DebugService.txt',
            fileContent: debugServiceLog
          });
        }
      } catch (err) { }

      try {
        const debugServiceEclipseInstancePath = `${debugConfig.getRemoteServiceWorkDir()}/startDebugService_workspace/.metadata/.log`;
        const debugServiceEclipseInstanceLog = (await content.downloadStreamfileRaw(debugServiceEclipseInstancePath));
        if (debugServiceEclipseInstanceLog) {
          logs.push({
            label: t(`helpView.downloadLogs.debugServiceEclipseInstanceLog`),
            detail: debugServiceEclipseInstancePath,
            picked: true,
            fileName: 'DebugServiceEclipseInstance.txt',
            fileContent: debugServiceEclipseInstanceLog
          });
        }
      } catch (err) { }
    });

    if (logs.length > 0) {
      const selectedLogs = await vscode.window.showQuickPick(logs, {
        title: t(`helpView.downloadLogs.selectLogs`),
        canPickMany: true,
        matchOnDetail: true
      });

      if (selectedLogs && selectedLogs.length > 0) {
        const downloadTo = await vscode.window.showOpenDialog({
          title: t(`helpView.downloadLogs.downloadTo`),
          canSelectFolders: true,
          canSelectFiles: false,
          canSelectMany: false,
        });

        if (downloadTo) {
          const today = new Date();
          const year = today.getFullYear();
          const month = (today.getMonth() + 1).toString().padStart(2, '0');
          const day = today.getDate().toString().padStart(2, '0');
          const hours = today.getHours().toString().padStart(2, '0');
          const minutes = today.getMinutes().toString().padStart(2, '0');
          const seconds = today.getSeconds().toString().padStart(2, '0');
          const zipFile = `CodeForIBMi_${year}${month}${day}_${hours}${minutes}${seconds}.zip`;
          const downloadLocation = path.join(downloadTo[0].fsPath, zipFile);

          try {
            const zip = new AdmZip();
            for (const log of selectedLogs) {
              zip.addFile(log.fileName, log.fileContent);
            }

            const result = await zip.writeZipPromise(downloadLocation, { overwrite: false });

            if (result) {
              const result = await vscode.window.showInformationMessage(t(`helpView.downloadLogs.success`, zipFile), t(`helpView.downloadLogs.open`));
              if (result && result === t(`helpView.downloadLogs.open`)) {
                vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(downloadLocation))
              }
            } else {
              await vscode.window.showErrorMessage(t(`helpView.downloadLogs.failed`, zipFile));
            }
          } catch (error) {
            await vscode.window.showErrorMessage(t(`helpView.downloadLogs.failedMessage`, zipFile, error));
          }
        }
      }
    } else {
      await vscode.window.showErrorMessage(t(`helpView.downloadLogs.noLogs`));
    }
  } else {
    await vscode.window.showErrorMessage(t(`helpView.downloadLogs.noConnection`));
  }
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
