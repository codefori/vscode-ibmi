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
exports.Login = void 0;
const vscode_1 = __importStar(require("vscode"));
const IBMi_1 = __importDefault(require("../../api/IBMi"));
const Tools_1 = require("../../api/Tools");
const passwords_1 = require("../../config/passwords");
const instantiate_1 = require("../../instantiate");
const CustomUI_1 = require("../CustomUI");
class Login {
    /**
     * Called when logging into a brand new system
     * @param {} context
     */
    static async show(context) {
        const connection = instantiate_1.instance.getConnection();
        if (connection) {
            if (!(0, instantiate_1.safeDisconnect)())
                return;
        }
        const connectionTab = new CustomUI_1.Section()
            .addInput(`name`, `Connection Name`, undefined, { minlength: 1 })
            .addInput(`host`, vscode_1.l10n.t(`Host or IP Address`), undefined, { minlength: 1 })
            .addInput(`port`, vscode_1.l10n.t(`Port (SSH)`), ``, { default: `22`, min: 1, max: 65535, inputType: "number" })
            .addInput(`username`, vscode_1.l10n.t(`Username`), undefined, { minlength: 1, maxlength: 10 })
            .addHorizontalRule()
            .addParagraph(vscode_1.l10n.t(`Only provide either the password or a private key - not both.`))
            .addPassword(`password`, vscode_1.l10n.t(`Password`))
            .addCheckbox(`savePassword`, vscode_1.l10n.t(`Save Password`))
            .addFile(`privateKeyPath`, vscode_1.l10n.t(`Private Key`), vscode_1.l10n.t(`OpenSSH, RFC4716 and PPK formats are supported.`))
            .addHorizontalRule()
            .addInput(`readyTimeout`, vscode_1.l10n.t(`Connection Timeout (in milliseconds)`), vscode_1.l10n.t(`How long to wait for the SSH handshake to complete.`), { inputType: "number", min: 1, default: "20000" })
            .addCheckbox(`sshDebug`, vscode_1.l10n.t(`Turn on SSH debug output`), vscode_1.l10n.t(`Enable this to output debug traces in the Code for i and help diagnose SSH connection issues.`));
        const tempTab = new CustomUI_1.Section()
            .addInput(`tempLibrary`, `Temporary library`, `Temporary library. Cannot be QTEMP.`, { default: `ILEDITOR`, minlength: 1, maxlength: 10 })
            .addInput(`tempDir`, `Temporary IFS directory`, `Directory that will be used to write temporary files to. User must be authorized to create new files in this directory.`, { default: '/tmp', minlength: 1 });
        const page = await new CustomUI_1.CustomUI()
            .addComplexTabs([
            { label: `Connection`, fields: connectionTab.fields },
            { label: `Temporary data`, fields: tempTab.fields }
        ])
            .addButtons({ id: `connect`, label: `Connect`, requiresValidation: true }, { id: `saveExit`, label: `Save & Exit` })
            .loadPage(`IBM i Login`);
        if (page && page.data) {
            const data = page.data;
            page.panel.dispose();
            data.port = Number(data.port);
            data.readyTimeout = Number(data.readyTimeout);
            data.privateKeyPath = data.privateKeyPath?.trim() ? Tools_1.Tools.normalizePath(data.privateKeyPath) : undefined;
            if (data.name) {
                const existingConnection = await IBMi_1.default.connectionManager.getByName(data.name);
                if (existingConnection) {
                    vscode_1.default.window.showErrorMessage(`Connection with name ${data.name} already exists.`);
                }
                else {
                    // New connection!
                    const newConnection = {
                        name: data.name,
                        host: data.host,
                        port: data.port,
                        username: data.username,
                        privateKeyPath: data.privateKeyPath
                    };
                    if (data.savePassword && data.password) {
                        await (0, passwords_1.setStoredPassword)(context, data.name, data.password);
                    }
                    await IBMi_1.default.connectionManager.storeNew(newConnection);
                    const config = await IBMi_1.default.connectionManager.load(data.name);
                    config.tempLibrary = data.tempLibrary;
                    config.tempDir = data.tempDir;
                    IBMi_1.default.connectionManager.update(config);
                    vscode_1.default.commands.executeCommand(`code-for-ibmi.refreshConnections`);
                    switch (data.buttons) {
                        case `saveExit`:
                            vscode_1.default.window.showInformationMessage(`Connection to ${data.host} saved!`);
                            break;
                        case `connect`:
                            vscode_1.default.window.showInformationMessage(`Connecting to ${data.host}.`);
                            const toDoOnConnected = [];
                            if (!data.password && !data.privateKeyPath && await promptPassword(context, data)) {
                                toDoOnConnected.push(() => (0, passwords_1.setStoredPassword)(context, data.name, data.password));
                            }
                            if (data.password || data.privateKeyPath) {
                                try {
                                    const connected = await instantiate_1.instance.connect({ data, onConnectedOperations: toDoOnConnected });
                                    if (connected.success) {
                                        if (newConnection) {
                                            vscode_1.default.window.showInformationMessage(`Connected to ${data.host}! Would you like to configure this connection?`, `Open configuration`).then(async (selectionA) => {
                                                if (selectionA === `Open configuration`) {
                                                    vscode_1.default.commands.executeCommand(`code-for-ibmi.showAdditionalSettings`);
                                                }
                                                else {
                                                    vscode_1.default.window.showInformationMessage(`Source dates are disabled by default. Enable them in the connection settings.`, `Open configuration`).then(async (selectionB) => {
                                                        if (selectionB === `Open configuration`) {
                                                            vscode_1.default.commands.executeCommand(`code-for-ibmi.showAdditionalSettings`, undefined, `Source Code`);
                                                        }
                                                    });
                                                }
                                            });
                                        }
                                        else {
                                            vscode_1.default.window.showInformationMessage(`Connected to ${data.host}!`);
                                        }
                                    }
                                    else {
                                        vscode_1.default.window.showErrorMessage(`Not connected to ${data.host}${connected.error ? `: ${connected.error}` : '!'}`);
                                    }
                                }
                                catch (e) {
                                    vscode_1.default.window.showErrorMessage(`Error connecting to ${data.host}! ${e}`);
                                }
                            }
                            break;
                    }
                }
            }
            else {
                vscode_1.default.window.showErrorMessage(`Connection name is required.`);
            }
        }
        return;
    }
    /**
     * Start the login process to connect to a system
     * @param name Connection name
     * @param context
     */
    static async LoginToPrevious(name, context, reloadServerSettings) {
        const existingConnection = instantiate_1.instance.getConnection();
        if (existingConnection) {
            // If the user is already connected and trying to connect to a different system, disconnect them first
            if (name !== existingConnection.currentConnectionName) {
                vscode_1.default.window.showInformationMessage(`Disconnecting from ${existingConnection.currentHost}.`);
                if (!await (0, instantiate_1.safeDisconnect)())
                    return false;
            }
        }
        const connection = IBMi_1.default.connectionManager.getByName(name);
        if (connection) {
            const toDoOnConnected = [];
            const connectionConfig = connection.data;
            if (connectionConfig.privateKeyPath) {
                // If connecting with a private key, remove the password
                await (0, passwords_1.deleteStoredPassword)(context, connectionConfig.name);
            }
            else {
                // Assume connection with a password, but prompt if we don't have one        
                connectionConfig.password = await (0, passwords_1.getStoredPassword)(context, connectionConfig.name);
                if (!connectionConfig.password) {
                    if (await promptPassword(context, connectionConfig)) {
                        toDoOnConnected.push(() => (0, passwords_1.setStoredPassword)(context, connectionConfig.name, connectionConfig.password));
                    }
                }
                if (!connectionConfig.password) {
                    return false;
                }
            }
            try {
                const connected = await instantiate_1.instance.connect({ data: connectionConfig, onConnectedOperations: toDoOnConnected, reloadServerSettings });
                if (connected.success) {
                    vscode_1.default.window.showInformationMessage(`Connected to ${connectionConfig.host}!`);
                    return true;
                }
                else {
                    vscode_1.default.window.showErrorMessage(`Not connected to ${connectionConfig.host}${connected.error ? `: ${connected.error}` : '!'}`);
                }
            }
            catch (e) {
                vscode_1.default.window.showErrorMessage(`Error connecting to ${connectionConfig.host}! ${e}`);
            }
        }
        return false;
    }
}
exports.Login = Login;
async function promptPassword(context, connection) {
    let savePassword = false;
    const savePasswordLabel = "Save password and connect";
    const passwordBox = vscode_1.default.window.createInputBox();
    passwordBox.prompt = `Password for ${connection.name}`;
    passwordBox.password = true;
    passwordBox.buttons = [{
            iconPath: new vscode_1.ThemeIcon("save"),
            tooltip: savePasswordLabel
        }];
    const onClose = (button) => {
        if (button && button.tooltip === savePasswordLabel) {
            savePassword = true;
        }
        connection.password = passwordBox.value;
        passwordBox.dispose();
    };
    passwordBox.onDidTriggerButton(onClose);
    passwordBox.onDidAccept(onClose);
    passwordBox.show();
    await new Promise(resolve => passwordBox.onDidHide(resolve));
    return savePassword;
}
//# sourceMappingURL=index.js.map