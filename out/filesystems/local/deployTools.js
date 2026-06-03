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
exports.DeployTools = void 0;
const fs_1 = require("fs");
const ignore_1 = __importDefault(require("ignore"));
const path_1 = __importStar(require("path"));
const vscode_1 = __importStar(require("vscode"));
const actions_1 = require("../../api/actions");
const instantiate_1 = require("../../instantiate");
const typings_1 = require("../../typings");
const Tools_1 = require("../../ui/Tools");
const LocalLanguageActions_1 = require("./LocalLanguageActions");
const deployment_1 = require("./deployment");
var DeployTools;
(function (DeployTools) {
    async function launchActionsSetup(workspaceFolder) {
        const chosenWorkspace = !workspaceFolder || workspaceFolder instanceof typings_1.BrowserItem ? await deployment_1.Deployment.getWorkspaceFolder() : workspaceFolder;
        if (chosenWorkspace) {
            const types = Object.entries(LocalLanguageActions_1.LocalLanguageActions).map(([type, actions]) => ({ label: type, actions }));
            const chosenTypes = await vscode_1.default.window.showQuickPick(types, {
                canPickMany: true,
                title: `Select available pre-defined actions`
            });
            if (chosenTypes) {
                const newActions = chosenTypes.flatMap(type => type.actions);
                const localActionsUri = vscode_1.default.Uri.file(path_1.default.join(chosenWorkspace.uri.fsPath, `.vscode`, `actions.json`));
                const overwrite = vscode_1.l10n.t("Overwrite");
                const append = vscode_1.l10n.t("Append");
                const exists = (0, fs_1.existsSync)(localActionsUri.fsPath);
                let action;
                if (!exists || (action = await vscode_1.default.window.showWarningMessage(vscode_1.l10n.t("Local actions are already defined for this workspace."), { modal: true }, overwrite, append))) {
                    try {
                        const actions = [];
                        if (!exists || action === overwrite) {
                            actions.push(...newActions);
                        }
                        else if (action === append) {
                            const existingActions = await (0, actions_1.getActions)(chosenWorkspace);
                            const existingActionNames = existingActions.map(action => action.name);
                            //Change names of new actions
                            let toRename = [];
                            while ((toRename = newActions.filter(action => existingActionNames.includes(action.name))).length) {
                                toRename.forEach(action => {
                                    const index = / \((\d+)\)$/.exec(action.name)?.[1];
                                    if (index) {
                                        action.name = action.name.substring(0, action.name.lastIndexOf(' ') + 1) + `(${Number(index) + 1})`;
                                    }
                                    else {
                                        action.name += " (1)";
                                    }
                                });
                            }
                            actions.push(...existingActions, ...newActions);
                        }
                        await vscode_1.default.workspace.fs.writeFile(localActionsUri, Buffer.from(JSON.stringify(actions, null, 2), `utf-8`));
                        vscode_1.default.workspace.openTextDocument(localActionsUri).then(doc => vscode_1.default.window.showTextDocument(doc));
                    }
                    catch (e) {
                        console.log(e);
                        vscode_1.default.window.showErrorMessage(`Unable to create actions.json file.`);
                    }
                }
            }
        }
    }
    DeployTools.launchActionsSetup = launchActionsSetup;
    function getRemoteDeployDirectory(workspaceFolder) {
        const storage = instantiate_1.instance.getStorage();
        const existingPaths = storage?.getDeployment();
        return existingPaths ? existingPaths[workspaceFolder.uri.fsPath] : undefined;
    }
    DeployTools.getRemoteDeployDirectory = getRemoteDeployDirectory;
    /**
     * Deploy a workspace to a remote IFS location.
     * @param workspaceIndex if no index is provided, a prompt will be shown to pick one if there are multiple workspaces,
     * otherwise the current workspace will be used.
     * @param method if no method is provided, a prompt will be shown to pick the deployment method.
     * @returns the index of the deployed workspace or `undefined` if the deployment failed
     */
    async function launchDeploy(workspaceIndex, method) {
        const folder = await deployment_1.Deployment.getWorkspaceFolder(workspaceIndex);
        if (folder) {
            const remotePath = getRemoteDeployDirectory(folder);
            if (remotePath) {
                if (!method) {
                    const methods = [];
                    if (deployment_1.Deployment.getConnection().remoteFeatures.md5sum) {
                        methods.push({ method: "compare", label: `Compare`, description: `Synchronizes using MD5 hash comparison` });
                    }
                    const changes = deployment_1.Deployment.workspaceChanges.get(folder)?.size || 0;
                    methods.push({ method: "changed", label: `Changes`, description: `${changes} change${changes > 1 ? `s` : ``} detected since last upload. ${!changes ? `Will skip deploy step.` : ``}` });
                    if (Tools_1.VscodeTools.getGitAPI()) {
                        methods.push({ method: "unstaged", label: `Working Changes`, description: `Unstaged changes in git` }, { method: "staged", label: `Staged Changes`, description: `` });
                    }
                    methods.push({ method: "all", label: `All`, description: `Every file in the local workspace` });
                    const defaultDeploymentMethod = instantiate_1.instance.getConnection()?.getConfig().defaultDeploymentMethod;
                    if (methods.find((element) => element.method === defaultDeploymentMethod)) { // default deploy method is usable
                        method = defaultDeploymentMethod;
                    }
                    else {
                        if (defaultDeploymentMethod !== '') {
                            vscode_1.default.window.showWarningMessage('Default deployment method is set but not usable in your environment.');
                        }
                        method = (await vscode_1.default.window.showQuickPick(methods, { placeHolder: `Select deployment method to ${remotePath}` }))?.method;
                    }
                }
                if (method !== undefined) { //method can be 0 (ie. "all")
                    const parameters = {
                        workspaceFolder: folder,
                        remotePath,
                        method
                    };
                    if (await deploy(parameters)) {
                        instantiate_1.instance.fire(`deploy`);
                        return {
                            remoteDirectory: remotePath,
                            workspaceId: folder.index
                        };
                    }
                }
            }
            else {
                if (await vscode_1.default.window.showErrorMessage(`Chosen location (${folder.uri.fsPath}) is not configured for deployment.`, 'Set deploy location')) {
                    setDeployLocation(undefined, folder, buildPossibleDeploymentDirectory(folder));
                }
            }
        }
    }
    DeployTools.launchDeploy = launchDeploy;
    async function deploy(parameters) {
        try {
            deployment_1.Deployment.deploymentLog.clear();
            deployment_1.Deployment.deploymentLog.appendLine(`Deployment started using method "${parameters.method}"`);
            deployment_1.Deployment.deploymentLog.appendLine(``);
            deployment_1.Deployment.button.text = deployment_1.Deployment.BUTTON_WORKING;
            parameters.ignoreRules = parameters.ignoreRules || await getDefaultIgnoreRules(parameters.workspaceFolder);
            const name = (0, path_1.basename)(parameters.workspaceFolder.uri.path);
            await vscode_1.default.window.withProgress({
                location: vscode_1.default.ProgressLocation.Notification,
                title: `Deploying ${name}`,
            }, async (progress) => {
                if (parameters.remotePath.startsWith(`/`)) {
                    progress.report({ message: `creating remote folder ${parameters.remotePath}...` });
                    await deployment_1.Deployment.createRemoteDirectory(parameters.remotePath);
                    progress.report({ message: `gathering files ("${parameters.method}" method)...` });
                    const files = [];
                    const deletes = [];
                    switch (parameters.method) {
                        case "unstaged":
                            files.push(...await getDeployGitFiles(parameters, 'working'));
                            break;
                        case "staged":
                            files.push(...await getDeployGitFiles(parameters, 'staged'));
                            break;
                        case "changed":
                            files.push(...await getDeployChangedFiles(parameters));
                            break;
                        case "compare":
                            const { uploads, relativeRemoteDeletes } = await getDeployCompareFiles(parameters, progress);
                            files.push(...uploads);
                            deletes.push(...relativeRemoteDeletes);
                            break;
                        case "all":
                            files.push(...await getDeployAllFiles(parameters));
                            break;
                    }
                    if (deletes.length) {
                        progress.report({ message: `Deleting ${deletes.length} file${deletes.length === 1 ? `` : `s`}...` });
                        await deployment_1.Deployment.deleteFiles(parameters, deletes);
                    }
                    if (files.length) {
                        await deployment_1.Deployment.sendCompressed(parameters, files, progress);
                    }
                    else {
                        deployment_1.Deployment.deploymentLog.appendLine('No files to upload');
                    }
                }
                else {
                    deployment_1.Deployment.deploymentLog.appendLine(`Deployment cancelled. Not sure where to deploy workspace.`);
                    throw new Error("Invalid deployment path");
                }
            });
            deployment_1.Deployment.deploymentLog.appendLine('');
            deployment_1.Deployment.deploymentLog.appendLine(`Deployment finished at ${new Date().toLocaleTimeString()}`);
            vscode_1.default.window.showInformationMessage(`Deployment finished.`);
            deployment_1.Deployment.workspaceChanges.get(parameters.workspaceFolder)?.clear();
            return true;
        }
        catch (error) {
            deployment_1.Deployment.showErrorButton();
            deployment_1.Deployment.deploymentLog.appendLine(`Deployment failed: ${error}`);
            return false;
        }
        finally {
            deployment_1.Deployment.button.text = deployment_1.Deployment.BUTTON_BASE;
        }
    }
    DeployTools.deploy = deploy;
    async function getDeployChangedFiles(parameters) {
        const changes = deployment_1.Deployment.workspaceChanges.get(parameters.workspaceFolder);
        if (changes && changes.size) {
            return Array.from(changes.values())
                .filter(uri => {
                // We don't want stuff in the gitignore
                const relative = deployment_1.Deployment.toRelative(parameters.workspaceFolder.uri, uri);
                if (relative && parameters.ignoreRules) {
                    return !parameters.ignoreRules.ignores(relative);
                }
                else {
                    return true;
                }
            });
        }
        else {
            // Skip upload, but still run the Action
            return [];
        }
    }
    DeployTools.getDeployChangedFiles = getDeployChangedFiles;
    async function getDeployGitFiles(parameters, changeType) {
        const useStagedChanges = (changeType == 'staged');
        const gitApi = Tools_1.VscodeTools.getGitAPI();
        if (gitApi && gitApi.repositories.length > 0) {
            const repository = gitApi.repositories.find(r => r.rootUri.fsPath === parameters.workspaceFolder.uri.fsPath);
            if (repository) {
                let gitFiles;
                if (useStagedChanges) {
                    gitFiles = repository.state.indexChanges;
                }
                else {
                    gitFiles = repository.state.workingTreeChanges;
                }
                // Do not attempt to upload deleted files.
                // https://github.com/microsoft/vscode/blob/main/extensions/git/src/api/git.d.ts#L69
                gitFiles = gitFiles.filter(change => change.status !== 6);
                if (gitFiles.length > 0) {
                    return gitFiles.map(change => change.uri);
                }
                else {
                    vscode_1.default.window.showWarningMessage(`No ${changeType} changes to deploy.`);
                    return [];
                }
            }
            else {
                throw new Error(`No repository found for ${parameters.workspaceFolder.uri.fsPath}`);
            }
        }
        else {
            throw new Error(`No repositories are open.`);
        }
    }
    DeployTools.getDeployGitFiles = getDeployGitFiles;
    async function getDeployCompareFiles(parameters, progress) {
        if (deployment_1.Deployment.getConnection().remoteFeatures.md5sum) {
            const isEmpty = await deployment_1.Deployment.getContent().countFiles(parameters.remotePath) === 0;
            if (isEmpty) {
                deployment_1.Deployment.deploymentLog.appendLine("Remote directory is empty; switching to 'deploy all'");
                const allFiles = await getDeployAllFiles(parameters);
                return { uploads: allFiles, relativeRemoteDeletes: [] };
            }
            else {
                deployment_1.Deployment.deploymentLog.appendLine("Starting MD5 synchronization transfer");
                progress?.report({ message: `creating remote MD5 hash list` });
                const md5sumOut = await deployment_1.Deployment.getConnection().sendCommand({
                    directory: parameters.remotePath,
                    command: `/QOpenSys/pkgs/bin/md5sum $(find . -type f)`
                });
                const remoteMD5 = md5sumOut.stdout.split(`\n`).map(line => deployment_1.Deployment.toMD5Entry(line.trim()));
                progress?.report({ message: `creating transfer list` });
                const localRoot = `${parameters.workspaceFolder.uri.fsPath}${parameters.workspaceFolder.uri.fsPath.startsWith('/') ? '/' : '\\'}`;
                const localFiles = (await deployment_1.Deployment.findFiles(parameters, "**/*", "**/.git*"))
                    .map(file => ({ uri: file, path: file.fsPath.replace(localRoot, '').replace(/\\/g, '/') }));
                const uploads = [];
                for await (const file of localFiles) {
                    const remote = remoteMD5.find(e => e.path === file.path);
                    const md5 = Tools_1.VscodeTools.md5Hash(file.uri);
                    if (!remote || remote.md5 !== md5) {
                        uploads.push(file.uri);
                    }
                }
                const toDelete = remoteMD5
                    .filter(remote => !localFiles.some(local => remote.path === local.path))
                    .map(remote => remote.path);
                progress?.report({ message: `removing empty folders under ${parameters.remotePath}` });
                //PASE's find doesn't support the -empty flag so rmdir is run on every directory; not very clean, but it works
                await deployment_1.Deployment.getConnection().sendCommand({ command: "find . -depth -type d -exec rmdir {} + 2>/dev/null", directory: parameters.remotePath });
                return {
                    uploads,
                    relativeRemoteDeletes: toDelete
                };
            }
        }
        else {
            throw new Error("Cannot synchronize using MD5 comparison: 'md5sum' command not available on host.");
        }
    }
    DeployTools.getDeployCompareFiles = getDeployCompareFiles;
    async function getDeployAllFiles(parameters) {
        return (await deployment_1.Deployment.findFiles(parameters, "**/*", "**/.git*"));
    }
    DeployTools.getDeployAllFiles = getDeployAllFiles;
    async function setDeployLocation(node, workspaceFolder, value) {
        const path = node?.path || await vscode_1.default.window.showInputBox({
            prompt: `Enter IFS directory to deploy to`,
            value
        });
        if (path) {
            const storage = instantiate_1.instance.getStorage();
            const chosenWorkspaceFolder = workspaceFolder || await deployment_1.Deployment.getWorkspaceFolder();
            if (storage && chosenWorkspaceFolder) {
                await deployment_1.Deployment.createRemoteDirectory(path);
                const existingPaths = storage.getDeployment();
                existingPaths[chosenWorkspaceFolder.uri.fsPath] = path;
                await storage.setDeployment(existingPaths);
                instantiate_1.instance.fire(`deployLocation`);
                if (await vscode_1.default.window.showInformationMessage(`Deployment location set to ${path}`, `Deploy now`)) {
                    vscode_1.default.commands.executeCommand(`code-for-ibmi.launchDeploy`, chosenWorkspaceFolder.index);
                }
            }
        }
    }
    DeployTools.setDeployLocation = setDeployLocation;
    function buildPossibleDeploymentDirectory(workspace) {
        const user = instantiate_1.instance.getConnection()?.currentUser;
        //User should not be empty but we'll keep tmp as a fallback location
        return user ? path_1.default.posix.join('/', 'home', user, 'builds', workspace.name) : path_1.default.posix.join('/', 'tmp', 'builds', workspace.name);
    }
    DeployTools.buildPossibleDeploymentDirectory = buildPossibleDeploymentDirectory;
    async function getDefaultIgnoreRules(workspaceFolder) {
        const ignoreRules = (0, ignore_1.default)({ ignorecase: true }).add(`.git`);
        // get the .deployignore file or .gitignore file from workspace with priority to .deployignore
        const ignoreFile = [
            ...await vscode_1.default.workspace.findFiles(new vscode_1.default.RelativePattern(workspaceFolder, `.deployignore`), ``, 1),
            ...await vscode_1.default.workspace.findFiles(new vscode_1.default.RelativePattern(workspaceFolder, `.gitignore`), ``, 1)
        ].at(0);
        if (ignoreFile) {
            // get the content from the file
            const gitignoreContent = (await vscode_1.default.workspace.fs.readFile(ignoreFile)).toString().replace(new RegExp(`\\\r`, `g`), ``);
            ignoreRules.add(gitignoreContent.split(`\n`));
            ignoreRules.add('**/.gitignore');
            ignoreRules.add('**/.deployignore');
        }
        return ignoreRules;
    }
    DeployTools.getDefaultIgnoreRules = getDefaultIgnoreRules;
})(DeployTools = exports.DeployTools || (exports.DeployTools = {}));
//# sourceMappingURL=deployTools.js.map