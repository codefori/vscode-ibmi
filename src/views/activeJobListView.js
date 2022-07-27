
const vscode = require(`vscode`);

const EndjobUI = require(`../webviews/endjob`);

let instance = require(`../Instance`);

module.exports = class activeJobListProvider {
  /**
   * @param {vscode.ExtensionContext} context
   */
  constructor(context) {
    this.selections = undefined;
    this.emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.emitter.event;

    context.subscriptions.push(
      vscode.commands.registerCommand(`code-for-ibmi.refreshActiveJobListView`, async () => {
        this.refresh();
      }),
      vscode.commands.registerCommand(`code-for-ibmi.EndJob`, async (node) => {
        if (node) {

          const paramEndjob = await EndjobUI.init(node.path.JOB_NAME_SHORT, node.path.JOB_USER, node.path.JOB_NUMBER);

          if (paramEndjob !== null) {
            const connection = instance.getConnection();

            try {
              await connection.remoteCommand(
                `ENDJOB JOB(${paramEndjob.jobnumber}/${paramEndjob.jobuser}/${paramEndjob.jobname}) OPTION(${paramEndjob.option}) DELAY(${paramEndjob.delay}) SPLFILE(${paramEndjob.splfile}) LOGLMT(${paramEndjob.loglmt}) ADLINTJOBS(${paramEndjob.adlintjobs}) DUPJOBOPT(${paramEndjob.dupjobopt})`,
              );

              vscode.window.showInformationMessage(`Job ${paramEndjob.jobname}/${paramEndjob.jobuser}/${paramEndjob.jobnumber} ended.`);
              this.refresh();

            } catch (e) {
              vscode.window.showErrorMessage(`Error ending job! ${e}`);
            }
          }

        }
        this.refresh();
      })
    )
  }

  refresh() {
    this.emitter.fire();
  }

  /**
   * @param {vscode.TreeItem} element
   * @returns {vscode.TreeItem};
   */
  getTreeItem(element) {
    return element;
  }

  /**
   * @param {vscode.TreeItem} element
   * @returns {Promise<vscode.TreeItem[]>};
   */
  async getChildren(element) {
    const content = instance.getContent();
    // const config = instance.getConfig();
    const connection = instance.getConnection();
    let items = [], item, jobsName = [];

    if (connection) {
      try {
        jobsName = await content.runSQL([`SELECT JOB_NAME, JOB_NAME_SHORT, JOB_USER, JOB_NUMBER FROM TABLE ( QSYS2.JOB_INFO() ) A
        WHERE JOB_TYPE NOT IN ('SBS', 'SYS', 'RDR', 'WTR')
          AND JOB_STATUS = 'ACTIVE'`].join(` `));

      } catch (e) {
        console.log(e);
        item = new vscode.TreeItem(`Error loading active job.`);
        vscode.window.showErrorMessage(e);
        items = [item];
      }

    }

    items = jobsName.map(jobName => new ActiveJob(jobName));

    return items;
  }

  /**
   *
   * @param {string} path
   * @param {string[]} list
   */
  storeActiveJobList(path, list) {
    const storage = instance.getStorage();
    const existingDirs = storage.get(`activeJobList`);

    existingDirs[path] = list;

    return storage.set(`activeJobList`, existingDirs);
  }
}

class ActiveJob extends vscode.TreeItem {
  /**
   * @param {string} activeJob
   */
  constructor(activeJob) {
    super(activeJob["JOB_NAME"].toUpperCase(), vscode.TreeItemCollapsibleState.None);

    this.contextValue = `activeJob`;
    this.path = activeJob;
  }
}