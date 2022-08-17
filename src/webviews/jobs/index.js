const vscode = require(`vscode`);

const { CustomUI, Field } = require(`../../api/CustomUI`);

let instance = require(`../../Instance`);

/**
 * End Job
 */
class EndjobUI {

    /**
     * @param {string} jobname
     * @param {string} jobuser
     * @param {string} jobnumber
     */
    static async init(jobname, jobuser, jobnumber) {
        let ui = new CustomUI();

        if (jobname && jobuser && jobnumber) {

            let field;

            field = new Field(`paragraph`, `description`, `<h1>End Job (ENDJOB)</h1>
            <a href="https://www.ibm.com/docs/en/i/7.4?topic=ssw_ibm_i_74/cl/endjob.htm">Online Help (IBM)</a>`);
            ui.addField(field);

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

        let { panel, data } = await ui.loadPage(`End Job (ENDJOB)`);

        if (data) {
            panel.dispose();
            return data;
        } else {
            return;
        }
    }

}

/**
 * Change job
 */
class ChangejobUI {

    /**
     * @param {string} jobname
     * @param {string} jobuser
     * @param {string} jobnumber
     */
    static async init(jobname, jobuser, jobnumber) {
        let ui = new CustomUI();

        if (jobname && jobuser && jobnumber) {

            let field;

            field = new Field(`paragraph`, `description`, `<h1>Change Job (CHGJOB)</h1>
            <a href="https://www.ibm.com/docs/en/i/7.4?topic=ssw_ibm_i_74/cl/chgjob.htm">Online Help (IBM)</a>`);
            ui.addField(field);

            field = new Field(`input`, `jobname`, `Job name`);
            field.default = jobname;
            field.description = `Specify the name of the job.`;
            field.readonly = true;
            ui.addField(field);

            field = new Field(`input`, `jobuser`, `User`);
            field.default = jobuser;
            field.description = `Specify the name of the user profile under which the job is run.`
            field.readonly = true;
            ui.addField(field);

            field = new Field(`input`, `jobnumber`, `Number`);
            field.default = jobnumber;
            field.description = `Specify the job number assigned by the system. <br><i>(000000-999999)</i>`;
            field.readonly = true;
            ui.addField(field);

            field = new Field(`input`, `JOBPTY`, `Job priority (on JOBQ)`);
            field.default = `*SAME`;
            field.description = `Specifies the scheduling priority used for the job being changed. Valid values range from 0 through 9, where 0 is the highest priority and 9 is the lowest priority.<br><b><i>*SAME</i></b><i>1-9</i>`;
            ui.addField(field);            

            field = new Field(`input`, `OUTPTY`, `Output priority (on OUTQ)`);
            field.default = `*SAME`;
            field.description = `Specifies the output priority for spooled output files that are produced by this job. The highest priority is 1 and the lowest priority is 9.<br><b><i>*SAME</i></b><i>1-9</i>`;
            ui.addField(field);            

            field = new Field(`input`, `PRTDEV`, `Print device`);
            field.default = `*SAME`;
            field.description = `Specifies the default printer device for this job.<br><b><i>*SAME</i></b><i>*USRPRF</i><i>*SYSVAL</i><i>*WRKSTN</i>`;
            ui.addField(field);            

            field = new Field(`input`, `OUTQ`, `Output queue + Library`);
            field.default = `*SAME`;
            field.description = `Specifies the output queue used for spooled files that specify OUTQ(*JOB). This parameter applies only to printer files that have *JOB specified for the OUTQ parameter.<br><b><i>*SAME</i></b><i>*USRPRF</i><i>*DEV</i><i>*WRKSTN</i>`;
            ui.addField(field);            

            field = new Field(`input`, `RUNPTY`, `Run priority`);
            field.default = `*SAME`;
            field.description = `Specifies the run priority for the job. Run priority is a value, ranging from 1 (highest priority) through 99 (lowest priority), that represents the priority at which the job competes for the processing unit relative to other jobs that are active at the same time. This value represents the relative (not the absolute) importance of the job. <br><b><i>*SAME</i></b><i>1-99</i>`;
            ui.addField(field);            

            field = new Field(`input`, `JOBQ`, `Job queue + Library`);
            field.default = `*SAME`;
            field.description = `Specifies the job queue in which this job is placed.<br><b><i>*SAME</i></b>`;
            ui.addField(field);            

            field = new Field(`input`, `PRTTXT`, `Print text`);
            field.default = `*SAME`;
            field.description = `Specifies the text that is printed at the bottom of each page of printed output and on separator pages.<br><b><i>*SAME</i></b><i>*SYSVAL</i><i>*BLANK</i><i>character-value</i>`;
            ui.addField(field);            

            field = new Field(`input`, `LOG`, `Message logging`);
            field.default = `*SAME`;
            field.description = `Specifies the message logging values used to determine the amount and type of information sent to the job log by this job. This parameter has three elements: the message (or logging) level, the message severity, and the level of message text. If no values are specified on this parameter, the values are not changed.<br><b><i>*SAME</i></b><i>0-4</i>`;
            ui.addField(field);            

            
            field = new Field(`select`, `LOGCLPGM`, `Log CL program commands`);
            field.description = `Specifies whether the commands that are run in a control language program are logged to the job log by way of the CL program's message queue. This parameter sets the status of the job's logging flag. `;
            field.items = [
                {
                    selected: true,
                    value: `*SAME`,
                    text: `The current state of the job's logging flag does not change.`,
                    description: `*SAME`,
                },
                {
                    selected: false,
                    value: `*NO`,
                    text: `Commands that come later in a CL program are not written to the job log.`,
                    description: `*NO`,
                },
                {
                    selected: false,
                    value: `*YES`,
                    text: `Commands that come later in a CL program, and are capable of being written, are logged to the job log.`,
                    description: `*YES`,
                }
            ]
            ui.addField(field);   

            field = new Field(`select`, `LOGOUTPUT`, `Job log output`);
            field.description = `Specifies how the job log will be produced when the job completes. This does not affect job logs produced when the message queue is full and the job message queue full action specifies *PRTWRAP. `;
            field.items = [
                {
                    selected: true,
                    value: `*SAME`,
                    text: `The value does not change.`,
                    description: `*SAME`,
                },
                {
                    selected: false,
                    value: `*SYSVAL`,
                    text: `The value specified in the system value QLOGOUTPUT is used.`,
                    description: `*SYSVAL`,
                },
                {
                    selected: false,
                    value: `*JOBLOGSVR`,
                    text: `The job log will be produced by a job log server. For more information about job log servers, refer to the Start Job Log Server (STRLOGSVR) command.`,
                    description: `*JOBLOGSVR`,
                },
                {
                    selected: false,
                    value: `*JOBEND`,
                    text: `The job log will be produced by the job itself. If the job cannot produce its own job log, the job log will be produced by a job log server. For example, a job does not produce its own job log when the system is processing a Power Down System (PWRDWNSYS) command.`,
                    description: `*JOBEND`,
                },
                {
                    selected: false,
                    value: `*PND`,
                    text: `The job log will not be produced. The job log remains pending until removed.`,
                    description: `*PND`,
                }
            ]
            ui.addField(field);            

            field = new Field(`select`, `JOBMSGQFL`, `Job message queue full action`);
            field.description = `Specifies the action that should be taken when the job message queue is full.`;
            field.items = [
                {
                    selected: true,
                    value: `*SAME`,
                    text: `The job message queue full option does not change.`,
                    description: `*SAME`,
                },
                {
                    selected: false,
                    value: `*SYSVAL`,
                    text: `The value specified for the QJOBMSGQFL system value is used.`,
                    description: `*SYSVAL`,
                },
                {
                    selected: false,
                    value: `*NOWRAP`,
                    text: `The message queue does not wrap when it is full. This action ends the job.`,
                    description: `*NOWRAP`,
                },
                {
                    selected: false,
                    value: `*WRAP`,
                    text: `The message queue wraps to the start of the message queue when full and starts filling the message queue again.`,
                    description: `*WRAP`,
                },
                {
                    selected: false,
                    value: `*PRTWRAP`,
                    text: `The message queue wraps the job message queue when full and prints the messages that are being overlaid because of wrapping.`,
                    description: `*PRTWRAP`,
                }
            ]
            ui.addField(field);            

            field = new Field(`select`, `INQMSGRPY`, `Inquiry message reply`);
            field.description = `Specifies the way that predefined messages that are sent as a result of running this job are answered. `;
            field.items = [
                {
                    selected: true,
                    value: `*SAME`,
                    text: `The method to use for inquiry message replies does not change.`,
                    description: `*SAME`,
                },
                {
                    selected: false,
                    value: `*RQD`,
                    text: `A reply is required by the receiver of the inquiry message for inquiry messages that are sent during the running of this job.`,
                    description: `*RQD`,
                },
                {
                    selected: false,
                    value: `*DFT`,
                    text: `The default message reply is used to answer any inquiry messages issued during the running of this job.`,
                    description: `*DFT`,
                },
                {
                    selected: false,
                    value: `*SYSRPYL`,
                    text: `The system reply list is checked to see if there is an entry for any inquiry message issued as a result of running this job. If a match occurs, the reply value in that entry is used. If no entry exists for that inquiry message, a reply is required.`,
                    description: `*SYSRPYL`,
                }
            ]
            ui.addField(field);            

            field = new Field(`select`, `BRKMSG`, `Break message handling`);
            field.description = `Specifies how break messages are handled for the job. This is determined by the status of the message queue, the message queue severity, and the setting of this value.`;
            field.items = [
                {
                    selected: true,
                    value: `*SAME`,
                    text: `Break message handling does not change.`,
                    description: `*SAME`,
                },
                {
                    selected: false,
                    value: `*NORMAL`,
                    text: `Break message handling is determined by the message queue status.`,
                    description: `*NORMAL`,
                },
                {
                    selected: false,
                    value: `*NOTIFY`,
                    text: `An audible alarm sounds to indicate the presence of a message. *NOTIFY is allowed only for interactive jobs.`,
                    description: `*NOTIFY`,
                },
                {
                    selected: false,
                    value: `*HOLD`,
                    text: `Neither break messages, or messages sent to a signed-on work station through the Send Break Message (SNDBRKMSG) command, are shown for message queues in *BREAK delivery mode. The alarm does not sound for messages sent to message queues in *NOTIFY delivery mode. The user break message handling program is not started.`,
                    description: `*HOLD`,
                }
            ]
            ui.addField(field);            

            field = new Field(`select`, `STSMSG`, `Status message`);
            field.description = `Specifies how status messages are handled for the job.`;
            field.items = [
                {
                    selected: true,
                    value: `*SAME`,
                    text: `Status message handling does not change.`,
                    description: `*SAME`,
                },
                {
                    selected: false,
                    value: `*USRPRF`,
                    text: `When the job being changed is the job in which this command is running, the status message handling is obtained from the user profile under which this thread was initially running. When the job being changed is a different job, the status message handling is obtained from the current user profile associated with that job.`,
                    description: `*USRPRF`,
                },
                {
                    selected: false,
                    value: `*SYSVAL`,
                    text: `Status messages are shown or not shown as specified in the QSTSMSG system value.`,
                    description: `*SYSVAL`,
                },
                {
                    selected: false,
                    value: `*NONE`,
                    text: `Status messages are not shown.`,
                    description: `*NONE`,
                },
                {
                    selected: false,
                    value: `*NORMAL`,
                    text: `Status messages are shown. Text on the bottom line of the display is lost.`,
                    description: `*NORMAL`,
                }
            ]
            ui.addField(field);            

            field = new Field(`select`, `DDMCNV`, `DDM conversation`);
            field.description = `Specifies whether the connections using distributed data management (DDM) protocols remain active when they are not being used.`;
            field.items = [
                {
                    selected: true,
                    value: `*SAME`,
                    text: `The current state of the job's DDM conversation attribute does not change.`,
                    description: `*SAME`,
                },
                {
                    selected: false,
                    value: `*KEEP`,
                    text: `The system keeps DDM conversation connections active when there are no users`,
                    description: `*KEEP`,
                },
                {
                    selected: false,
                    value: `*DROP`,
                    text: `The system ends a DDM-allocated conversation when there are no users. Examples include when an application closes a DDM file, or when a DRDA application runs an SQL DISCONNECT statement.`,
                    description: `*DROP`,
                }
            ]
            ui.addField(field);            

            field = new Field(`input`, `SCDDATE`, `Schedule date`);
            field.default = `*SAME`;
            field.description = `Specifies the date on which the submitted job becomes eligible to run.<br><b><i>*SAME</i></b><i>*CURRENT</i><i>*MONTHSTR</i><i>*MONTHEND</i><i>*MON</i><i>*TUE</i><i>*WED</i><i>*THU</i><i>*FRI</i><i>*SAT</i><i>*SUN</i><i>date</i>`;
            ui.addField(field);               

            field = new Field(`input`, `SCDTIME`, `Schedule time`);
            field.default = `*SAME`;
            field.description = `Specifies the time on the scheduled date at which the job becomes eligible to run.<br><b><i>*SAME</i></b><i>*CURRENT</i><i>time</i>`;
            ui.addField(field);               

            field = new Field(`input`, `DATE`, `Job date`);
            field.default = `*SAME`;
            field.description = `Specifies the date that is assigned to the job. The job date remains the same for the duration of the job, unless it is changed by the user.<br><b><i>*SAME</i></b><i>date</i>`;
            ui.addField(field);               

            field = new Field(`select`, `DATFMT`, `Date format`);
            field.description = `Specifies the format used for the date.`;
            field.items = [
                {
                    selected: true,
                    value: `*SAME`,
                    text: `The date format used does not change.`,
                    description: `*SAME`,
                },
                {
                    selected: false,
                    value: `*SYSVAL`,
                    text: `The system value, QDATFMT, is used.`,
                    description: `*SYSVAL`,
                },
                {
                    selected: false,
                    value: `*YMD`,
                    text: `The date format used is year, month, and day.`,
                    description: `*YMD`,
                },
                {
                    selected: false,
                    value: `*MDY`,
                    text: `The date format used is month, day, and year.`,
                    description: `*MDY`,
                },
                {
                    selected: false,
                    value: `*DMY`,
                    text: `The date format used is day, month, year.`,
                    description: `*DMY`,
                },
                {
                    selected: false,
                    value: `*JUL`,
                    text: `The date format used is Julian.
                    `,
                    description: `*JUL`,
                }
            ]
            ui.addField(field);    

            field = new Field(`select`, `DATSEP`, `Date separator`);
            field.description = `Specifies the date separator used for the date.`;
            field.items = [
                {
                    selected: true,
                    value: `*SAME`,
                    text: `The date separator does not change.`,
                    description: `*SAME`,
                },
                {
                    selected: false,
                    value: `*SYSVAL`,
                    text: `The system value for the date separator is used.`,
                    description: `*SYSVAL`,
                },
                {
                    selected: false,
                    value: `*BLANK`,
                    text: `A blank is used for the date separator.`,
                    description: `*BLANK`,
                },
                {
                    selected: false,
                    value: `/`,
                    text: `A slash (/) is used for the date separator.`,
                    description: `/`,
                },
                {
                    selected: false,
                    value: `-`,
                    text: `A dash (-) is used for the date separator.`,
                    description: `-`,
                },
                {
                    selected: false,
                    value: `.`,
                    text: `A period (.) is used for the date separator.`,
                    description: `.`,
                },
                {
                    selected: false,
                    value: ` `,
                    text: `A blank is used for the date separator.`,
                    description: ` `,
                },
                {
                    selected: false,
                    value: `,`,
                    text: `A comma (,) is used for the date separator.`,
                    description: `,`,
                }
            ]
            ui.addField(field);    

            field = new Field(`select`, `TIMSEP`, `Time separator`);
            field.description = `Specifies the time separator used for the job.`;
            field.items = [
                {
                    selected: true,
                    value: `*SAME`,
                    text: `The time separator does not change.`,
                    description: `*SAME`,
                },
                {
                    selected: false,
                    value: `*SYSVAL`,
                    text: `The time separator specified in the system value QTIMSEP is used.`,
                    description: `*SYSVAL`,
                },
                {
                    selected: false,
                    value: `*BLANK`,
                    text: `A blank is used for the time separator.`,
                    description: `*BLANK`,
                },
                {
                    selected: false,
                    value: `:`,
                    text: `A colon (:) is used for the time separator.`,
                    description: `:`,
                },
                {
                    selected: false,
                    value: `.`,
                    text: `A period (.) is used for the time separator.`,
                    description: `.`,
                },
                {
                    selected: false,
                    value: ` `,
                    text: `A blank is used for the time separator.`,
                    description: ` `,
                },
                {
                    selected: false,
                    value: `,`,
                    text: `A comma (,) is used for the time separator.`,
                    description: `,`,
                }
            ]
            ui.addField(field);    

            field = new Field(`input`, `SWS`, `Job switches`);
            field.default = `*SAME`;
            field.description = `Specifies the switch settings for a group of eight job switches that are used with the job. These switches can be set or tested in a CL program and used to control the flow of the program. The only valid values for each 1-digit switch are 0 (off), 1 (on), or X. The X indicates that a switch value does not change.<br><b><i>*SAME</i></b><i>character-value</i>`;
            ui.addField(field);

            field = new Field(`input`, `TIMESLICE`, `Time slice`);
            field.default = `*SAME`;
            field.description = `Specifies the maximum amount of processor time (in milliseconds) given to each thread in the job before other threads in this job and in other jobs are given an opportunity to run. The time slice establishes the amount of time needed by a thread in the job to accomplish a meaningful amount of processing. At the end of the time slice, the thread might be put in an inactive state so that other threads can become active in the storage pool.<br><b><i>*SAME</i></b><i>1-9999999</i>`;
            ui.addField(field);

            field = new Field(`select`, `PURGE`, `Eligible for purge`);
            field.description = `Specifies whether the job is eligible to be moved out of main storage and put into auxiliary storage at the end of a time slice or when entering a long wait (such as waiting for a work station user's response). This attribute is ignored when more than one thread is active within the job.`;
            field.items = [
                {
                    selected: true,
                    value: `*SAME`,
                    text: `The value specified for the purge option does not change.`,
                    description: `*SAME`,
                },
                {
                    selected: false,
                    value: `*YES`,
                    text: `The job is eligible to be moved out of main storage and put into auxiliary storage. However, a job with multiple threads is never purged from main storage.`,
                    description: `*YES`,
                },
                {
                    selected: false,
                    value: `*NO`,
                    text: `The job is not eligible to be moved out of main storage and put into auxiliary storage. However, when main storage is needed, pages belonging to a thread in this job may be moved to auxiliary storage. Then, when a thread in this job runs again, its pages are returned to main storage as they are needed.`,
                    description: `*NO`,
                }
            ]
            ui.addField(field);   

            field = new Field(`input`, `DFTWAIT`, `Default wait time`);
            field.default = `*SAME`;
            field.description = `Specifies the default maximum time (in seconds) that a thread in the job waits for a system instruction, such as the LOCK machine interface (MI) instruction, to acquire a resource.<br><b><i>*SAME</i></b><i>*NOMAX</i><i>1-999999</i>`;
            ui.addField(field);

            field = new Field(`select`, `DEVRCYACN`, `Device recovery action`);
            field.description = `Specifies the recovery action to take for the job when an I/O error is encountered on the *REQUESTER device for interactive jobs. This parameter can be specified only for interactive jobs.`;
            field.items = [
                {
                    selected: true,
                    value: `*SAME`,
                    text: `The work station recovery action does not change.`,
                    description: `*SAME`,
                },
                {
                    selected: false,
                    value: `*SYSVAL`,
                    text: `The value in the system value, QDEVRCYACN, is used as the device recovery action for this job.`,
                    description: `*SYSVAL`,
                },
                {
                    selected: false,
                    value: `*MSG`,
                    text: `The application program requesting the I/O operation receives an error message indicating the I/O operation has failed.`,
                    description: `*MSG`,
                },
                {
                    selected: false,
                    value: `*DSCMSG`,
                    text: `The job is automatically disconnected. When the job is reconnected, it receives an error message indicating that an I/O error has occurred but the device has been recovered. Although the device has been recovered, the contents of the display prior to the error must be shown again.`,
                    description: `*DSCMSG`,
                },
                {
                    selected: false,
                    value: `*DSCENDRQS`,
                    text: `The job is automatically disconnected. Once it is reconnected, the ENDRQS command is issued specifying the previous request processor. If there is no request processor, an error message is issued.`,
                    description: `*DSCENDRQS`,
                },
                {
                    selected: false,
                    value: `*ENDJOB`,
                    text: `The job is ended with the *IMMED option. A job log is produced for the job.`,
                    description: `*ENDJOB`,
                },
                {
                    selected: false,
                    value: `*ENDJOBNOLIST`,
                    text: `The job is ended with the *IMMED option. No job log is produced for the job.`,
                    description: `*ENDJOBNOLIST`,
                }
            ]
            ui.addField(field);   

            field = new Field(`select`, `TSEPOOL`, `Time slice end pool`);
            field.description = `Specifies whether threads in interactive jobs should be moved to another main storage pool when they reach the time slice end. When a long wait occurs, the thread is moved back to the pool in which it was originally running.`;
            field.items = [
                {
                    selected: true,
                    value: `*SAME`,
                    text: `The value for the time slice end pool does not change.`,
                    description: `*SAME`,
                },
                {
                    selected: false,
                    value: `*SYSVAL`,
                    text: `The value in the system value, QTSEPOOL, at the time the CHGJOB command is issued is used as the time slice end pool action for this job.`,
                    description: `*SYSVAL`,
                },
                {
                    selected: false,
                    value: `*NONE`,
                    text: `A thread in the job is not moved when it reaches the end of its time slice.`,
                    description: `*NONE`,
                },
                {
                    selected: false,
                    value: `*BASE`,
                    text: `A thread in the job is moved to the base pool when it reaches the end of its time slice.`,
                    description: `*BASE`,
                }
            ]
            ui.addField(field);   

            field = new Field(`select`, `PRTKEYFMT`, `Print key format`);
            field.description = `Specifies whether border and header information is printed when the print key is pressed.`;
            field.items = [
                {
                    selected: true,
                    value: `*SAME`,
                    text: `The value specified for this parameter does not change.`,
                    description: `*SAME`,
                },
                {
                    selected: false,
                    value: `*SYSVAL`,
                    text: `The value specified on the system value QPRTKEYFMT determines whether header or border information is printed.`,
                    description: `*SYSVAL`,
                },
                {
                    selected: false,
                    value: `*NONE`,
                    text: `Border information and header information are not printed.`,
                    description: `*NONE`,
                },
                {
                    selected: false,
                    value: `*PRTBDR`,
                    text: `Border information is printed.`,
                    description: `*PRTBDR`,
                },
                {
                    selected: false,
                    value: `*PRTHDR`,
                    text: `Header information is printed.`,
                    description: `*PRTHDR`,
                },
                {
                    selected: false,
                    value: `*PRTALL`,
                    text: `Border information and header information are printed.
                    `,
                    description: `*PRTALL`,
                }
            ]
            ui.addField(field);   

            field = new Field(`input`, `SRTSEQ`, `Sort sequence + Library`);
            field.default = `*SAME`;
            field.description = `Specifies the sort sequence table to be used for string comparisons for this job.<br><b><i>*SAME</i></b><i>*USRPRF</i><i>*SYSVAL</i><i>*HEX</i><i>*LANGIDUNQ</i><i>*LANGIDSHR</i>`;
            ui.addField(field);    

            field = new Field(`input`, `LANGID`, `Language ID`);
            field.default = `*SAME`;
            field.description = `Specifies the language identifier to be associated with this job. The language identifier is used when *LANGIDUNQ or *LANGIDSHR is specified on the Sort sequence (SRTSEQ) parameter.<br><b><i>*SAME</i></b><i>*USRPRF</i><i>*SYSVAL</i><i>character-value</i>`;
            ui.addField(field);    

            field = new Field(`input`, `CNTRYID`, `Country or region ID`);
            field.default = `*SAME`;
            field.description = `Specifies the country or region identifier to be used by the job.<br><b><i>*SAME</i></b><i>*USRPRF</i><i>*SYSVAL</i><i>character-value</i>`;
            ui.addField(field);    

            field = new Field(`input`, `CCSID`, `Coded character set ID`);
            field.default = `*SAME`;
            field.description = `Specifies the coded character set identifier (CCSID) used for this job.<br><b><i>*SAME</i></b><i>*USRPRF</i><i>*SYSVAL</i><i>*HEX</i><i>1-65535</i>`;
            ui.addField(field);    

            field = new Field(`select`, `DECFMT`, `Decimal format`);
            field.description = `Specifies the decimal format used for the job.`;
            field.items = [
                {
                    selected: true,
                    value: `*SAME`,
                    text: `The value does not change.`,
                    description: `*SAME`,
                },
                {
                    selected: false,
                    value: `*SYSVAL`,
                    text: `The value specified for the QDECFMT system value is used.`,
                    description: `*SYSVAL`,
                },
                {
                    selected: false,
                    value: `*BLANK`,
                    text: `A period (.) is used for the decimal format, zero suppression.`,
                    description: `*BLANK`,
                },
                {
                    selected: false,
                    value: `I`,
                    text: `A comma (,) is used for the decimal format, zero suppression.`,
                    description: `I`,
                },
                {
                    selected: false,
                    value: `J`,
                    text: `A comma (,) is used for the decimal format, one leading zero.
                    `,
                    description: `J`,
                }
            ]
            ui.addField(field);

            field = new Field(`select`, `CHRIDCTL`, `Character identifier control`);
            field.description = `Specifies the character identifier control used for the job. This attribute controls the type of CCSID conversion that occurs for display files, printer files and panel groups. `;
            field.items = [
                {
                    selected: true,
                    value: `*SAME`,
                    text: `The value does not change.`,
                    description: `*SAME`,
                },
                {
                    selected: false,
                    value: `*USRPRF`,
                    text: `When the job being changed is the job in which this command is running, the character identifier control is obtained from the user profile under which this thread was initially running. When the job being changed is a different job, the character identifier control is obtained from the current user profile associated with that job.`,
                    description: `*USRPRF`,
                },
                {
                    selected: false,
                    value: `*SYSVAL`,
                    text: `The value specified for the QCHRIDCTL system value will be used.`,
                    description: `*SYSVAL`,
                },
                {
                    selected: false,
                    value: `*DEVD`,
                    text: `The *DEVD special value performs the same function as on the CHRID command parameter for display files, printer files and panel groups.`,
                    description: `*DEVD`,
                },
                {
                    selected: false,
                    value: `*JOBCCSID`,
                    text: `The *JOBCCSID special value performs the same function as on the CHRID command parameter for display files, printer files and panel groups.`,
                    description: `*JOBCCSID`,
                }
            ]
            ui.addField(field);

            field = new Field(`select`, `SPLFACN`, `Spooled file action`);
            field.description = `Specifies whether or not spooled files are accessed through job interfaces after the job ends. `;
            field.items = [
                {
                    selected: true,
                    value: `*SAME`,
                    text: `The value does not change.`,
                    description: `*SAME`,
                },
                {
                    selected: false,
                    value: `*SYSVAL`,
                    text: `The value specified in the system value QSPLFACN is used.`,
                    description: `*SYSVAL`,
                },
                {
                    selected: false,
                    value: `*KEEP`,
                    text: `When the job ends, as long as spooled files for the job exist in the system auxiliary storage pool (ASP 1) or in a basic user ASP (ASPs 2-32), the spooled files are kept with the job and the status of the job is updated to indicate that the job has completed.`,
                    description: `*KEEP`,
                },
                {
                    selected: false,
                    value: `*DETACH`,
                    text: `When the job ends, the spooled files are detached from the job and the job is removed from the system. If the job has already ended, this change will immediately detach the spooled files from the job and remove the job from the system.`,
                    description: `*DETACH`,
                }
            ]
            ui.addField(field);

            field = new Field(`input`, `WLCGRP`, `Workload group`);
            field.default = `*SAME`;
            field.description = `Specifies the workload group associated with this job. You can use the Add Workload Group (ADDWLCGRP) command to define a workload group.<br><b><i>*SAME</i></b><i>*NONE</i><i>simple-name</i>`;
            ui.addField(field); 

            field = new Field(`input`, `CPUTIME`, `Maximum CPU time`);
            field.default = `*SAME`;
            field.description = `Specifies the maximum processing unit time (in milliseconds) that the job can use. If the job consists of multiple routing steps, only the current routing step is affected. If the job is on a job queue, only the next routing step is affected. If the maximum time is exceeded, the job is held.<br><b><i>*SAME</i></b><i>*NOMAX</i><i>1-9999999</i>`;
            ui.addField(field); 

            field = new Field(`input`, `MAXTMPSTG`, `Maximum temporary storage`);
            field.default = `*SAME`;
            field.description = `Specifies the maximum amount of temporary (auxiliary) storage (in megabytes) that the job can use. If the job consists of multiple routing steps, only the current routing step is affected. If the job is on a job queue, only the next routing step is affected.<br><b><i>*SAME</i></b><i>*NOMAX</i><i>1-2147483647</i>`;
            ui.addField(field); 

            field = new Field(`select`, `PRCRSCPTY`, `Processor resources priority`);
            field.description = `If your system has simultaneous multithreading (SMT) enabled, the processor resources priority will be used by the operating system to determine the relative importance of the job when it is dispatched compared to other jobs that are dispatched.`;
            field.items = [
                {
                    selected: true,
                    value: `*SAME`,
                    text: `The processor resources priority does not change.`,
                    description: `*SAME`,
                },
                {
                    selected: false,
                    value: `*SYSCTL`,
                    text: `The system determines the processor resources priority for the job and its threads.`,
                    description: `*SYSCTL`,
                },
                {
                    selected: false,
                    value: `*NORMAL`,
                    text: `The job and its threads will be dispatched uniformly across the maximum number of available processors.`,
                    description: `*NORMAL`,
                },
                {
                    selected: false,
                    value: `*HIGH`,
                    text: `The operating system will isolate this job and its threads, when possible, to processors with fewer threads running concurrently.`,
                    description: `*HIGH`,
                },
                {
                    selected: false,
                    value: `*LOW`,
                    text: `The job and its threads will be dispatched to processors with other low priority jobs executing, when possible.`,
                    description: `*LOW`,
                }
            ]
            ui.addField(field);

            field = new Field(`select`, `DUPJOBOPT`, `Duplicate job option`);
            field.description = `Specifies the action taken when duplicate jobs are found by this command.`;
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

            field = new Field(`submit`, `save`, `Change job`);
            ui.addField(field);

        } else {
            // @TODO: Do something
        }

        let { panel, data } = await ui.loadPage(`Change Job (CHGJOB)`);

        if (data) {
            panel.dispose();
            return data;
        } else {
            return;
        }
    }

}

/**
 * Hold job
 */
class HoldjobUI {

    /**
     * @param {string} jobname
     * @param {string} jobuser
     * @param {string} jobnumber
     */
    static async init(jobname, jobuser, jobnumber) {
        let ui = new CustomUI();

        if (jobname && jobuser && jobnumber) {

            let field;

            field = new Field(`paragraph`, `description`, `<h1>Hold Job (HLDJOB)</h1>
            <a href="https://www.ibm.com/docs/en/i/7.4?topic=ssw_ibm_i_74/cl/hldjob.htm">Online Help (IBM)</a>`);
            ui.addField(field);

            field = new Field(`input`, `jobname`, `Job name`);
            field.default = jobname;
            field.description = `Specify the name of the job.`;
            field.readonly = true;
            ui.addField(field);

            field = new Field(`input`, `jobuser`, `User`);
            field.default = jobuser;
            field.description = `Specify the user name that identifies the user profile under which the job is started.`
            field.readonly = true;
            ui.addField(field);

            field = new Field(`input`, `jobnumber`, `Number`);
            field.default = jobnumber;
            field.description = `Specify the system-assigned job number.<br><i>(000000-999999)</i>`;
            field.readonly = true;
            ui.addField(field);

            field = new Field(`select`, `SPLFILE`, `Hold spooled files`);
            field.description = `Specifies whether spooled output files created by the job being held are also held.`;
            field.items = [
                {
                    selected: true,
                    value: `*NO`,
                    text: `The spooled output files produced by the job are not held.`,
                    description: `*NO`,
                },
                {
                    selected: false,
                    value: `*YES`,
                    text: `The spooled output files produced by the job are also held. Only those spooled output files which are on output queues in the library name space of the thread issuing this command will be held.`,
                    description: `*YES`,
                }
            ]
            ui.addField(field);   

            field = new Field(`select`, `DUPJOBOPT`, `Duplicate job option`);
            field.description = `Specifies the action taken when duplicate jobs are found by this command.`;
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

            field = new Field(`submit`, `save`, `Hold job`);
            ui.addField(field);

        } else {
            // @TODO: Do something
        }

        let { panel, data } = await ui.loadPage(`Hold Job (HLDJOB)`);

        if (data) {
            panel.dispose();
            return data;
        } else {
            return;
        }
    }

}

/**
 * Release Job
 */
class ReleaseJobUI {

    /**
     * @param {string} jobname
     * @param {string} jobuser
     * @param {string} jobnumber
     */
    static async init(jobname, jobuser, jobnumber) {
        let ui = new CustomUI();

        if (jobname && jobuser && jobnumber) {

            let field;

            field = new Field(`paragraph`, `description`, `<h1>Release Job (RLSJOB)</h1>
            <a href="https://www.ibm.com/docs/en/i/7.4?topic=ssw_ibm_i_74/cl/rlsjob.htm">Online Help (IBM)</a>`);
            ui.addField(field);

            field = new Field(`input`, `jobname`, `Job name`);
            field.default = jobname;
            field.description = `Specify the name of the job being released.`;
            field.readonly = true;
            ui.addField(field);

            field = new Field(`input`, `jobuser`, `User`);
            field.default = jobuser;
            field.description = `Specify the user name that identifies the user profile under which the job is started.`
            field.readonly = true;
            ui.addField(field);

            field = new Field(`input`, `jobnumber`, `Number`);
            field.default = jobnumber;
            field.description = `Specify the system-assigned job number. <br><i>(000000-999999)</i>`;
            field.readonly = true;
            ui.addField(field);
            
            field = new Field(`select`, `DUPJOBOPT`, `Duplicate job option`);
            field.description = `Specifies the action taken when duplicate jobs are found by this command.`;
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

            field = new Field(`submit`, `save`, `Release Job`);
            ui.addField(field);

        } else {
            // @TODO: Do something
        }

        let { panel, data } = await ui.loadPage(`Release Job (RLSJOB)`);

        if (data) {
            panel.dispose();
            return data;
        } else {
            return;
        }
    }

}

/**
 * Properties Job
 */
class PropertiesJobUI {

    /**
     * @param {{jobStatus: string, currentUser: string, typeEnhanced: string, enteredSystemTime: string, activeTime: string, jobDescription: string, submitterJobName: string, outputQueue: string, dateFormat: string, dateSeparator: string, timeSeparator: string, decimalFormat: string, languageID: string, countryID: string, sortSequence: string, ccsid: number}} propertiesLog
     */
    static async init(propertiesLog) {
        let ui = new CustomUI();

        if (propertiesLog) {

            let field;

            field = new Field(`paragraph`, `description`, `<h1>Job properties</h1>`);
            ui.addField(field);

            field = new Field(`input`, `jobStatus`, `Status`);
            field.default = propertiesLog.jobStatus;
            field.readonly = true;
            ui.addField(field);

            field = new Field(`input`, `jobuser`, `Current user`);
            field.default = propertiesLog.currentUser;
            field.readonly = true;
            ui.addField(field);

            field = new Field(`input`, `typeEnhanced`, `Type enhanced`);
            field.default = propertiesLog.typeEnhanced;
            field.readonly = true;
            ui.addField(field);

            field = new Field(`input`, `enteredSystemTime`, `Entered in the system`);
            field.default = propertiesLog.enteredSystemTime;
            field.readonly = true;
            ui.addField(field);

            field = new Field(`input`, `activeTime`, `Active time`);
            field.default = propertiesLog.activeTime;
            field.readonly = true;
            ui.addField(field);

            field = new Field(`input`, `jobDescription`, `Job description`);
            field.default = propertiesLog.jobDescription;
            field.readonly = true;
            ui.addField(field);

            field = new Field(`input`, `submitterJobName`, `Submitter job name`);
            field.default = propertiesLog.submitterJobName;
            field.readonly = true;
            ui.addField(field);

            field = new Field(`input`, `outputQueue`, `Output queue`);
            field.default = propertiesLog.outputQueue;
            field.readonly = true;
            ui.addField(field);

            field = new Field(`input`, `dateFormat`, `Date format`);
            field.default = propertiesLog.dateFormat;
            field.readonly = true;
            ui.addField(field);

            field = new Field(`input`, `dateSeparator`, `Date separator`);
            field.default = propertiesLog.dateSeparator;
            field.readonly = true;
            ui.addField(field);

            field = new Field(`input`, `timeSeparator`, `Time separator`);
            field.default = propertiesLog.timeSeparator;
            field.readonly = true;
            ui.addField(field);

            field = new Field(`input`, `decimalFormat`, `Decimal format`);
            field.default = propertiesLog.decimalFormat;
            field.readonly = true;
            ui.addField(field);

            field = new Field(`input`, `languageID`, `Language ID`);
            field.default = propertiesLog.languageID;
            field.readonly = true;
            ui.addField(field);

            field = new Field(`input`, `countryID`, `Country ID`);
            field.default = propertiesLog.countryID;
            field.readonly = true;
            ui.addField(field);

            field = new Field(`input`, `sortSequence`, `Sort sequence`);
            field.default = propertiesLog.sortSequence;
            field.readonly = true;
            ui.addField(field);

            field = new Field(`input`, `ccsid`, `CCSID`);
            field.default = propertiesLog.ccsid.toString();
            field.readonly = true;
            ui.addField(field);

            // field = new Field(`submit`, `save`, `Release Job`);
            // ui.addField(field);

        } else {
            // @TODO: Do something
        }

        let { panel, data } = await ui.loadPage(`Job properties`);

        if (data) {
            panel.dispose();
            return data;
        } else {
            return;
        }
    }

}

module.exports = {EndjobUI, ChangejobUI, HoldjobUI, ReleaseJobUI, PropertiesJobUI};