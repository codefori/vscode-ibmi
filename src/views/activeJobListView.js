
const vscode = require(`vscode`);

// const EndjobUI = require(`../webviews/endjob`);
const { EndjobUI, ChgjobUI, HldjobUI, RlsjobUI } = require(`../webviews/jobs`);
const HistoryJobUI = require(`../webviews/history`);

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

          if (paramEndjob !== undefined) {
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
      }),
      vscode.commands.registerCommand(`code-for-ibmi.HistoryJob`, async (node) => {
        if (node) {
          const content = instance.getContent();
          const connection = instance.getConnection();
          let items = [];

          const histories = await content.runSQL([`select message_timestamp "timestamp", ifnull(message_id, '') "messageId", severity "severity", trim(message_text) "texte" from table(qsys2.joblog_info('${node.path.jobName}')) a order by ordinal_position desc`].join(` `));

          items = histories.map(history => new JobLog(history));

          await HistoryJobUI.init(items);

        }
        this.refresh();
      }),
      vscode.commands.registerCommand(`code-for-ibmi.ChgJob`, async (node) => {
        if (node) {

          const paramChgjob = await ChgjobUI.init(node.path.jobNameShort, node.path.jobUser, node.path.jobNumber);

          if (paramChgjob !== undefined) {
            const connection = instance.getConnection();

            let chgjobCommand = `CHGJOB JOB(${paramChgjob.jobnumber}/${paramChgjob.jobuser}/${paramChgjob.jobname})`;

            if (paramChgjob.JOBPTY != '*SAME') {
              chgjobCommand += ` JOBPTY(${paramChgjob.JOBPTY})`;
            }
            if (paramChgjob.OUTPTY != '*SAME') {
              chgjobCommand += ` OUTPTY(${paramChgjob.OUTPTY})`;
            }
            if (paramChgjob.PRTDEV != '*SAME') {
              chgjobCommand += ` PRTDEV(${paramChgjob.PRTDEV})`;
            }
            if (paramChgjob.OUTQ != '*SAME') {
              chgjobCommand += ` OUTQ(${paramChgjob.OUTQ})`;
            }
            if (paramChgjob.RUNPTY != '*SAME') {
              chgjobCommand += ` RUNPTY(${paramChgjob.RUNPTY})`;
            }
            if (paramChgjob.JOBQ != '*SAME') {
              chgjobCommand += ` JOBQ(${paramChgjob.JOBQ})`;
            }
            if (paramChgjob.PRTTXT != '*SAME') {
              chgjobCommand += ` PRTTXT(${paramChgjob.PRTTXT})`;
            }
            if (paramChgjob.LOG != '*SAME') {
              chgjobCommand += ` LOG(${paramChgjob.LOG})`;
            }
            if (paramChgjob.LOGCLPGM != '*SAME') {
              chgjobCommand += ` LOGCLPGM(${paramChgjob.LOGCLPGM})`;
            }
            if (paramChgjob.LOGOUTPUT != '*SAME') {
              chgjobCommand += ` LOGOUTPUT(${paramChgjob.LOGOUTPUT})`;
            }
            if (paramChgjob.JOBMSGQFL != '*SAME') {
              chgjobCommand += ` JOBMSGQFL(${paramChgjob.JOBMSGQFL})`;
            }
            if (paramChgjob.INQMSGRPY != '*SAME') {
              chgjobCommand += ` INQMSGRPY(${paramChgjob.INQMSGRPY})`;
            }
            if (paramChgjob.BRKMSG != '*SAME') {
              chgjobCommand += ` BRKMSG(${paramChgjob.BRKMSG})`;
            }
            if (paramChgjob.STSMSG != '*SAME') {
              chgjobCommand += ` STSMSG(${paramChgjob.STSMSG})`;
            }
            if (paramChgjob.DDMCNV != '*SAME') {
              chgjobCommand += ` DDMCNV(${paramChgjob.DDMCNV})`;
            }
            if (paramChgjob.SCDDATE != '*SAME') {
              chgjobCommand += ` SCDDATE(${paramChgjob.SCDDATE})`;
            }
            if (paramChgjob.SCDTIME != '*SAME') {
              chgjobCommand += ` SCDTIME(${paramChgjob.SCDTIME})`;
            }
            if (paramChgjob.DATE != '*SAME') {
              chgjobCommand += ` DATE(${paramChgjob.DATE})`;
            }
            if (paramChgjob.DATFMT != '*SAME') {
              chgjobCommand += ` DATFMT(${paramChgjob.DATFMT})`;
            }
            if (paramChgjob.DATSEP != '*SAME') {
              chgjobCommand += ` DATSEP(${paramChgjob.DATSEP})`;
            }
            if (paramChgjob.TIMSEP != '*SAME') {
              chgjobCommand += ` TIMSEP(${paramChgjob.TIMSEP})`;
            }
            if (paramChgjob.SWS != '*SAME') {
              chgjobCommand += ` SWS(${paramChgjob.SWS})`;
            }
            if (paramChgjob.TIMESLICE != '*SAME') {
              chgjobCommand += ` TIMESLICE(${paramChgjob.TIMESLICE})`;
            }
            if (paramChgjob.PURGE != '*SAME') {
              chgjobCommand += ` PURGE(${paramChgjob.PURGE})`;
            }
            if (paramChgjob.DFTWAIT != '*SAME') {
              chgjobCommand += ` DFTWAIT(${paramChgjob.DFTWAIT})`;
            }
            if (paramChgjob.DEVRCYACN != '*SAME') {
              chgjobCommand += ` DEVRCYACN(${paramChgjob.DEVRCYACN})`;
            }
            if (paramChgjob.TSEPOOL != '*SAME') {
              chgjobCommand += ` TSEPOOL(${paramChgjob.TSEPOOL})`;
            }
            if (paramChgjob.PRTKEYFMT != '*SAME') {
              chgjobCommand += ` PRTKEYFMT(${paramChgjob.PRTKEYFMT})`;
            }
            if (paramChgjob.SRTSEQ != '*SAME') {
              chgjobCommand += ` SRTSEQ(${paramChgjob.SRTSEQ})`;
            }
            if (paramChgjob.LANGID != '*SAME') {
              chgjobCommand += ` LANGID(${paramChgjob.LANGID})`;
            }
            if (paramChgjob.CNTRYID != '*SAME') {
              chgjobCommand += ` CNTRYID(${paramChgjob.CNTRYID})`;
            }
            if (paramChgjob.CCSID != '*SAME') {
              chgjobCommand += ` CCSID(${paramChgjob.CCSID})`;
            }
            if (paramChgjob.DECFMT != '*SAME') {
              chgjobCommand += ` DECFMT(${paramChgjob.DECFMT})`;
            }
            if (paramChgjob.CHRIDCTL != '*SAME') {
              chgjobCommand += ` CHRIDCTL(${paramChgjob.CHRIDCTL})`;
            }
            if (paramChgjob.SPLFACN != '*SAME') {
              chgjobCommand += ` SPLFACN(${paramChgjob.SPLFACN})`;
            }
            if (paramChgjob.WLCGRP != '*SAME') {
              chgjobCommand += ` WLCGRP(${paramChgjob.WLCGRP})`;
            }
            if (paramChgjob.CPUTIME != '*SAME') {
              chgjobCommand += ` CPUTIME(${paramChgjob.CPUTIME})`;
            }
            if (paramChgjob.MAXTMPSTG != '*SAME') {
              chgjobCommand += ` MAXTMPSTG(${paramChgjob.MAXTMPSTG})`;
            }
            if (paramChgjob.PRCRSCPTY != '*SAME') {
              chgjobCommand += ` PRCRSCPTY(${paramChgjob.PRCRSCPTY})`;
            }
            if (paramChgjob.DUPJOBOPT != '*SAME') {
              chgjobCommand += ` DUPJOBOPT(${paramChgjob.DUPJOBOPT})`;
            }

            try {

              await connection.remoteCommand(chgjobCommand);

              vscode.window.showInformationMessage(`Job ${paramChgjob.jobname}/${paramChgjob.jobuser}/${paramChgjob.jobnumber} changed.`);
              this.refresh();

            } catch (e) {
              vscode.window.showErrorMessage(`Error changing job! ${e}`);
            }
          }

        }
        this.refresh();
      }),
      vscode.commands.registerCommand(`code-for-ibmi.HldJob`, async (node) => {
        if (node) {

          const paramHldjob = await HldjobUI.init(node.path.jobNameShort, node.path.jobUser, node.path.jobNumber);

          if (paramHldjob !== undefined) {
            const connection = instance.getConnection();

            try {
              await connection.remoteCommand(`HLDJO JOB(${paramHldjob.jobnumber}/${paramHldjob.jobuser}/${paramHldjob.jobname}) SPLFILE(${paramHldjob.SPLFILE}) DUPJOBOPT(${paramHldjob.DUPJOBOPT})`);

              vscode.window.showInformationMessage(`Job ${paramHldjob.jobname}/${paramHldjob.jobuser}/${paramHldjob.jobnumber} hold.`);
              this.refresh();

            } catch (e) {
              vscode.window.showErrorMessage(`Error holding job! ${e}`);
            }
          }

        }
        this.refresh();
      }),
      vscode.commands.registerCommand(`code-for-ibmi.RlsJob`, async (node) => {
        if (node) {

          const paramRlsjob = await RlsjobUI.init(node.path.jobNameShort, node.path.jobUser, node.path.jobNumber);

          if (paramRlsjob !== undefined) {
            const connection = instance.getConnection();

            try {
              await connection.remoteCommand(`HLDJOB JOB(${paramRlsjob.jobnumber}/${paramRlsjob.jobuser}/${paramRlsjob.jobname}) DUPJOBOPT(${paramRlsjob.DUPJOBOPT})`);

              vscode.window.showInformationMessage(`Job ${paramRlsjob.jobname}/${paramRlsjob.jobuser}/${paramRlsjob.jobnumber} release.`);
              this.refresh();

            } catch (e) {
              vscode.window.showErrorMessage(`Error releasing job! ${e}`);
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
    // @TODO: Manage filter (memory JOB_NAME_SHORT, JOB_USER, JOB_NUMBER, SUBSYSTEM)
    const filters = [{ name: 'My active job', type: 'my' }, { name: 'All active job', type: 'all' }]
    let items = [], item;

    if (element) {
      // activeJob
      switch (element.contextValue) {
        // Display active job in subsystem
        case `subsystem`:

          if (connection) {
            try {
              /** @type {subsystem} */ //@ts-ignore We know what is it based on contextValue.
              const subsystem = element;
              const jobs = await content.runSQL([`SELECT JOB_NAME "jobName", JOB_NAME_SHORT "jobNameShort", JOB_USER "jobUser", JOB_NUMBER "jobNumber" FROM TABLE ( QSYS2.ACTIVE_JOB_INFO(DETAILED_INFO => 'NONE', SUBSYSTEM_LIST_FILTER => '${subsystem.path}')) A
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

        case `jobFilter`:

          /** @type {JobFilter} */ //@ts-ignore We know what is it based on contextValue.
          const jobFilter = element;

          switch (jobFilter.path) {
            // Display my active job in all subsystem
            case 'my':

              if (connection) {
                try {
                  const jobs = await content.runSQL([`SELECT JOB_NAME "jobName", JOB_NAME_SHORT "jobNameShort", JOB_USER "jobUser", JOB_NUMBER "jobNumber", JOB_SUBSYSTEM "jobSubsystem" FROM TABLE (QSYS2.JOB_INFO()) A
              WHERE JOB_TYPE NOT IN ('SBS', 'SYS', 'RDR', 'WTR') AND JOB_STATUS = 'ACTIVE' order by JOB_SUBSYSTEM, JOB_NAME_SHORT`].join(` `));
                  items = jobs.map(job => new MyActiveJob(job));

                } catch (e) {
                  console.log(e);
                  item = new vscode.TreeItem(`Error loading my jobs.`);
                  vscode.window.showErrorMessage(e);
                  items = [item];
                }
              }
              break;

            case 'all':
              // Display all subsystem
              if (connection) {
                try {
                  const jobs = await content.runSQL([`SELECT SUBSYSTEM "name", SUBSYSTEM_LIBRARY_NAME "library" FROM TABLE ( QSYS2.ACTIVE_JOB_INFO(DETAILED_INFO => 'NONE')) A
                WHERE JOB_TYPE = 'SBS' order by SUBSYSTEM`].join(` `));
                  items = jobs.map(job => new SubSystem(job));

                } catch (e) {
                  console.log(e);
                  item = new vscode.TreeItem(`Error loading jobs.`);
                  vscode.window.showErrorMessage(e);
                  items = [item];
                }
              }
              break;

          }
          break;
      }
    } else {
      // Display filters
      items = filters.map(filter => new JobFilter(filter));
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

class JobFilter extends vscode.TreeItem {
  /**
   * @param {{name: string, type: string}} jobFilter
   */
  constructor(jobFilter) {
    super(jobFilter.name, vscode.TreeItemCollapsibleState.Collapsed);

    this.contextValue = `jobFilter`;
    this.path = jobFilter.type;
  }
}

class SubSystem extends vscode.TreeItem {
  /**
   * @param {{name: string, library: string}} subsystem
   */
  constructor(subsystem) {
    super(subsystem.name, vscode.TreeItemCollapsibleState.Collapsed);

    this.contextValue = `subsystem`;
    this.path = subsystem.name;
    this.description = subsystem.library;
  }
}

class MyActiveJob extends vscode.TreeItem {
  /**
   * @param {{jobName: string, jobNameShort: string, jobUser: string, jobNumber: string, jobSubsystem: string}} myActiveJob
   */
  constructor(myActiveJob) {
    super(myActiveJob.jobName, vscode.TreeItemCollapsibleState.None);

    this.contextValue = `myActiveJob`;
    this.path = myActiveJob;
    this.description = myActiveJob.jobSubsystem;
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

class JobLog {
  /**
   * @param {{timestamp: string, messageId: string, severity: number, texte: string}} jobLog
   */
  constructor(jobLog) {
    this.timestamp = jobLog.timestamp;
    this.messageId = jobLog.messageId;
    this.severity = jobLog.severity;
    this.texte = jobLog.texte;
  }
}