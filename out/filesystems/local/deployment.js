"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Deployment = void 0;
const path_1 = __importDefault(require("path"));
const tar_1 = __importDefault(require("tar"));
const tmp_1 = __importDefault(require("tmp"));
const vscode_1 = __importDefault(require("vscode"));
const actions_1 = require("../../api/actions");
const Tools_1 = require("../../api/Tools");
const instantiate_1 = require("../../instantiate");
const deployTools_1 = require("./deployTools");
var Deployment;
(function (Deployment) {
    Deployment.BUTTON_BASE = `$(cloud-upload) Deploy`;
    Deployment.BUTTON_WORKING = `$(sync~spin) Deploying`;
    Deployment.deploymentLog = vscode_1.default.window.createOutputChannel(`IBM i Deployment`);
    Deployment.button = vscode_1.default.window.createStatusBarItem(vscode_1.default.StatusBarAlignment.Left, 0);
    Deployment.workspaceChanges = new Map;
    let fixCCSID;
    function initialize(context) {
        Deployment.button.command = {
            command: `code-for-ibmi.launchDeploy`,
            title: `Launch Deploy`
        };
        Deployment.button.text = Deployment.BUTTON_BASE;
        context.subscriptions.push(Deployment.button, Deployment.deploymentLog, vscode_1.default.commands.registerCommand(`code-for-ibmi.launchActionsSetup`, deployTools_1.DeployTools.launchActionsSetup), vscode_1.default.commands.registerCommand(`code-for-ibmi.launchDeploy`, deployTools_1.DeployTools.launchDeploy), vscode_1.default.commands.registerCommand(`code-for-ibmi.setDeployLocation`, deployTools_1.DeployTools.setDeployLocation));
        const workspaces = vscode_1.default.workspace.workspaceFolders;
        if (workspaces && workspaces.length > 0) {
            workspaceWatcher().then(context.subscriptions.push);
        }
        instantiate_1.instance.subscribe(context, 'connected', `Initialize deployment`, () => {
            const workspaces = vscode_1.default.workspace.workspaceFolders;
            const connection = instantiate_1.instance.getConnection();
            const storage = instantiate_1.instance.getStorage();
            if (workspaces && connection && storage) {
                const config = connection.getConfig();
                if (workspaces.length > 0 && !config.readOnlyMode) {
                    Deployment.button.show();
                }
                else {
                    Deployment.button.hide();
                }
                const existingPaths = storage.getDeployment();
                if (workspaces.length === 1) {
                    const workspace = workspaces[0];
                    if (existingPaths && !existingPaths[workspace.uri.fsPath]) {
                        const possibleDeployDir = deployTools_1.DeployTools.buildPossibleDeploymentDirectory(workspace);
                        vscode_1.default.window.showInformationMessage(`Deploy directory for Workspace not setup. Would you like to default to '${possibleDeployDir}'?`, `Yes`, `Ignore`).then(async (result) => {
                            if (result === `Yes`) {
                                deployTools_1.DeployTools.setDeployLocation({ path: possibleDeployDir }, workspace);
                            }
                        });
                    }
                    (0, actions_1.getActions)(workspace).then(result => {
                        if (result.length === 0) {
                            vscode_1.default.window.showInformationMessage(`There are no local Actions defined for this project.`, `Run Setup`).then(result => {
                                if (result === `Run Setup`)
                                    vscode_1.default.commands.executeCommand(`code-for-ibmi.launchActionsSetup`);
                            });
                        }
                    });
                }
            }
        });
        instantiate_1.instance.subscribe(context, 'disconnected', `Clear deployment`, () => {
            fixCCSID = undefined;
            Deployment.button.hide();
        });
    }
    Deployment.initialize = initialize;
    function getConnection() {
        const connection = instantiate_1.instance.getConnection();
        if (!connection) {
            throw new Error("Please connect to an IBM i");
        }
        return connection;
    }
    Deployment.getConnection = getConnection;
    function getContent() {
        const connection = getConnection();
        if (!connection) {
            throw new Error("Please connect to an IBM i");
        }
        return connection.getContent();
    }
    Deployment.getContent = getContent;
    async function createRemoteDirectory(remotePath) {
        return await getConnection().sendCommand({
            command: `mkdir -p "${remotePath}"`
        });
    }
    Deployment.createRemoteDirectory = createRemoteDirectory;
    async function workspaceWatcher() {
        const invalidFs = [`member`, `streamfile`];
        const watcher = vscode_1.default.workspace.createFileSystemWatcher(`**`);
        const getChangesMap = (uri) => {
            if (!invalidFs.includes(uri.scheme) && !uri.fsPath.includes(`.git`)) {
                const workspaceFolder = vscode_1.default.workspace.getWorkspaceFolder(uri);
                if (workspaceFolder) {
                    let changes = Deployment.workspaceChanges.get(workspaceFolder);
                    if (!changes) {
                        changes = new Map;
                        Deployment.workspaceChanges.set(workspaceFolder, changes);
                    }
                    return changes;
                }
            }
        };
        const checkLocalActionsFiles = async (uri) => {
            let workspace;
            if (uri instanceof vscode_1.default.Uri) {
                if (uri.path.endsWith('/.vscode/actions.json')) {
                    workspace = vscode_1.default.workspace.getWorkspaceFolder(uri);
                }
                else {
                    return;
                }
            }
            else {
                workspace = uri;
            }
            vscode_1.default.commands.executeCommand(`setContext`, `code-for-ibmi:hasLocalActions`, workspace ? (await (0, actions_1.getLocalActionsFiles)(workspace)).length > 0 : false);
        };
        watcher.onDidChange(uri => {
            getChangesMap(uri)?.set(uri.fsPath, uri);
        });
        watcher.onDidCreate(async (uri) => {
            checkLocalActionsFiles(uri);
            const fileStat = await vscode_1.default.workspace.fs.stat(uri);
            if (fileStat.type === vscode_1.default.FileType.File) {
                getChangesMap(uri)?.set(uri.fsPath, uri);
            }
        });
        watcher.onDidDelete(uri => {
            checkLocalActionsFiles(uri);
            getChangesMap(uri)?.delete(uri.fsPath);
        });
        vscode_1.default.workspace.workspaceFolders?.forEach(checkLocalActionsFiles);
        return watcher;
    }
    async function showErrorButton() {
        if (await vscode_1.default.window.showErrorMessage(`Deployment failed.`, `View Log`)) {
            Deployment.deploymentLog.show();
        }
    }
    Deployment.showErrorButton = showErrorButton;
    async function getWorkspaceFolder(workspaceIndex) {
        if (workspaceIndex !== undefined) {
            return vscode_1.default.workspace.workspaceFolders?.find(dir => dir.index === workspaceIndex);
        }
        else {
            const workspaces = vscode_1.default.workspace.workspaceFolders;
            if (workspaces && workspaces.length > 0) {
                if (workspaces.length === 1) {
                    return workspaces[0];
                }
                else {
                    const chosen = await vscode_1.default.window.showQuickPick(workspaces.map(dir => dir.name), {
                        placeHolder: `Select workspace to deploy`
                    });
                    if (chosen) {
                        return workspaces.find(dir => dir.name === chosen);
                    }
                }
            }
        }
    }
    Deployment.getWorkspaceFolder = getWorkspaceFolder;
    function toMD5Entry(line) {
        const parts = line.split(/\s+/);
        return {
            md5: parts[0].trim(),
            path: parts[1].trim().substring(2) //these path starts with ./
        };
    }
    Deployment.toMD5Entry = toMD5Entry;
    function toRelative(root, file) {
        return path_1.default.relative(root.path, file.path).replace(/\\/g, `/`);
    }
    Deployment.toRelative = toRelative;
    async function findFiles(parameters, includePattern, excludePattern) {
        const root = parameters.workspaceFolder.uri;
        return (await vscode_1.default.workspace.findFiles(new vscode_1.default.RelativePattern(parameters.workspaceFolder, includePattern), excludePattern ? new vscode_1.default.RelativePattern(parameters.workspaceFolder, excludePattern) : null))
            .filter(file => {
            if (parameters.ignoreRules) {
                const relative = toRelative(root, file);
                return !parameters.ignoreRules.ignores(relative);
            }
            else {
                return true;
            }
        });
    }
    Deployment.findFiles = findFiles;
    async function deleteFiles(parameters, toDelete) {
        if (toDelete.length) {
            Deployment.deploymentLog.appendLine(`\nDeleted:\n\t${toDelete.join('\n\t')}\n`);
            await Deployment.getConnection().sendCommand({ directory: parameters.remotePath, command: `rm -rf ${toDelete.join(' ')}` });
        }
    }
    Deployment.deleteFiles = deleteFiles;
    async function sendCompressed(parameters, files, progress) {
        const connection = getConnection();
        const localTarball = tmp_1.default.fileSync({ postfix: ".tar" });
        const remoteTarball = path_1.default.posix.join(getConnection().getConfig().tempDir || '/tmp', `deploy_${Tools_1.Tools.makeid()}.tar`);
        try {
            const toSend = files.map(file => path_1.default.relative(parameters.workspaceFolder.uri.fsPath, file.fsPath));
            progress?.report({ message: `creating deployment tarball for ${toSend.length} file(s)...` });
            tar_1.default.create({ cwd: parameters.workspaceFolder.uri.fsPath, sync: true, file: localTarball.name }, toSend);
            Deployment.deploymentLog.appendLine(`Created deployment tarball ${localTarball.name}`);
            progress?.report({ message: `sending deployment tarball...` });
            await connection.client.putFile(localTarball.name, remoteTarball);
            Deployment.deploymentLog.appendLine(`Uploaded deployment tarball as ${remoteTarball}`);
            progress?.report({ message: `extracting deployment tarball to ${parameters.remotePath}...` });
            //Extract and remove tar's PaxHeader metadata folder
            const result = await connection.sendCommand({ command: `${connection.remoteFeatures.tar} -xof ${remoteTarball} && rm -rf PaxHeader`, directory: parameters.remotePath });
            if (result.code !== 0) {
                throw new Error(`Tarball extraction failed: ${result.stderr}`);
            }
            const entries = [];
            tar_1.default.t({ sync: true, file: localTarball.name, onentry: entry => entries.push(entry.path) });
            Deployment.deploymentLog.appendLine(`${entries.length} file(s) uploaded to ${parameters.remotePath}`);
            entries.sort().map(e => `\t${e}`).forEach(Deployment.deploymentLog.appendLine);
            if (await mustFixCCSID()) {
                progress?.report({ message: 'Fixing files CCSID...' });
                const fix = await connection.sendCommand({ command: `${connection.remoteFeatures.setccsid} -R 1208 ${parameters.remotePath}` });
                if (fix.code === 0) {
                    Deployment.deploymentLog.appendLine(`Deployed files' CCSID set to 1208`);
                }
                else {
                    Deployment.deploymentLog.appendLine(`Failed to set deployed files' CCSID to 1208: ${fix.stderr}`);
                }
            }
        }
        finally {
            Deployment.deploymentLog.appendLine('');
            await connection.sendCommand({ command: `rm ${remoteTarball}` });
            Deployment.deploymentLog.appendLine(`${remoteTarball} deleted`);
            localTarball.removeCallback();
            Deployment.deploymentLog.appendLine(`${localTarball.name} deleted`);
        }
    }
    Deployment.sendCompressed = sendCompressed;
    /**
     * Check if default CCSID of created/deployed files is not 1208 (utf-8).
     *
     * @returns `true` if the default CCSID of IFS files is not 1208.
     */
    async function mustFixCCSID() {
        if (fixCCSID === undefined) {
            const connection = getConnection();
            fixCCSID = Boolean(connection.remoteFeatures.attr) &&
                Boolean(connection.remoteFeatures.setccsid) &&
                (await connection.sendCommand({ command: `touch codeforiccsidtest && ${connection.remoteFeatures.attr} codeforiccsidtest CCSID && rm codeforiccsidtest` })).stdout !== "1208";
        }
        return fixCCSID;
    }
})(Deployment = exports.Deployment || (exports.Deployment = {}));
//# sourceMappingURL=deployment.js.map