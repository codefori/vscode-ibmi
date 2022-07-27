/**
 * 
 * Structurer l'objet activeJob (Cf. objectBrowser)
 * 
 * List of subsystems :
    SELECT SUBSYSTEM,
        JOB_NAME,
        JOB_STATUS
    FROM TABLE (
        QSYS2.ACTIVE_JOB_INFO(JOB_NAME_FILTER => '*SBS')
      ) A;
  
    List of job from a subsystem :
    SELECT JOB_NAME, JOB_NAME_SHORT, JOB_USER, JOB_NUMBER
    FROM TABLE (QSYS2.ACTIVE_JOB_INFO(DETAILED_INFO => 'NONE', SUBSYSTEM_LIST_FILTER => 'GIGCPC')) X
        WHERE JOB_TYPE not in ('SYS' , 'SBS')
    ORDER BY TEMPORARY_STORAGE DESC;
  
 */
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

          const paramEndjob = await EndjobUI.init(node.path.jobNameShort, node.path.jobUser, node.path.jobNumber);

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
    const connection = instance.getConnection();
    let items = [], item, jobsName = [];

    if (element) {
      // activeJob
      switch (element.contextValue) {
        case `subsystem`:

        if (connection) {
          try {
            /** @type {subsystem} */ //@ts-ignore We know what is it based on contextValue.
            const subsystem = element;
            const jobs = await content.runSQL([`SELECT JOB_NAME "jobName", JOB_NAME_SHORT "jobNameShort", JOB_USER "jobUser", JOB_NUMBER "jobNumber" FROM TABLE ( QSYS2.ACTIVE_JOB_INFO(DETAILED_INFO => 'NONE', SUBSYSTEM_LIST_FILTER => '${subsystem.path.name}')) A
            WHERE JOB_TYPE NOT IN ('SBS', 'SYS', 'RDR', 'WTR')`].join(` `));
            items = jobs.map(job => new ActiveJob(job));

          } catch (e) {
            console.log(e);
            item = new vscode.TreeItem(`Error loading jobs.`);
            vscode.window.showErrorMessage(e);
            items = [item];
          }
        }
        break;
      }
    } else {
      if (connection) {
        try {

          const objects = await content.runSQL([`SELECT SUBSYSTEM "name", SUBSYSTEM_LIBRARY_NAME "library" FROM TABLE (QSYS2.ACTIVE_JOB_INFO(JOB_NAME_FILTER => '*SBS') ) A`].join(` `));
          items = objects.map(object => new SubSystem(object));

        } catch (e) {
          console.log(e);
          item = new vscode.TreeItem(`Error loading subsystems.`);
          vscode.window.showErrorMessage(e);
          items = [item];
        }
      }

    // items = jobsName.map(jobName => new ActiveJob(jobName));
    }

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

class SubSystem extends vscode.TreeItem {
  /**
   * @param {{name: string, library: string}} subsystem
   */
  constructor(subsystem) {
    super(subsystem.name, vscode.TreeItemCollapsibleState.Collapsed);

    this.contextValue = `subsystem`;
    this.path = subsystem;
    this.description = subsystem.library;
  }
}

class ActiveJob extends vscode.TreeItem {
  /**
   * @param {{jobName: string, jobNameShort: string, jobUser: string, jobNumber: string}} activeJob
   */
  constructor(activeJob) {
    super(activeJob.jobName, vscode.TreeItemCollapsibleState.None);

    this.contextValue = `activeJob`;
    this.path = activeJob;
  }
}