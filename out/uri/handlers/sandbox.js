"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initializeSandbox = exports.sandboxURIHandler = void 0;
const process_1 = require("process");
const querystring_1 = __importDefault(require("querystring"));
const vscode_1 = require("vscode");
const IBMi_1 = __importDefault(require("../../api/IBMi"));
const instantiate_1 = require("../../instantiate");
const Tools_1 = require("../../ui/Tools");
/**
 * Handles /connect with the following query parameters:
 *  - `server`: the IBM i to connect to
 *  - `user`: an IBM i user profile
 *  - `pass`: the profile's password
 *  - `save` (optional): whether or not this connection should be saved
 */
exports.sandboxURIHandler = {
    canHandle: (path) => path === `/connect`,
    async handle(uri, connection) {
        if (!connection) {
            const queryData = querystring_1.default.parse(uri.query);
            const save = queryData.save === `true`;
            const server = String(queryData.server);
            let user = queryData.user;
            let pass = queryData.pass;
            if (server) {
                if (user && Array.isArray(user)) {
                    user = user[0];
                }
                else if (!user) {
                    user = await vscode_1.window.showInputBox({
                        title: vscode_1.l10n.t(`User for server`),
                        prompt: vscode_1.l10n.t(`Enter username for {0}`, server)
                    });
                }
                if (pass) {
                    pass = Buffer.from(String(pass), `base64`).toString();
                }
                else {
                    pass = await vscode_1.window.showInputBox({
                        password: true,
                        title: vscode_1.l10n.t(`Password for server`),
                        prompt: vscode_1.l10n.t(`Enter password for {0}@{1}`, String(user), server)
                    });
                }
                if (user && pass) {
                    const serverParts = String(server).split(`:`);
                    const host = serverParts[0];
                    const port = serverParts.length === 2 ? Number(serverParts[1]) : 22;
                    const connectionData = {
                        host,
                        name: `${user}-${host}`,
                        username: String(user),
                        password: String(pass),
                        port
                    };
                    const connectionResult = await vscode_1.commands.executeCommand(`code-for-ibmi.connectDirect`, connectionData);
                    if (connectionResult) {
                        await initialSetup(connectionData.username);
                        if (save) {
                            const existingConnection = IBMi_1.default.connectionManager.getByName(connectionData.name);
                            if (!existingConnection) {
                                // New connection!
                                await IBMi_1.default.connectionManager.storeNew(connectionData);
                            }
                        }
                    }
                    else {
                        vscode_1.window.showInformationMessage(vscode_1.l10n.t(`Failed to connect`), {
                            modal: true,
                            detail: vscode_1.l10n.t("Failed to connect to {0} as {1}", server, String(user))
                        });
                    }
                }
                else {
                    vscode_1.window.showErrorMessage(vscode_1.l10n.t(`Connection to {0} ended as no password was provided.`, server));
                }
            }
        }
        else {
            vscode_1.window.showInformationMessage(vscode_1.l10n.t(`Failed to connect`), {
                modal: true,
                detail: vscode_1.l10n.t(`This Visual Studio Code instance is already connected to a server.`)
            });
        }
    },
};
async function initializeSandbox() {
    let server = process_1.env.SANDBOX_SERVER;
    let username = process_1.env.SANDBOX_USER;
    let password = process_1.env.SANDBOX_PASS;
    // If Sandbox mode is enabled, then the server and username can be inherited from the branch name
    if (process_1.env.VSCODE_IBMI_SANDBOX) {
        try {
            const gitAPI = Tools_1.VscodeTools.getGitAPI();
            if (gitAPI && gitAPI.repositories && gitAPI.repositories.length > 0) {
                const repo = gitAPI.repositories[0];
                const branchName = repo.state.HEAD?.name;
                if (branchName) {
                    console.log(branchName);
                    const parts = branchName.split(`/`);
                    switch (parts.length) {
                        case 2:
                            server = parts[0];
                            username = parts[1].toUpperCase();
                            break;
                        case 1:
                            // We don't want to overwrite the username if one is set
                            username = parts[0].toUpperCase();
                            break;
                    }
                }
            }
        }
        catch (e) {
            console.log(`Git extension issue.`);
            console.log(e);
        }
        // In sandbox mode, the username and password are frequently the same
        if (username && !password)
            password = username.toUpperCase();
    }
    if (server && username && password) {
        const connectionData = {
            host: server,
            name: `Sandbox-${username}`,
            username,
            password,
            port: 22
        };
        if (process_1.env.VSCODE_IBMI_SANDBOX) {
            console.log(`Sandbox mode enabled.`);
            vscode_1.window.showInformationMessage(vscode_1.l10n.t(`Thanks for trying the Code for IBM i Sandbox!`), {
                modal: true,
                detail: vscode_1.l10n.t(`You are using this system at your own risk. Do not share any sensitive or private information.`)
            });
        }
        const connectionResult = await vscode_1.commands.executeCommand(`code-for-ibmi.connectDirect`, connectionData);
        if (connectionResult) {
            await initialSetup(connectionData.username);
        }
        else {
            vscode_1.window.showInformationMessage(vscode_1.l10n.t(`Oh no! The sandbox is down.`), {
                modal: true,
                detail: vscode_1.l10n.t(`Sorry, but the sandbox is offline right now. Try again another time.`)
            });
        }
    }
}
exports.initializeSandbox = initializeSandbox;
async function initialSetup(username) {
    const config = instantiate_1.instance.getConfig();
    if (config) {
        const libraryList = config.libraryList;
        if (!libraryList.includes(username)) {
            config.libraryList = [...config.libraryList, username];
            config.objectFilters.push({
                name: "Sandbox Sources",
                filterType: 'simple',
                library: username,
                object: "*",
                types: [
                    "*SRCPF"
                ],
                member: "*",
                memberType: "",
                protected: false
            }, {
                name: "Sandbox Object Filters",
                filterType: 'simple',
                library: username,
                object: "*",
                types: [
                    "*ALL"
                ],
                member: "*",
                memberType: "",
                protected: false
            });
            await IBMi_1.default.connectionManager.update(config);
            vscode_1.commands.executeCommand(`code-for-ibmi.refreshLibraryListView`);
            vscode_1.commands.executeCommand(`code-for-ibmi.refreshObjectBrowser`);
        }
    }
    await vscode_1.commands.executeCommand(`helpView.focus`);
}
//# sourceMappingURL=sandbox.js.map