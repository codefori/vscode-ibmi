"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupGitEventHandler = exports.getGitBranch = void 0;
const vscode_1 = require("vscode");
const env_1 = require("./env");
const instantiate_1 = require("../../instantiate");
const IBMi_1 = __importDefault(require("../../api/IBMi"));
const Tools_1 = require("../../ui/Tools");
const lastBranch = {};
function getGitBranch(workspaceFolder) {
    const gitApi = Tools_1.VscodeTools.getGitAPI();
    if (gitApi) {
        const repo = gitApi.getRepository(workspaceFolder.uri);
        if (repo) {
            return repo.state.HEAD?.name;
        }
    }
}
exports.getGitBranch = getGitBranch;
function setupGitEventHandler(context) {
    const gitApi = Tools_1.VscodeTools.getGitAPI();
    if (gitApi) {
        gitApi.onDidOpenRepository((repo) => {
            const workspaceUri = repo.rootUri.toString();
            const changeEvent = repo.state.onDidChange((_e) => {
                if (IBMi_1.default.connectionManager.get(`createLibraryOnBranchChange`)) {
                    if (repo) {
                        const head = repo.state.HEAD;
                        const connection = instantiate_1.instance.getConnection();
                        if (head && head.name) {
                            const currentBranch = head.name;
                            if (currentBranch && currentBranch !== lastBranch[workspaceUri]) {
                                if (connection) {
                                    const content = connection.getContent();
                                    const config = connection.getConfig();
                                    if (currentBranch.includes(`/`)) {
                                        setupBranchLibrary(currentBranch, content, connection, config);
                                    }
                                }
                            }
                            lastBranch[workspaceUri] = currentBranch;
                        }
                    }
                }
            });
            context.subscriptions.push(changeEvent);
        });
    }
}
exports.setupGitEventHandler = setupGitEventHandler;
function setupBranchLibrary(currentBranch, content, connection, config) {
    const filters = config.objectFilters;
    const newBranchLib = (0, env_1.getBranchLibraryName)(currentBranch);
    content.checkObject({ library: `QSYS`, name: newBranchLib, type: `*LIB` }).then(exists => {
        if (exists) {
            if (!filters.some(filter => filter.library.toUpperCase() === newBranchLib)) {
                vscode_1.window.showInformationMessage(`The branch library ${newBranchLib} exists for this branch. Do you want to create a filter?`, `Yes`, `No`).then(answer => {
                    if (answer === `Yes`) {
                        filters.push({
                            name: currentBranch,
                            filterType: `simple`,
                            library: newBranchLib,
                            object: `*ALL`,
                            types: [`*ALL`],
                            member: `*`,
                            memberType: `*`,
                            protected: false
                        });
                        config.objectFilters = filters;
                        IBMi_1.default.connectionManager.update(config).then(() => {
                            vscode_1.commands.executeCommand(`code-for-ibmi.refreshObjectBrowser`);
                        });
                    }
                });
            }
        }
        else {
            vscode_1.window.showInformationMessage(`Would you like to create a new library ${newBranchLib} for this branch?`, `Yes`, `No`).then(answer => {
                if (answer === `Yes`) {
                    const escapedText = currentBranch.replace(/'/g, `''`);
                    connection.runCommand({ command: `CRTLIB LIB(${newBranchLib}) TEXT('${escapedText}') TYPE(*TEST)`, noLibList: true })
                        .then((createResult) => {
                        if (createResult && createResult.code === 0) {
                            vscode_1.window.showInformationMessage(`Library ${newBranchLib} created. Use '&BRANCHLIB' as a reference to it.`, `Create filter`).then(answer => {
                                if (answer === `Create filter`) {
                                    filters.push({
                                        name: currentBranch,
                                        filterType: `simple`,
                                        library: newBranchLib,
                                        object: `*ALL`,
                                        types: [`*ALL`],
                                        member: `*`,
                                        memberType: `*`,
                                        protected: false
                                    });
                                    config.objectFilters = filters;
                                    IBMi_1.default.connectionManager.update(config).then(() => {
                                        vscode_1.commands.executeCommand(`code-for-ibmi.refreshObjectBrowser`);
                                    });
                                }
                            });
                        }
                        else {
                            vscode_1.window.showErrorMessage(`Error creating library ${newBranchLib}: ${createResult ? createResult.stderr : `Unknown error`}`);
                        }
                    });
                }
            });
        }
    });
}
//# sourceMappingURL=git.js.map