"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAllAvailableActions = exports.runAction = exports.uriToActionTarget = exports.registerActionTools = void 0;
const path_1 = __importDefault(require("path"));
const vscode_1 = __importStar(require("vscode"));
const CompileTools_1 = require("../api/CompileTools");
const IBMi_1 = __importDefault(require("../api/IBMi"));
const Tools_1 = require("../api/Tools");
const variables_1 = require("../api/variables");
const deployTools_1 = require("../filesystems/local/deployTools");
const env_1 = require("../filesystems/local/env");
const git_1 = require("../filesystems/local/git");
const QSysFs_1 = require("../filesystems/qsys/QSysFs");
const CustomUI_1 = require("../webviews/CustomUI");
const diagnostics_1 = require("./diagnostics");
const Tools_2 = require("./Tools");
const actions_1 = require("../api/actions");
const actionUsed = new Map;
const PARM_REGEX = /(PNLGRP|OBJ|PGM|MODULE|FILE|MENU)\((?<object>.+?)\)/;
function registerActionTools(context) {
    context.subscriptions.push(...(0, diagnostics_1.registerDiagnostics)());
}
exports.registerActionTools = registerActionTools;
function uriToActionTarget(uri, workspaceFolder, ibmi) {
    return {
        uri,
        extension: uri.path.substring(uri.path.lastIndexOf(`.`) + 1).toUpperCase(),
        fragment: uri.fragment.toUpperCase(),
        protected: (0, QSysFs_1.parseFSOptions)(uri).readonly || ibmi?.getConfig().readOnlyMode || ibmi?.getContent().isProtectedPath(uri.path) || false,
        workspaceFolder: workspaceFolder || vscode_1.default.workspace.getWorkspaceFolder(uri),
        executionOK: false,
        hasRun: false,
        processed: false,
        output: []
    };
}
exports.uriToActionTarget = uriToActionTarget;
async function runAction(instance, uris, customAction, method, browserItems, workspaceFolder) {
    uris = Array.isArray(uris) ? uris : [uris];
    //Global scheme: all URIs share the same
    const scheme = uris[0].scheme;
    if (!uris.every(uri => uri.scheme === scheme)) {
        vscode_1.default.window.showWarningMessage(vscode_1.l10n.t("Actions can't be run on multiple items of different natures. ({0})", uris.map(uri => uri.scheme).filter(Tools_1.Tools.distinct).join(", ")));
        return false;
    }
    const connection = instance.getConnection();
    if (connection) {
        const config = connection.getConfig();
        const content = connection.getContent();
        const targets = uris.map(uri => uriToActionTarget(uri, workspaceFolder, connection));
        workspaceFolder = targets[0].workspaceFolder;
        if (!targets.every(target => target.workspaceFolder === workspaceFolder)) {
            vscode_1.default.window.showErrorMessage(vscode_1.l10n.t("Actions can only be run on files from the same workspace"));
            return false;
        }
        let remoteCwd = config?.homeDirectory || `.`;
        let availableActions = [];
        if (!customAction) {
            // First we grab a copy the predefined Actions in the VS Code settings
            availableActions = await getAllAvailableActions(targets, scheme);
        }
        if (customAction || availableActions.length) {
            const chosenAction = customAction || ((availableActions.length === 1) ? availableActions[0] : await vscode_1.default.window.showQuickPick(availableActions))?.action;
            if (chosenAction) {
                actionUsed.set(chosenAction.name, Date.now());
                const environment = chosenAction.environment || `ile`;
                let workspaceId = undefined;
                // If we are running an Action for a local file, we need a deploy directory even if they are not
                // deploying the file. This is because we need to know the relative path of the file to the deploy directory.
                if (workspaceFolder && chosenAction.type === `file`) {
                    if (chosenAction.deployFirst) {
                        const deployResult = await deployTools_1.DeployTools.launchDeploy(workspaceFolder.index, method);
                        if (deployResult !== undefined) {
                            workspaceId = deployResult.workspaceId;
                            remoteCwd = deployResult.remoteDirectory;
                        }
                        else {
                            vscode_1.default.window.showWarningMessage(`Action "${chosenAction.name}" was cancelled.`);
                            return false;
                        }
                    }
                    else {
                        workspaceId = workspaceFolder.index;
                        const deployPath = deployTools_1.DeployTools.getRemoteDeployDirectory(workspaceFolder);
                        if (deployPath) {
                            remoteCwd = deployPath;
                        }
                        else {
                            vscode_1.default.window.showWarningMessage(`No deploy directory setup for this workspace. Cancelling Action.`);
                            return false;
                        }
                    }
                }
                const fromWorkspace = (chosenAction.type === `file` && vscode_1.default.workspace.workspaceFolders) ? vscode_1.default.workspace.workspaceFolders[workspaceId || 0] : undefined;
                const envFileVars = workspaceFolder ? await (0, env_1.getEnvConfig)(workspaceFolder) : {};
                const commandConfirm = async (commandString) => {
                    const commands = commandString.split(`\n`).filter(command => command.trim().length > 0);
                    const promptedCommands = [];
                    for (let command of commands) {
                        if (command.startsWith(`?`)) {
                            command = await vscode_1.default.window.showInputBox({ prompt: `Run Command`, value: command.substring(1) }) || '';
                        }
                        else {
                            command = await showCustomInputs(`Run Command`, command, chosenAction.name || `Command`);
                        }
                        promptedCommands.push(command);
                        if (!command)
                            break;
                    }
                    return !promptedCommands.includes(``) ? promptedCommands.join(`\n`) : ``;
                };
                let cancelled = false;
                //Prompt once now in case of multiple targets
                const promptOnce = targets.length > 1;
                const command = promptOnce ? await commandConfirm(chosenAction.command) : chosenAction.command;
                if (!command) {
                    return false;
                }
                await vscode_1.default.window.withProgress({ location: vscode_1.default.ProgressLocation.Notification, cancellable: true, title: vscode_1.l10n.t("Running action {0} on", chosenAction.name, targets.length) }, async (task, canceled) => {
                    const increment = 100 / targets.length;
                    let done = 1;
                    for (const target of targets) {
                        if (canceled.isCancellationRequested) {
                            cancelled = true;
                            return;
                        }
                        target.processed = true;
                        const variables = new variables_1.Variables(connection);
                        if (target.workspaceFolder) {
                            for (const [key, value] of Object.entries(await (0, env_1.getEnvConfig)(target.workspaceFolder))) {
                                variables.set(`&${key}`, value);
                            }
                        }
                        Object.entries(envFileVars).forEach(([key, value]) => variables.set(`&${key}`, value));
                        const evfeventInfo = {
                            object: '',
                            library: '',
                            extension: target.extension,
                            workspace: fromWorkspace
                        };
                        const evfeventInfos = [];
                        let processedPath = "";
                        switch (chosenAction.type) {
                            case `member`:
                                const memberDetail = connection.parserMemberPath(target.uri.path);
                                evfeventInfo.library = memberDetail.library;
                                evfeventInfo.object = memberDetail.name;
                                evfeventInfo.extension = memberDetail.extension;
                                evfeventInfo.asp = memberDetail.asp;
                                processedPath = `${memberDetail.library}/${memberDetail.file}/${memberDetail.basename}`;
                                variables.set(`&OPENLIBL`, memberDetail.library.toLowerCase())
                                    .set(`&OPENLIB`, memberDetail.library)
                                    .set(`&OPENSPFL`, memberDetail.file.toLowerCase())
                                    .set(`&OPENSPF`, memberDetail.file)
                                    .set(`&OPENMBRL`, memberDetail.name.toLowerCase())
                                    .set(`&OPENMBR`, memberDetail.name)
                                    .set(`&EXTL`, memberDetail.extension.toLowerCase())
                                    .set(`&EXT`, memberDetail.extension);
                                break;
                            case `file`:
                            case `streamfile`:
                                processedPath = target.uri.path;
                                const pathData = path_1.default.parse(target.uri.path);
                                const basename = pathData.base;
                                const ext = pathData.ext ? (pathData.ext.startsWith(`.`) ? pathData.ext.substring(1) : pathData.ext) : ``;
                                const parent = path_1.default.parse(pathData.dir).base;
                                let name = pathData.name;
                                // Logic to handle second extension, caused by TOBi.
                                const tobiTypes = [`.PGM`, `.SRVPGM`];
                                const secondName = path_1.default.parse(name);
                                if (secondName.ext && tobiTypes.includes(secondName.ext.toUpperCase())) {
                                    name = secondName.name;
                                }
                                // Remove TOBi text convention
                                if (name.includes(`-`)) {
                                    name = name.substring(0, name.indexOf(`-`));
                                }
                                evfeventInfo.library = connection.upperCaseName(variables.get(`&CURLIB`) || config.currentLibrary);
                                evfeventInfo.object = connection.upperCaseName(name);
                                evfeventInfo.extension = ext;
                                if (chosenAction.command.includes(`&SRCFILE`)) {
                                    variables.set(`&SRCLIB`, evfeventInfo.library)
                                        .set(`&SRCPF`, `QTMPSRC`)
                                        .set(`&SRCFILE`, `${evfeventInfo.library}/QTMPSRC`);
                                }
                                switch (chosenAction.type) {
                                    case `file`:
                                        variables.set(`&LOCALPATH`, target.uri.fsPath);
                                        if (fromWorkspace) {
                                            const relativePath = path_1.default.relative(fromWorkspace.uri.path, target.uri.path).split(path_1.default.sep).join(path_1.default.posix.sep);
                                            // We need to make sure the remote path is posix
                                            const fullPath = path_1.default.posix.join(remoteCwd, relativePath);
                                            variables.set(`&RELATIVEPATH`, relativePath)
                                                .set(`&FULLPATH`, fullPath)
                                                .set(`{path}`, fullPath)
                                                .set(`&WORKDIR`, remoteCwd)
                                                .set(`&FILEDIR`, path_1.default.posix.parse(fullPath).dir);
                                            const branch = (0, git_1.getGitBranch)(fromWorkspace);
                                            if (branch) {
                                                variables.set(`&BRANCHLIB`, (0, env_1.getBranchLibraryName)(branch))
                                                    .set(`&BRANCH`, branch)
                                                    .set(`{branch}`, branch);
                                            }
                                        }
                                        break;
                                    case `streamfile`:
                                        const relativePath = path_1.default.posix.relative(remoteCwd, target.uri.path);
                                        const fullName = target.uri.path;
                                        variables.set(`&RELATIVEPATH`, relativePath)
                                            .set(`&FULLPATH`, fullName)
                                            .set(`&FILEDIR`, path_1.default.parse(fullName).dir);
                                        break;
                                }
                                variables.set(`&PARENT`, parent)
                                    .set(`&BASENAME`, basename)
                                    .set(`{filename}`, basename)
                                    .set(`&NAMEL`, name.toLowerCase())
                                    .set(`&NAME`, name)
                                    .set(`&EXTL`, target.extension.toLowerCase())
                                    .set(`&EXT`, target.extension);
                                break;
                            case `object`:
                                const [_, library, fullName] = connection.upperCaseName(target.uri.path).split(`/`);
                                const object = fullName.substring(0, fullName.lastIndexOf(`.`));
                                evfeventInfo.library = library;
                                evfeventInfo.object = object;
                                processedPath = `${library}/${object}.${target.extension}`;
                                variables.set(`&LIBRARYL`, library.toLowerCase())
                                    .set(`&LIBRARY`, library)
                                    .set(`&NAMEL`, object.toLowerCase())
                                    .set(`&NAME`, object)
                                    .set(`&TYPEL`, target.extension.toLowerCase())
                                    .set(`&TYPE`, target.extension)
                                    .set(`&EXTL`, target.extension.toLowerCase())
                                    .set(`&EXT`, target.extension);
                                break;
                        }
                        task.report({ message: `${processedPath} (${done++}/${targets.length})`, increment });
                        const viewControl = IBMi_1.default.connectionManager.get(`postActionView`) || "none";
                        let actionName = chosenAction.name;
                        const exitCode = await new Promise(resolve => vscode_1.tasks.executeTask({
                            isBackground: true,
                            name: chosenAction.name,
                            definition: { type: `ibmi` },
                            scope: workspaceFolder,
                            source: 'IBM i',
                            presentationOptions: {
                                showReuseMessage: true,
                                clear: IBMi_1.default.connectionManager.get(`clearOutputEveryTime`),
                                focus: false,
                                reveal: (viewControl === `task` ? vscode_1.TaskRevealKind.Always : vscode_1.TaskRevealKind.Never),
                            },
                            problemMatchers: [],
                            runOptions: {},
                            group: vscode_1.TaskGroup.Build,
                            execution: new vscode_1.CustomExecution(async (e) => {
                                const writeEmitter = new vscode_1.default.EventEmitter();
                                const closeEmitter = new vscode_1.default.EventEmitter();
                                writeEmitter.event(s => target.output.push(s));
                                closeEmitter.event(resolve);
                                const term = {
                                    onDidWrite: writeEmitter.event,
                                    onDidClose: closeEmitter.event,
                                    open: async () => {
                                        let successful = false;
                                        let problemsFetched = false;
                                        try {
                                            writeEmitter.fire(`Running Action: ${chosenAction.name} (${new Date().toLocaleTimeString()})` + CompileTools_1.CompileTools.NEWLINE);
                                            // If &SRCFILE is set, we need to copy the file to a temporary source file from the IFS
                                            const fullPath = variables.get(`&FULLPATH`);
                                            const srcFile = variables.get(`&SRCFILE`);
                                            if (fullPath && srcFile && evfeventInfo.object) {
                                                const [lib, srcpf] = srcFile.split(`/`);
                                                const createSourceFile = content.toCl(`CRTSRCPF`, {
                                                    rcdlen: 112,
                                                    file: `${lib}/${srcpf}`,
                                                });
                                                const copyFromStreamfile = content.toCl(`CPYFRMSTMF`, {
                                                    fromstmf: fullPath,
                                                    tombr: `'${Tools_1.Tools.qualifyPath(lib, srcpf, evfeventInfo.object)}'`,
                                                    mbropt: `*REPLACE`,
                                                    dbfccsid: `*FILE`,
                                                    stmfccsid: 1208,
                                                });
                                                // We don't care if this fails. Usually it's because the source file already exists.
                                                await CompileTools_1.CompileTools.runCommand(connection, { command: createSourceFile, environment: `ile`, noLibList: true });
                                                // Attempt to copy to member
                                                const copyResult = await CompileTools_1.CompileTools.runCommand(connection, { command: copyFromStreamfile, environment: `ile`, noLibList: true });
                                                if (copyResult.code !== 0) {
                                                    writeEmitter.fire(`Failed to copy file to a temporary member.\n\t${copyResult.stderr}\n\n`);
                                                    closeEmitter.fire(copyResult.code || 1);
                                                }
                                            }
                                            const commandResult = await CompileTools_1.CompileTools.runCommand(connection, {
                                                title: chosenAction.name,
                                                environment,
                                                command,
                                                cwd: remoteCwd,
                                                env: variables,
                                            }, {
                                                writeEvent: (content) => writeEmitter.fire(content),
                                                commandConfirm: promptOnce ? undefined : commandConfirm
                                            });
                                            if (commandResult && commandResult.code !== CompileTools_1.CompileTools.DID_NOT_RUN) {
                                                target.hasRun = true;
                                                const isIleCommand = environment === `ile`;
                                                const useLocalEvfevent = fromWorkspace && chosenAction.postDownload &&
                                                    (chosenAction.postDownload.includes(`.evfevent`) || chosenAction.postDownload.includes(`.evfevent/`));
                                                const possibleObjects = getObjectsFromJoblog(commandResult.stderr) || getObjectFromCommand(commandResult.command);
                                                if (isIleCommand && possibleObjects) {
                                                    evfeventInfos.length = 0;
                                                    if (Array.isArray(possibleObjects)) {
                                                        for (const o of possibleObjects) {
                                                            evfeventInfos.push({
                                                                library: o.library || evfeventInfo.library,
                                                                object: o.object,
                                                                extension: evfeventInfo.extension,
                                                                asp: evfeventInfo.asp
                                                            });
                                                        }
                                                        ;
                                                    }
                                                    else {
                                                        evfeventInfo.library = possibleObjects.library ? possibleObjects.library : evfeventInfo.library;
                                                        evfeventInfo.object = possibleObjects.object;
                                                        evfeventInfos.push(evfeventInfo);
                                                    }
                                                }
                                                actionName = (isIleCommand && possibleObjects ? `${chosenAction.name} for ${evfeventInfo.library}/${evfeventInfo.object}` : actionName);
                                                successful = (commandResult.code === 0 || commandResult.code === null);
                                                writeEmitter.fire(CompileTools_1.CompileTools.NEWLINE);
                                                if (useLocalEvfevent) {
                                                    writeEmitter.fire(`Fetching errors from .evfevent.${CompileTools_1.CompileTools.NEWLINE}`);
                                                }
                                                else if (evfeventInfo.object && evfeventInfo.library) {
                                                    if (chosenAction.command.includes(`*EVENTF`)) {
                                                        writeEmitter.fire(`Fetching errors for ` + (evfeventInfos.length > 1 ? `multiple objects` : `${evfeventInfo.library}/${evfeventInfo.object}.`) + CompileTools_1.CompileTools.NEWLINE);
                                                        await (0, diagnostics_1.refreshDiagnosticsFromServer)(instance, evfeventInfos);
                                                        problemsFetched = true;
                                                    }
                                                    else if (chosenAction.command.trimStart().toUpperCase().startsWith(`CRT`)) {
                                                        writeEmitter.fire(`*EVENTF not found in command string. Not fetching errors for ${evfeventInfo.library}/${evfeventInfo.object}.` + CompileTools_1.CompileTools.NEWLINE);
                                                    }
                                                }
                                                if (chosenAction.outputToFile) {
                                                    await outputToFile(connection, chosenAction.outputToFile, variables, target.output);
                                                }
                                                if (chosenAction.type === `file` && chosenAction.postDownload?.length) {
                                                    if (fromWorkspace) {
                                                        const remoteDir = remoteCwd;
                                                        const localDir = fromWorkspace.uri;
                                                        const postDownloads = [];
                                                        const downloadDirectories = new Set();
                                                        for (const download of chosenAction.postDownload) {
                                                            const remotePath = path_1.default.posix.join(remoteDir, download);
                                                            const localPath = vscode_1.default.Uri.joinPath(localDir, download).path;
                                                            let type;
                                                            if (await content.isDirectory(remotePath)) {
                                                                downloadDirectories.add(vscode_1.default.Uri.joinPath(localDir, download));
                                                                type = vscode_1.default.FileType.Directory;
                                                            }
                                                            else {
                                                                const directory = path_1.default.parse(download).dir;
                                                                if (directory) {
                                                                    downloadDirectories.add(vscode_1.default.Uri.joinPath(localDir, directory));
                                                                }
                                                                type = vscode_1.default.FileType.File;
                                                            }
                                                            postDownloads.push({ remotePath, localPath, type });
                                                        }
                                                        //Clear and create every local download directories
                                                        for (const downloadPath of downloadDirectories) {
                                                            try {
                                                                const stat = await vscode_1.default.workspace.fs.stat(downloadPath); //Check if target exists
                                                                if (stat.type !== vscode_1.default.FileType.Directory) {
                                                                    if (await vscode_1.default.window.showWarningMessage(`${downloadPath} exists but is a file.`, "Delete and create directory")) {
                                                                        await vscode_1.default.workspace.fs.delete(downloadPath);
                                                                        throw new Error("Create directory");
                                                                    }
                                                                }
                                                                else if (stat.type === vscode_1.default.FileType.Directory) {
                                                                    await vscode_1.default.workspace.fs.delete(downloadPath, { recursive: true });
                                                                    throw new Error("Create directory");
                                                                }
                                                            }
                                                            catch (e) {
                                                                //Either fs.stat did not find the folder or it wasn't a folder and it's been deleted above
                                                                try {
                                                                    await vscode_1.default.workspace.fs.createDirectory(downloadPath);
                                                                }
                                                                catch (error) {
                                                                    vscode_1.default.window.showWarningMessage(`Failed to create download path ${downloadPath}: ${error}`);
                                                                    console.log(error);
                                                                    closeEmitter.fire(1);
                                                                }
                                                            }
                                                        }
                                                        // Then we download the files that is specified.
                                                        const downloads = postDownloads.map(async (postDownload) => {
                                                            const content = connection.getContent();
                                                            if (postDownload.type === vscode_1.default.FileType.Directory) {
                                                                return content.downloadDirectory(postDownload.localPath, postDownload.remotePath, { recursive: true, concurrency: 5 });
                                                            }
                                                            else {
                                                                return content.downloadFile(postDownload.localPath, postDownload.remotePath);
                                                            }
                                                        });
                                                        await Promise.all(downloads)
                                                            .then(async () => {
                                                            // Done!
                                                            writeEmitter.fire(`Downloaded files as part of Action: ${chosenAction.postDownload.join(`, `)}\n`);
                                                            // Process locally downloaded evfevent files:
                                                            if (useLocalEvfevent) {
                                                                await (0, diagnostics_1.refreshDiagnosticsFromLocal)(instance, evfeventInfo);
                                                                problemsFetched = true;
                                                            }
                                                        })
                                                            .catch(error => {
                                                            vscode_1.default.window.showErrorMessage(`Failed to download files as part of Action.`);
                                                            writeEmitter.fire(`Failed to download a file after Action: ${error.message}\n`);
                                                            closeEmitter.fire(1);
                                                        });
                                                    }
                                                }
                                                if (problemsFetched && viewControl === `problems`) {
                                                    vscode_1.commands.executeCommand(`workbench.action.problems.focus`);
                                                }
                                            }
                                            else {
                                                writeEmitter.fire(`Command did not run.` + CompileTools_1.CompileTools.NEWLINE);
                                            }
                                        }
                                        catch (e) {
                                            writeEmitter.fire(`${e}\n`);
                                            vscode_1.default.window.showErrorMessage(`Action ${chosenAction.name} for ${evfeventInfo.library}/${evfeventInfo.object} failed. (internal error).`);
                                            successful = false;
                                        }
                                        closeEmitter.fire(successful ? 0 : 1);
                                    },
                                    close: function () { }
                                };
                                return term;
                            })
                        }));
                        target.executionOK = (exitCode === 0);
                        if (target.hasRun && target.executionOK && target.executionOK) {
                            doRefresh(chosenAction, browserItems?.find(item => item.resourceUri?.path === target.uri.path));
                        }
                    }
                });
                if (targets.some(target => target.hasRun)) {
                    const openOutputAction = vscode_1.l10n.t("Open output(s)");
                    let uiPromise;
                    if (cancelled) {
                        uiPromise = vscode_1.default.window.showWarningMessage(vscode_1.l10n.t(`Action {0} was cancelled; ({1} processed).`, chosenAction.name, targets.filter(target => target.processed).length), openOutputAction);
                    }
                    else if (targets.every(target => target.executionOK)) {
                        uiPromise = vscode_1.default.window.showInformationMessage(vscode_1.l10n.t(`Action {0} was successful.`, chosenAction.name), openOutputAction);
                    }
                    else {
                        uiPromise = vscode_1.default.window.showErrorMessage(vscode_1.l10n.t(`Action {0} was not successful ({1}/{2} failed).`, chosenAction.name, targets.filter(target => !target.executionOK).length, targets.length), openOutputAction);
                    }
                    uiPromise.then(openOutput => {
                        if (openOutput) {
                            const now = new Date();
                            const resultsPanel = new CustomUI_1.CustomUI();
                            if (targets.length === 1) {
                                resultsPanel.addParagraph(`<pre>${Tools_2.VscodeTools.escapeHtml(targets[0].output.join(""))}</pre>`)
                                    .setOptions({
                                    fullPage: true,
                                    css: /* css */ `
                      pre{
                        background-color: transparent;
                      }
                    `
                                });
                            }
                            else {
                                resultsPanel.addBrowser("results", targets.filter(target => target.processed).map(target => ({ label: `${getTargetResultIcon(target)} ${path_1.default.basename(target.uri.path)}`, value: `<pre>${Tools_2.VscodeTools.escapeHtml(target.output.join(""))}</pre>` })))
                                    .setOptions({
                                    fullPage: true,
                                    css: /* css */ `
                      body{
                        margin: 0;
                        padding: 0;
                        overflow: hidden;
                      }

                      pre {
                        margin: 1em;
                        background-color: transparent;
                      }
                    `
                                });
                            }
                            resultsPanel.loadPage(`${chosenAction.name} [${now.toLocaleString()}]`);
                        }
                    });
                }
            }
            return targets.every(target => target.executionOK);
        }
        else {
            vscode_1.default.window.showErrorMessage(vscode_1.l10n.t(`No suitable actions found for {0} - {1}`, scheme, targets.map(t => t.extension).filter(Tools_1.Tools.distinct).join(", ")));
            return false;
        }
    }
    else {
        throw new Error("Please connect to an IBM i first");
    }
}
exports.runAction = runAction;
async function getAllAvailableActions(targets, scheme) {
    const allActions = [...await (0, actions_1.getActions)()];
    // Then, if we're being called from a local file
    // we fetch the Actions defined from the workspace.
    const firstWorkspace = targets[0].workspaceFolder;
    // We need to make sure that all targets are from the same workspace
    if (firstWorkspace && firstWorkspace.uri.scheme === `file`) {
        const workspaceId = firstWorkspace.index;
        const allTargetsInOne = targets.every(t => t.workspaceFolder?.index === workspaceId);
        if (allTargetsInOne) {
            const localActions = await (0, actions_1.getActions)(firstWorkspace);
            allActions.push(...localActions);
        }
    }
    // We make sure all extensions are uppercase
    allActions.forEach(action => {
        if (action.extensions) {
            action.extensions = action.extensions.map(ext => ext.toUpperCase());
        }
        ;
    });
    // Then we get all the available Actions for the current context
    const availableActions = allActions.filter(action => action.type === scheme)
        .filter(action => !action.extensions || action.extensions.every(e => !e) || targets.every(t => action.extensions.includes(t.extension) || action.extensions.includes(t.fragment)) || action.extensions.includes(`GLOBAL`))
        .filter(action => action.runOnProtected || !targets.some(t => t.protected))
        .sort((a, b) => (actionUsed.get(b.name) || 0) - (actionUsed.get(a.name) || 0))
        .map(action => ({
        label: action.name,
        action
    }));
    return availableActions;
}
exports.getAllAvailableActions = getAllAvailableActions;
function getObjectsFromJoblog(stderr) {
    const objects = [];
    // Filter lines with EVFEVENT info from server.
    const joblogLines = stderr.split(`\n`).filter(line => line.match(/:  EVFEVENT:/i));
    for (const joblogLine of joblogLines) {
        const evfevent = joblogLine.match(/:  EVFEVENT:(.*)/i) || '';
        if (evfevent.length) {
            const object = evfevent[1].trim().split(/[,\|/]/);
            if (object) {
                if (object.length >= 2) {
                    objects.push({
                        library: object[0].trim(),
                        object: object[1].trim()
                    });
                }
                else {
                    objects.push({
                        object: object[0].trim()
                    });
                }
            }
        }
    }
    return objects.length > 0 ? objects : undefined;
}
function getObjectFromCommand(baseCommand) {
    if (baseCommand) {
        const regex = PARM_REGEX.exec(baseCommand.toUpperCase());
        if (regex) {
            const object = regex.groups?.object.split(`/`);
            if (object) {
                if (object.length === 2) {
                    return {
                        library: object[0],
                        object: object[1]
                    };
                }
                else {
                    return {
                        object: object[0]
                    };
                }
            }
        }
    }
}
/**
 * @param  name action's name
 * @param command action's command string
 * @return the new command
 */
async function showCustomInputs(name, command, title) {
    const components = [];
    let loop = true;
    let end = 0;
    while (loop) {
        const idx = command.indexOf(`\${`, end);
        if (idx >= 0) {
            const start = idx;
            end = command.indexOf(`}`, start);
            if (end >= 0) {
                let currentInput = command.substring(start + 2, end);
                const [name, label, initialValue] = currentInput.split(`|`);
                components.push({
                    name,
                    label,
                    initialValue: initialValue || ``,
                    start,
                    end: end + 1
                });
            }
            else {
                loop = false;
            }
        }
        else {
            loop = false;
        }
    }
    if (components.length) {
        const commandUI = new CustomUI_1.CustomUI();
        if (title) {
            commandUI.addHeading(title, 2);
        }
        for (const component of components) {
            if (component.initialValue.includes(`,`)) {
                //Select box
                commandUI.addSelect(component.name, component.label, component.initialValue.split(`,`).map((value, index) => ({
                    selected: index === 0,
                    value,
                    description: value,
                    text: `Select ${value}`,
                })));
            }
            else {
                //Input box
                commandUI.addInput(component.name, component.label, '', { default: component.initialValue });
            }
        }
        commandUI.addButtons({ id: `execute`, label: `Execute` }, { id: `cancel`, label: `Cancel` });
        const page = await commandUI.loadPage(name);
        if (page) {
            page.panel.dispose();
            if (page.data && page.data.buttons !== `cancel`) {
                const dataEntries = Object.entries(page.data);
                for (const component of components.reverse()) {
                    const value = dataEntries.find(([key]) => key === component.name)?.[1];
                    command = command.substring(0, component.start) + value + command.substring(component.end);
                }
            }
            else {
                command = '';
            }
        }
    }
    return command;
}
function doRefresh(chosenAction, browserItem) {
    if (browserItem) {
        switch (chosenAction.refresh) {
            case 'browser':
                if (chosenAction.type === 'streamfile') {
                    vscode_1.default.commands.executeCommand("code-for-ibmi.refreshIFSBrowser");
                }
                else if (chosenAction.type !== 'file') {
                    vscode_1.default.commands.executeCommand("code-for-ibmi.refreshObjectBrowser");
                }
                break;
            case 'filter':
                //Filter is a top level item so it has no parent (like Batman)
                let filter = browserItem;
                while (filter.parent) {
                    filter = filter.parent;
                }
                filter.refresh?.();
                break;
            case 'parent':
                browserItem.parent?.refresh?.();
                break;
            default:
            //No refresh
        }
    }
}
function getTargetResultIcon(target) {
    if (target.hasRun) {
        return target.executionOK ? '✔️' : '❌';
    }
    else {
        return '❔';
    }
}
async function outputToFile(connection, outputPattern, variables, output) {
    const outputPath = variables.expand(outputPattern);
    let actualPath;
    if (outputPath.includes('&i')) {
        //Rolling output
        let count = 0;
        const generatePath = () => outputPath.replace("&i", `_${String(count++).padStart(3, "0")}`);
        while (await connection.getContent().testStreamFile((actualPath = generatePath()), "e"))
            ;
    }
    else {
        //Overwrite if output exists
        actualPath = outputPath;
    }
    //Replace ~ if needed
    if (actualPath.includes('~')) {
        actualPath = (await connection.sendCommand({ command: `echo ${actualPath}` })).stdout;
    }
    await connection.getContent().writeStreamfileRaw(actualPath, output.join(""));
}
//# sourceMappingURL=actions.js.map