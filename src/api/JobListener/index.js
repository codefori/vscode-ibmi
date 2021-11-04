
const vscode = require(`vscode`);

const Configuration = require(`../Configuration`);
const IBMi = require(`../IBMi`);

const sources = require(`./sources`);

let instance = require(`../../Instance`);

let intervalID = undefined;

module.exports = class JobListener {
  static async connect() {
    const connection = instance.getConnection();
    const config = instance.getConfig();
    const db2enabled = connection.remoteFeatures.db2util;
    const user = connection.currentUser.toUpperCase();

    if (intervalID) {
      const disconnect = await vscode.window.showInformationMessage(`To reconnect you must disconnect from the existing job. Continue?`, `Yes`, `No`);
      if (disconnect === `No`) {
        return;
      } else {
        clearInterval(intervalID);
      }
    }

    const installed = await this.checkPrograms();
    if (!installed) { return; }

    let jobs = [];
    try {
      jobs = await this.findJobs(user);
    } catch (e) {
      vscode.window.showErrorMessage(`Error while initializing job listener: failed to fetch jobs for ${user}.`);
    }

    if (jobs.length > 0) {
      let job;
      if (jobs.length === 1) {
        job = jobs[0];
      } else {
        job = await vscode.window.showQuickPick(jobs, {
          placeHolder: `Select a job to connect to`,
        });
      }

      if (job) {
        vscode.window.showInformationMessage(`Listening to job ${job}.`);
        this.runner(job);
              
      } else {
        vscode.window.showInformationMessage(`No job selected.`);
      }

    } else {
      vscode.window.showErrorMessage(`Error while initializing job listener: no jobs found for ${user}.`);
    }

  }

  static async checkPrograms() {
    const connection = instance.getConnection();
    const openmbr = connection.remoteFeatures[`OPENMBR.PGM`];

    if (openmbr === undefined) {
      const install = await vscode.window.showInformationMessage(`Would you like to install the interactive job features?`, `Yes`, `No`);

      if (install === `Yes`) {
        try {
          await this.createProgram(`openmbr`);
        } catch (e) {
          vscode.window.showErrorMessage(`Error while installing interactive job features.`);
          return false;
        }
      } else {
        return false;
      }
    }

    return true;
  }

  static async createProgram(name) {
    if (sources[name]) {
      /** @type {IBMi} */
      const connection = instance.getConnection();

      const content = instance.getContent();
    
      /** @type {Configuration} */
      const config = instance.getConfig();
    
      const tempLib = config.tempLibrary;
    
      try {
        await connection.remoteCommand(`CRTSRCPF ${tempLib}/QTOOLS`, undefined)
      } catch (e) {
      //It may exist already so we just ignore the error
      }
    
      await content.uploadMemberContent(undefined, tempLib, `QTOOLS`, name, sources[name].join(`\n`));
      await connection.remoteCommand(
        `CRTBNDRPG PGM(${tempLib}/${name}) SRCFILE(${tempLib}/QTOOLS) DBGVIEW(*SOURCE) TEXT('vscode-ibmi job listener tool')`
      );
    }
  }

  /**
   * Listen to the job log of a job.
   * @param {string} job Job ID 
   */
  static async runner(job) {
    let keysRun = [];

    // The first time this is run, we want to ignore everything already in the job
    try {
      const log = await this.getJobLog(job);
      keysRun = log.map(entry => entry.key);
    } catch (e) {
      vscode.window.showErrorMessage(`Failed to start runner. Ending connection to job.`);
      return;
    }

    intervalID = setInterval(async () => {
      try {
        const log = await this.getJobLog(job);
        log.forEach(entry => {
          if (!keysRun.includes(entry.key)) {
            keysRun.push(entry.key);

            this.executeCommand(entry.message);            
          }
        });
      } catch (e) {
        vscode.window.showErrorMessage(`Error while fetching job log on connected job. Ending connection to job.`);
        clearInterval(intervalID);
      }
    }, 5000); 
  }

  /**
   * @param {string} command 
   */
  static async executeCommand(command) {
    const [c4i, type, parm] = command.split(`:`);

    if (c4i === `C4I`) {
      switch (type) {
      case `open`:
        vscode.commands.executeCommand(`code-for-ibmi.openEditable`, parm);
        break;
      }
    }
  }

  /**
   * @param {string} user
   * @returns {Promise<string[]>}
   */
  static async findJobs(user) {
    const content = instance.getContent();
    
    const jobList = await content.runSQL([
      `SELECT JOB_NAME FROM TABLE(`,
      `QSYS2.JOB_INFO(`,
      `JOB_TYPE_FILTER => '*INTERACT', JOB_STATUS_FILTER => '*ACTIVE', JOB_USER_FILTER => '${user}'`,
      `)`,
      `) x`,
    ].join(` `));

    return jobList.map(job => job.JOB_NAME);
  }

  /**
   * @param {string} job
   * @returns {Promise<{key: string, message: string}[]>}
   */
  static async getJobLog(job) {
    const content = instance.getContent();

    const sql = [
      `select char(MESSAGE_TIMESTAMP) as KEY, char(rtrim(MESSAGE_TEXT), 200) AS TEXT`,
      `from table(qsys2.joblog_info('${job}')) a`,
      `where MESSAGE_TYPE = 'INFORMATIONAL' and message_id is null`,
      `order by message_timestamp desc limit 4`,
    ].join(` `);
    const log = await content.runSQL(sql);

    return log.map(entry => {
      return {
        key: entry.KEY,
        message: entry.TEXT.trim(),
      };
    });
  }
}