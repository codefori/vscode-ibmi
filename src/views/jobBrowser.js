
const vscode = require(`vscode`);

const { EndjobUI, ChangejobUI, HoldjobUI, ReleaseJobUI, PropertiesJobUI } = require(`../webviews/jobs`);
const HistoryJobUI = require(`../webviews/history`);

const FiltersUI = require(`../webviews/jobs/filters`);

let instance = require(`../Instance`);
const Configuration = require(`../api/Configuration`);

module.exports = class jobBrowserProvider {
  /**
   * @param {vscode.ExtensionContext} context
   */
  constructor(context) {
    this.selections = undefined;
    this.emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.emitter.event;

    context.subscriptions.push(
      vscode.commands.registerCommand(`code-for-ibmi.createJobFilter`, async (node) => {
        await FiltersUI.init(undefined);
        this.refresh();
      }),
      vscode.commands.registerCommand(`code-for-ibmi.maintainJobFilter`, async (node) => {
        await FiltersUI.init(node ? node.filter : undefined);
        this.refresh();
      }),
      vscode.commands.registerCommand(`code-for-ibmi.deleteJobFilter`, async (node) => {
        if (node) {
          const config = instance.getConfig();
          const filterName = node.filter;

          vscode.window.showInformationMessage(`Delete job filter ${filterName}?`, `Yes`, `No`).then(async (value) => {
            if (value === `Yes`) {
              const index = config.jobFilters.findIndex(filter => filter.nameFilter === filterName);

              if (index > -1) {
                config.jobFilters.splice(index, 1);
                config.set(`jobFilters`, config.jobFilters);
                this.refresh();
              }
            }
          });
        }
      }),
      vscode.commands.registerCommand(`code-for-ibmi.refreshJobBrowser`, async () => {
        this.refresh();
      }),
      vscode.commands.registerCommand(`code-for-ibmi.endJob`, async (node) => {
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
      vscode.commands.registerCommand(`code-for-ibmi.historyJob`, async (node) => {
        if (node) {
          const content = instance.getContent();
          let items = [];

          const histories = await content.runSQL([`select message_timestamp "timestamp", ifnull(message_id, '') "messageId", severity "severity", trim(message_text) "texte" from table(qsys2.joblog_info('${node.path.jobName}')) a order by ordinal_position desc`].join(` `));

          items = histories.map(history => new JobLog(history));

          await HistoryJobUI.init(items);

        }
        this.refresh();
      }),
      vscode.commands.registerCommand(`code-for-ibmi.propertiesJob`, async (node) => {
        if (node) {
          const content = instance.getContent();
          let items = [];

          const properties = await content.runSQL([`SELECT IFNULL(x.job_name, ''), `
            + ` IFNULL(x.job_status, '') "jobStatus",`
            + ` IFNULL(x.job_user, '') "currentUser",`
            + ` IFNULL(x.job_type_enhanced, '') "typeEnhanced",`
            + ` IFNULL(x.job_entered_system_time, '0001-01-01 00:00:00') "enteredSystemTime",`
            + ` IFNULL(x.job_active_time, '0001-01-01 00:00:00') "activeTime",`
            + ` x.job_description_library CONCAT '/' CONCAT x.job_description "jobDescription",`
            + ` IFNULL(x.submitter_job_name, '') "submitterJobName",`
            + ` x.output_queue_library concat '/' concat x.output_queue_name "outputQueue",`
            + ` ifnull(x.date_format, '') "dateFormat",`
            + ` ifnull(x.date_separator, '') "dateSeparator",`
            + ` ifnull(x.time_separator, '') "timeSeparator",`
            + ` ifnull(x.decimal_format, '') "decimalFormat",`
            + ` ifnull(x.language_id, '') "languageID",`
            + ` ifnull(x.country_id, '') "countryID",`
            + ` ifnull(x.sort_sequence_name, '') "sortSequence",`
            + ` x.ccsid "ccsid"`
            + ` FROM TABLE (QSYS2.JOB_INFO()) X`
            + ` where x.job_name = '${node.path.jobName}' LIMIT 1`].join(` `));

          items = properties.map(propertie => new PropertiesLog(propertie));

          await PropertiesJobUI.init(items[0]);

        }
      }),
      vscode.commands.registerCommand(`code-for-ibmi.changeJob`, async (node) => {
        if (node) {

          const paramChgjob = await ChangejobUI.init(node.path.jobNameShort, node.path.jobUser, node.path.jobNumber);

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
      vscode.commands.registerCommand(`code-for-ibmi.holdJob`, async (node) => {
        if (node) {

          const paramHldjob = await HoldjobUI.init(node.path.jobNameShort, node.path.jobUser, node.path.jobNumber);

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
      vscode.commands.registerCommand(`code-for-ibmi.releaseJob`, async (node) => {
        if (node) {

          const paramRlsjob = await ReleaseJobUI.init(node.path.jobNameShort, node.path.jobUser, node.path.jobNumber);

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
    const config = instance.getConfig();

    let items = [], item, whereClause = '' , filterClause = '';
    
    if (element) {
      let filter;

      switch (element.contextValue) {
        case `jobFilter`:

          /** @type {JobFilter} */ //@ts-ignore We know what is it based on contextValue.
          const jobFilter = element;

          filter = config.jobFilters.find(filter => filter.nameFilter === jobFilter.filter);

          if (filter.jobNumberFilter != '*' && filter.jobNumberFilter.length > 0) {
            whereClause += ` AND JOB_NUMBER like '${filter.jobNumberFilter}'`;
          }

          if (filter.profileFilter != '*' && filter.profileFilter.length > 0) {
            whereClause += ` AND AUTHORIZATION_NAME like '${filter.profileFilter}'`;
          }

          // Don't want to search all and not blank
          if (filter.jobNameFilter != '*' && filter.jobNameFilter.length > 0) {
            if (filter.jobNameFilter.search('[*]')) {
              // Joker
              whereClause += ` AND JOB_NAME_SHORT like '${filter.jobNameFilter.replace('*', '%')}'`;
            } else {
              // Exact search
              filterClause += ` , JOB_NAME_FILTER => '${filter.jobNameFilter}'`;
            }
          }

          // Don't want to search all and not blank
          if (filter.subsystemFilter != '*' && filter.subsystemFilter.length > 0) {
            if (filter.subsystemFilter.search('[*]')) {
              // Joker
              whereClause += ` AND SUBSYSTEM like '${filter.subsystemFilter.replace('*', '%')}'`;
            } else {
              // Exact search
              filterClause += ` , SUBSYSTEM_LIST_FILTER => '${filter.subsystemFilter}'`;
            }
          }

          // Don't want to search all and not blank
          if (filter.jobUserFilter != '*' && filter.jobUserFilter.length > 0) {
            if (filter.jobUserFilter.search('[*]')) {
              // Joker
              whereClause += ` AND JOB_USER like '${filter.jobUserFilter.replace('*', '%')}'`;
            } else {
              // Exact search
              whereClause += ` AND JOB_USER = '${filter.jobUserFilter}'`;
              // filterClause += ` , CURRENT_USER_LIST_FILTER => '${filter.jobUser}'`;
            }
          }

          if (connection) {
            try {
              const subSystems = await content.runSQL([`SELECT SUBSYSTEM "name" FROM TABLE (QSYS2.ACTIVE_JOB_INFO(DETAILED_INFO => 'NONE' ${filterClause} )) A
              WHERE JOB_TYPE NOT IN ('SBS', 'SYS', 'RDR', 'WTR') ${whereClause} group by SUBSYSTEM order by SUBSYSTEM`].join(` `));
              items = subSystems.map(subSystem => new SubSystem(filter.nameFilter, subSystem));

            } catch (e) {
              console.log(e);
              item = new vscode.TreeItem(`Error loading jobs.`);
              vscode.window.showErrorMessage(e);
              items = [item];
            }
          }
          break;

        case `subsystem`:

          /** @type {SubSystem} */ //@ts-ignore We know what is it based on contextValue.
          const subSystem = element;

          filter = config.jobFilters.find(filter => filter.nameFilter === subSystem.filter);

          if (filter.jobNumberFilter != '*' && filter.jobNumberFilter.length > 0) {
            whereClause += ` AND JOB_NUMBER like '${filter.jobNumberFilter}'`;
          }

          if (filter.profileFilter != '*' && filter.profileFilter.length > 0) {
            whereClause += ` AND AUTHORIZATION_NAME like '${filter.profileFilter}'`;
          }

          // Don't want to search all and not blank
          if (filter.jobNameFilter != '*' && filter.jobNameFilter.length > 0) {
            if (filter.jobNameFilter.search('[*]')) {
              // Joker
              whereClause += ` AND JOB_NAME_SHORT like '${filter.jobNameFilter.replace('*', '%')}'`;
            } else {
              // Exact search
              filterClause += ` , JOB_NAME_FILTER => '${filter.jobNameFilter}'`;
            }
          }

          filterClause += ` , SUBSYSTEM_LIST_FILTER => '${subSystem.path}'`;

          // Don't want to search all and not blank
          if (filter.jobUserFilter != '*' && filter.jobUserFilter.length > 0) {
            if (filter.jobUserFilter.search('[*]')) {
              // Joker
              whereClause += ` AND JOB_USER like '${filter.jobUserFilter.replace('*', '%')}'`;
            } else {
              // Exact search
              whereClause += ` AND JOB_USER = '${filter.jobUserFilter}'`;
            }
          }

          if (connection) {
            try {
              const jobs = await content.runSQL([`SELECT JOB_NAME "jobName", JOB_NAME_SHORT "jobNameShort", JOB_USER "jobUser", JOB_NUMBER "jobNumber" FROM TABLE (QSYS2.ACTIVE_JOB_INFO(DETAILED_INFO => 'NONE' ${filterClause} )) A
              WHERE JOB_TYPE NOT IN ('SBS', 'SYS', 'RDR', 'WTR') ${whereClause} order by SUBSYSTEM, JOB_NAME_SHORT`].join(` `));
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
      const connection = instance.getConnection();

      if (connection) {
        const jobFilters = config.jobFilters;

        if (jobFilters.length > 0) {
          items = jobFilters.map(filter => new JobFilter(filter));
        } else {
          items = [getNewFilter()]
        }
      }
    }

    return items;
  }

  /**
   *
   * @param {string} path
   * @param {string[]} list
   */
  storeJobBrowser(path, list) {
    const storage = instance.getStorage();
    const existingDirs = storage.get(`jobBrowser`);

    existingDirs[path] = list;

    return storage.set(`jobBrowser`, existingDirs);
  }
}

const getNewFilter = () => {
  const item = new vscode.TreeItem(`Create new job filter..`);

  item.iconPath = new vscode.ThemeIcon(`add`);
  item.command = {
    command: `code-for-ibmi.maintainJobFilter`,
    title: `Create new job filter`
  };

  return item;
}

class JobFilter extends vscode.TreeItem {
  /**
   * @param {{nameFilter: string, jobNameFilter: string, jobUserFilter: string, jobNumberFilter: string, profileFilter: string, subsystemFilter: string}} jobFilter
   */
  constructor(jobFilter) {
    super(jobFilter.nameFilter, vscode.TreeItemCollapsibleState.Collapsed);

    this.contextValue = `jobFilter`;
    this.description = `${jobFilter.jobNumberFilter}/${jobFilter.jobUserFilter}/${jobFilter.jobNameFilter} (profil: ${jobFilter.profileFilter} - subsystem: ${jobFilter.subsystemFilter})`;
    this.filter = jobFilter.nameFilter;
  }
}

class SubSystem extends vscode.TreeItem {
  /**
   * @param {string} filter Filter name
   * @param {{name: string, library: string}} subsystem
   */
  constructor(filter, subsystem) {
    super(subsystem.name, vscode.TreeItemCollapsibleState.Collapsed);

    this.filter = filter;
    this.contextValue = `subsystem`;
    this.path = subsystem.name;
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

class PropertiesLog {
  /**
   * @param {{jobStatus: string, currentUser: string, typeEnhanced: string, enteredSystemTime: string, activeTime: string, jobDescription: string, submitterJobName: string, outputQueue: string, dateFormat: string, dateSeparator: string, timeSeparator: string, decimalFormat: string, languageID: string, countryID: string, sortSequence: string, ccsid: number}} propertiesLog
   */
  constructor(propertiesLog) {
    this.jobStatus = propertiesLog.jobStatus;
    this.currentUser = propertiesLog.currentUser;
    this.typeEnhanced = propertiesLog.typeEnhanced;
    this.enteredSystemTime = propertiesLog.enteredSystemTime;
    this.activeTime = propertiesLog.activeTime;
    this.jobDescription = propertiesLog.jobDescription;
    this.submitterJobName = propertiesLog.submitterJobName;
    this.outputQueue = propertiesLog.outputQueue;
    this.dateFormat = propertiesLog.dateFormat;
    this.dateSeparator = propertiesLog.dateSeparator;
    this.timeSeparator = propertiesLog.timeSeparator;
    this.decimalFormat = propertiesLog.decimalFormat;
    this.languageID = propertiesLog.languageID;
    this.countryID = propertiesLog.countryID;
    this.sortSequence = propertiesLog.sortSequence;
    this.ccsid = propertiesLog.ccsid;
  }
}