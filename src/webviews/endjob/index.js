const vscode = require(`vscode`);

const { CustomUI, Field } = require(`../../api/CustomUI`);

let instance = require(`../../Instance`);

module.exports = class EndjobUI {

    /**
     * @param {string} jobname
     * @param {string} jobuser
     * @param {string} jobnumber
     */
    static async init(jobname, jobuser, jobnumber) {
        let ui = new CustomUI();

        if (jobname && jobuser && jobnumber) {

            let field;

            field = new Field(`input`, `jobname`, `Job name`);
            field.default = jobname;
            field.description = `Specify the name of the job.`;
            field.readonly = true;
            ui.addField(field);

            field = new Field(`input`, `jobuser`, `User`);
            field.default = jobuser;
            field.description = `Specify the user name that identifies the user profile under which the job is run.`
            field.readonly = true;
            ui.addField(field);

            field = new Field(`input`, `jobnumber`, `Number`);
            field.default = jobnumber;
            field.description = `Specify the system-assigned job number. <br><i>(000000-999999)</i>`;
            field.readonly = true;
            ui.addField(field);

            field = new Field(`select`, `option`, `How to end (OPTION)`);
            // field.default = `*CNTRLD`;
            field.description = `Specifies whether the job ends immediately or in a controlled manner that lets the application program perform end-of-job processing. In either case, the system performs certain job cleanup processing.<br/><b><u>*CNTRLD</u></b>, *IMMED`;
            field.items = [
                {
                    selected: true,
                    value: `*CNTRLD`,
                    text: `The job ends in a controlled manner. This allows the program running to perform cleanup (end-of-job processing). When a job being ended has a signal handling procedure for the asynchronous signal SIGTERM, the SIGTERM signal is generated for that job. The application has the amount of time specified on the DELAY parameter to complete cleanup before the job is ended.`,
                    description: `*CNTRLD`,
                },
                {
                    selected: false,
                    value: `*IMMED`,
                    text: `The job ends immediately and the system performs end-of-job cleanup. System cleanup can take from a brief amount of time to several minutes. When a job being ended has a signal handling procedure for the asynchronous signal SIGTERM, the SIGTERM signal is generated for that job and the QENDJOBLMT system value specifies the time limit. Other than by handling the SIGTERM signal, the program that is running is not allowed to perform any cleanup.`,
                    description: `*IMMED`,
                }
            ]
            ui.addField(field);

            field = new Field(`input`, `delay`, `Controlled end delay time (DELAY)`);
            field.default = `30`;
            field.description = `Specifies the amount of time (in seconds) allowed for the job to complete its cleanup processing during a controlled end. If the cleanup is not completed before the end of the delay time, the job is ended immediately. (Only system cleanup is performed.)<br><i>1-999999</i>`;
            ui.addField(field);

            field = new Field(`select`, `splfile`, `Delete spooled files (SPLFILE)`);
            field.description = `Specifies whether spooled output files created by this job are kept for normal processing or deleted. Regardless of whether the spooled files are deleted, the job logs are kept.<br/><b><u>*NO</u></b>, *YES`;
            field.items = [
                {
                    selected: true,
                    value: `*NO`,
                    text: `The spooled output files created by the job being ended are kept for normal processing by a writer. When the job ends, the spooled file action (SPLFACN) job attribute determines whether spooled files are detached from the job or kept with the job.`,
                    description: `*NO`,
                },
                {
                    selected: false,
                    value: `*YES`,
                    text: `The spooled output files created by the job being ended and which are on output queues in the library name space of the thread issuing this command are deleted. The job log is not deleted. If the job has already ended and the spooled file action for the job is to detach the spooled files, the End Job (ENDJOB) command will not find the job and the spooled files will not be deleted.`,
                    description: `*YES`,
                }
            ]
            ui.addField(field);

            field = new Field(`input`, `loglmt`, `Maximum log entries (LOGLMT)`);
            field.default = `*SAME`;
            field.description = `Specifies the maximum number of entries in the message queue of the job being ended that are written to the job log. This parameter can be used to limit the number of messages written to the job log printer file, QPJOBLOG, for a job that ends.<br/>
        <b><i>*SAME</i></b>: The message logging limit does not change. If the logging limit does not change for this job on a previous command, *NOMAX is the value used by the system.<br/><b><i>*NOMAX</i></b>: There is no limit to the number of messages logged; all messages on the job message queue are written to the job log.<br/><b><i>integer-number</i></b>: Specify the maximum number of messages that can be written to the job log.`;
            ui.addField(field);

            field = new Field(`select`, `adlintjobs`, `Additional interactive jobs (ADLINTJOBS)`);
            field.description = `Specifies whether the additional interactive jobs associated with the job specified in the <b>Job name (JOB)</b> parameter are ended.<br/><b><u>*NONE</u></b>, *GRPJOB, *ALL`;
            field.items = [
                {
                    selected: true,
                    value: `*NONE`,
                    text: `Only the job specified in the JOB parameter is ended.`,
                    description: `*NONE`,
                },
                {
                    selected: false,
                    value: `*GRPJOB`,
                    text: `If the job specified in the JOB parameter is a group job, all group jobs associated with the group are ended. If the job is not a group job, the job specified in the JOB parameter is ended.`,
                    description: `*GRPJOB`,
                },
                {
                    selected: false,
                    value: `*ALL`,
                    text: `All interactive jobs running on the workstation associated with the job specified in the JOB parameter are ended. This includes group jobs and secondary jobs.`,
                    description: `*ALL`,
                }
            ]
            ui.addField(field);

            field = new Field(`select`, `dupjobopt`, `Duplicate job option (DUPJOBOPT)`);
            field.description = `Specifies the action taken when duplicate jobs are found by this command. <br/><b><u>*SELECT</u></b>, *MSG`;
            field.items = [
                {
                    selected: true,
                    value: `*SELECT`,
                    text: `The selection display is shown when duplicate jobs are found during an interactive session. Otherwise, a message is issued.`,
                    description: `*SELECT`,
                },
                {
                    selected: false,
                    value: `*MSG`,
                    text: `A message is issued when duplicate jobs are found.`,
                    description: `*MSG`,
                }
            ]
            ui.addField(field);

            field = new Field(`submit`, `save`, `End job`);
            ui.addField(field);

        } else {
            // @TODO: Do something
        }

        let { panel, data } = await ui.loadPage(`Arrêter un travail (ENDJOB)`);

        if (data) {
            panel.dispose();
            return data;
        } else {
            return;
        }
    }

}