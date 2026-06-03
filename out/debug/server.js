"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.readJVMInfo = exports.readActiveJob = exports.refreshDebugSensitiveItems = exports.stopServer = exports.startServer = exports.isDebugEngineRunning = exports.endJobs = exports.getStuckJobs = exports.getDebugServerJob = exports.getDebugServiceJob = exports.stopService = exports.startService = exports.isDebugSupported = exports.debugPTFInstalled = exports.MIN_DEBUG_VERSION = void 0;
const path_1 = __importDefault(require("path"));
const vscode_1 = require("vscode");
const Tools_1 = require("../api/Tools");
const DebugConfiguration_1 = require("../api/configuration/DebugConfiguration");
const instantiate_1 = require("../instantiate");
const CustomUI_1 = require("../webviews/CustomUI");
exports.MIN_DEBUG_VERSION = 3;
function debugPTFInstalled(connection) {
    return connection.debugPTFInstalled();
}
exports.debugPTFInstalled = debugPTFInstalled;
async function isDebugSupported(connection) {
    return debugPTFInstalled(connection) && (await (0, DebugConfiguration_1.getDebugServiceDetails)(connection)).semanticVersion().major >= exports.MIN_DEBUG_VERSION;
}
exports.isDebugSupported = isDebugSupported;
async function startService(connection) {
    const checkAuthority = async (user) => {
        if (user && !await connection.getContent().checkObject({ library: "QSYS", name: user, type: "*USRPRF" }, ["*USE"])) {
            throw new Error(`You don't have *USE authority on user profile ${user}`);
        }
        if (user !== "QDBGSRV" && !(await connection.getContent().checkUserSpecialAuthorities(["*ALLOBJ", "*SECADM"], user)).valid) {
            throw new Error(`User ${user || connection.currentUser} doesn't have *ALLOBJ special authority`);
        }
    };
    try {
        const debugServiceJavaVersion = (await (0, DebugConfiguration_1.getDebugServiceDetails)(connection)).java;
        // const debugConfig = await new DebugConfiguration(connection).load();
        const javaHome = (0, DebugConfiguration_1.getJavaHome)(connection, debugServiceJavaVersion);
        const submitOptions = await vscode_1.window.showInputBox({
            title: vscode_1.l10n.t(`Debug Service submit options`),
            prompt: vscode_1.l10n.t(`Valid parameters for SBMJOB`),
            value: `JOBQ(QSYS/QUSRNOMAX) JOBD(QSYS/QSYSJOBD) OUTQ(QUSRSYS/QDBGSRV) USER(QDBGSRV)`
        });
        if (submitOptions) {
            const submitUser = /USER\(([^)]+)\)/.exec(submitOptions)?.[1]?.toLocaleUpperCase();
            if (submitUser && submitUser !== "*CURRENT") {
                await checkAuthority(submitUser);
            }
            else {
                await checkAuthority();
            }
            const debugConfig = await new DebugConfiguration_1.DebugConfiguration(connection).load();
            // Attempt to make log directory
            await connection.sendCommand({ command: `mkdir -p ${debugConfig.getRemoteServiceWorkspace()}` });
            // Change owner to QDBGSRV
            if (submitUser && submitUser !== "QDBGSRV") {
                await connection.sendCommand({ command: `chown ${submitUser} ${debugConfig.getRemoteServiceWorkspace()}` });
            }
            // Change the permissions to 777
            await connection.sendCommand({ command: `chmod 777 ${debugConfig.getRemoteServiceWorkspace()}` });
            const command = `QSYS/SBMJOB JOB(QDBGSRV) SYSLIBL(*SYSVAL) CURLIB(*USRPRF) INLLIBL(*JOBD) ${submitOptions} CMD(QSH CMD('export JAVA_HOME=${javaHome};${debugConfig.getRemoteServiceBin()}/startDebugService.sh > ${debugConfig.getNavigatorLogFile()} 2>&1'))`;
            const submitResult = await connection.runCommand({ command, noLibList: true });
            if (submitResult.code === 0) {
                const submitMessage = Tools_1.Tools.parseMessages(submitResult.stderr || submitResult.stdout).findId("CPC1221")?.text;
                if (submitMessage) {
                    const [job] = /([^\/\s]+)\/([^\/]+)\/([^\/\s]+)/.exec(submitMessage) || [];
                    if (job) {
                        let tries = 0;
                        const checkJob = async (done) => {
                            if (tries++ < 30) {
                                const jobDetail = await readActiveJob(connection, { name: job, ports: [] });
                                if (jobDetail && typeof jobDetail === "object" && !["HLD", "MSGW", "END"].includes(String(jobDetail.JOB_STATUS))) {
                                    if (await getDebugServiceJob()) {
                                        vscode_1.window.showInformationMessage(vscode_1.l10n.t(`Debug service started.`));
                                        refreshDebugSensitiveItems();
                                        done(true);
                                    }
                                    else {
                                        setTimeout(() => checkJob(done), 1000);
                                    }
                                }
                                else {
                                    let reason;
                                    if (typeof jobDetail === "object") {
                                        reason = `job is in ${String(jobDetail.JOB_STATUS)} status`;
                                    }
                                    else if (jobDetail) {
                                        reason = jobDetail;
                                    }
                                    else {
                                        reason = "job has ended";
                                    }
                                    vscode_1.window.showErrorMessage(`Debug Service job ${job} failed: ${reason}.`, 'Open output').then(() => openQPRINT(connection, job));
                                    done(false);
                                }
                            }
                            else {
                                done(false);
                            }
                        };
                        return await new Promise(checkJob);
                    }
                }
            }
            throw new Error(`Failed to submit Debug Service job: ${submitResult.stderr || submitResult.stdout}`);
        }
    }
    catch (error) {
        vscode_1.window.showErrorMessage(String(error));
    }
    return false;
}
exports.startService = startService;
async function stopService(connection) {
    const debugConfig = await new DebugConfiguration_1.DebugConfiguration(connection).load();
    const endResult = await connection.sendCommand({
        command: `${path_1.default.posix.join(debugConfig.getRemoteServiceBin(), `stopDebugService.sh`)}`
    });
    if (!endResult.code) {
        vscode_1.window.showInformationMessage(vscode_1.l10n.t(`Debug service stopped.`));
        refreshDebugSensitiveItems();
        return true;
    }
    else {
        vscode_1.window.showErrorMessage(vscode_1.l10n.t(`Failed to stop debug service: {0}`, endResult.stdout || endResult.stderr));
        return false;
    }
}
exports.stopService = stopService;
async function getDebugServiceJob() {
    const connection = instantiate_1.instance.getConnection();
    if (connection) {
        const rows = await connection.runSQL(`select job_name, local_port from qsys2.netstat_job_info j where job_name = (select job_name from qsys2.netstat_job_info j where local_port = ${connection.getConfig().debugPort || 8005} and remote_address = '0.0.0.0' fetch first row only) and remote_address = '0.0.0.0'`);
        if (rows && rows.length) {
            return {
                name: String(rows[0].JOB_NAME),
                ports: rows.map(row => Number(row.LOCAL_PORT)).sort()
            };
        }
    }
}
exports.getDebugServiceJob = getDebugServiceJob;
async function getDebugServerJob() {
    const connection = instantiate_1.instance.getConnection();
    if (connection) {
        const [row] = await connection.runSQL(`select job_name, local_port from qsys2.netstat_job_info where cast(local_port_name as VarChar(14) CCSID 37) = 'is-debug-ile' fetch first row only`);
        if (row) {
            return {
                name: String(row.JOB_NAME),
                ports: [Number(row.LOCAL_PORT)]
            };
        }
    }
}
exports.getDebugServerJob = getDebugServerJob;
/**
 * Gets a list of debug jobs stuck at MSGW in QSYSWRK
 */
async function getStuckJobs(connection) {
    const sql = [
        `SELECT JOB_NAME`,
        `FROM TABLE(QSYS2.ACTIVE_JOB_INFO(SUBSYSTEM_LIST_FILTER => 'QSYSWRK', CURRENT_USER_LIST_FILTER => '${connection.currentUser.toUpperCase()}')) X`,
        `where JOB_STATUS = 'MSGW'`,
    ].join(` `);
    const jobs = await connection.runSQL(sql);
    return jobs.map(row => String(row.JOB_NAME));
}
exports.getStuckJobs = getStuckJobs;
function endJobs(jobIds, connection) {
    const promises = jobIds.map(id => connection.sendCommand({
        command: `system "ENDJOB JOB(${id}) OPTION(*IMMED)"`
    }));
    return Promise.all(promises);
}
exports.endJobs = endJobs;
async function isDebugEngineRunning() {
    return (await Promise.all([getDebugServerJob(), getDebugServiceJob()])).every(Boolean);
}
exports.isDebugEngineRunning = isDebugEngineRunning;
async function startServer() {
    const result = await instantiate_1.instance.getConnection()?.runCommand({ command: "STRDBGSVR", noLibList: true });
    if (result) {
        if (result.code) {
            vscode_1.window.showErrorMessage(vscode_1.l10n.t(`Failed to start debug server: {0}`, result.stderr));
            return false;
        }
        else {
            refreshDebugSensitiveItems();
            vscode_1.window.showInformationMessage(vscode_1.l10n.t(`Debug server started.`));
        }
    }
    return true;
}
exports.startServer = startServer;
async function stopServer() {
    const result = await instantiate_1.instance.getConnection()?.runCommand({ command: "ENDDBGSVR", noLibList: true });
    if (result) {
        if (result.code) {
            vscode_1.window.showErrorMessage(vscode_1.l10n.t(`Failed to stop debug server: {0}`, result.stderr));
            return false;
        }
        else {
            refreshDebugSensitiveItems();
            vscode_1.window.showInformationMessage(vscode_1.l10n.t(`Debug server stopped.`));
        }
    }
    return true;
}
exports.stopServer = stopServer;
function refreshDebugSensitiveItems() {
    vscode_1.commands.executeCommand("code-for-ibmi.updateConnectedBar");
    vscode_1.commands.executeCommand("code-for-ibmi.debug.refresh");
}
exports.refreshDebugSensitiveItems = refreshDebugSensitiveItems;
async function readActiveJob(connection, job) {
    try {
        return (await connection.runSQL(`select job_name_short "Job name", job_user "Job user", job_number "Job number", subsystem_library_name concat '/' concat subsystem as "Subsystem",  authorization_name "Current user", job_status "Job status", memory_pool "Memory pool" from table(qsys2.active_job_info(job_name_filter => '${job.name.substring(job.name.lastIndexOf('/') + 1)}')) where job_name = '${job.name}' fetch first row only`)).at(0);
    }
    catch (error) {
        return String(error);
    }
}
exports.readActiveJob = readActiveJob;
async function readJVMInfo(connection, job) {
    try {
        return (await connection.runSQL(`
      select START_TIME "Start time", JAVA_HOME "Java Home", USER_DIRECTORY "User directory", CURRENT_HEAP_SIZE "Current memory", MAX_HEAP_SIZE "Maximum allowed memory"
      from QSYS2.JVM_INFO
      where job_name = '${job.name}'
      fetch first row only`)).at(0);
    }
    catch (error) {
        return String(error);
    }
}
exports.readJVMInfo = readJVMInfo;
async function openQPRINT(connection, job) {
    const lines = (await connection.runSQL(`select SPOOLED_DATA from table (systools.spooled_file_data(job_name => '${job}', spooled_file_name => 'QPRINT')) order by ORDINAL_POSITION`))
        .map(row => String(row.SPOOLED_DATA));
    if (lines.length) {
        new CustomUI_1.CustomUI()
            .addParagraph(`<pre><code>${lines.join("<br/>")}</code></pre>`)
            .setOptions({ fullWidth: true })
            .loadPage(`${job} QPRINT`);
    }
    else {
        vscode_1.window.showWarningMessage(`No QPRINT spooled file found for job ${job}!`);
    }
}
//# sourceMappingURL=server.js.map