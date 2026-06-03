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
const stream_1 = require("stream");
const vscode = __importStar(require("vscode"));
const IBMi_1 = __importDefault(require("./api/IBMi"));
const BaseStorage_1 = require("./api/configuration/storage/BaseStorage");
const CodeForIStorage_1 = require("./api/configuration/storage/CodeForIStorage");
const ConnectionStorage_1 = require("./api/configuration/storage/ConnectionStorage");
const Configuration_1 = require("./config/Configuration");
const env_1 = require("./filesystems/local/env");
const Tools_1 = require("./ui/Tools");
const connection_1 = require("./ui/connection");
class Instance {
    connection;
    output = {
        channel: vscode.window.createOutputChannel(`Code for IBM i`),
        content: ``,
        writeCount: 0
    };
    storage;
    emitter = new vscode.EventEmitter();
    subscribers = new Map;
    deprecationCount = 0; //TODO: remove in v3.0.0
    constructor(context) {
        this.storage = new ConnectionStorage_1.ConnectionStorage(new BaseStorage_1.BaseStorage(context.globalState));
        IBMi_1.default.GlobalStorage = new CodeForIStorage_1.CodeForIStorage(new BaseStorage_1.BaseStorage(context.globalState));
        IBMi_1.default.connectionManager.configMethod = new Configuration_1.VsCodeConfig();
        this.emitter.event(e => this.processEvent(e));
    }
    focusOutput() {
        this.output.channel.show();
    }
    getOutputContent() {
        return this.output.content;
    }
    resetOutput() {
        this.output.channel.clear();
        this.output.content = ``;
        this.output.writeCount = 0;
    }
    connect(options) {
        const connection = new IBMi_1.default();
        this.resetOutput();
        connection.appendOutput = (message) => {
            if (this.output.writeCount > 150) {
                this.resetOutput();
            }
            this.output.channel.append(message);
            this.output.content += message;
            this.output.writeCount++;
        };
        let result;
        const timeoutHandler = async (conn) => {
            if (conn) {
                const choice = await vscode.window.showWarningMessage(`Connection lost`, {
                    modal: true,
                    detail: `Connection to ${conn.currentConnectionName} has dropped. Would you like to reconnect?`
                }, `Yes`, `No, get logs`);
                let reconnect = choice === `Yes`;
                let collectLogs = choice === `No, get logs`;
                if (collectLogs) {
                    const logs = this.output.content;
                    vscode.workspace.openTextDocument({ content: logs, language: `plaintext` }).then(doc => {
                        vscode.window.showTextDocument(doc);
                    });
                }
                this.disconnect();
                if (reconnect) {
                    await this.connect({ ...options, reconnecting: true });
                }
            }
        };
        return Tools_1.VscodeTools.withContext("code-for-ibmi:connecting", async () => {
            while (true) {
                let customError;
                await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: options.data.name, cancellable: true }, async (p, cancelToken) => {
                    try {
                        const cancelEmitter = new stream_1.EventEmitter();
                        cancelToken.onCancellationRequested(() => {
                            cancelEmitter.emit(`cancel`);
                        });
                        result = await connection.connect(options.data, {
                            callbacks: {
                                timeoutCallback: timeoutHandler,
                                onConnectedOperations: options.onConnectedOperations || [],
                                uiErrorHandler: connection_1.handleConnectionResults,
                                progress: (message) => { p.report(message); },
                                message: connection_1.messageCallback,
                                cancelEmitter
                            },
                            reconnecting: options.reconnecting,
                            reloadServerSettings: options.reloadServerSettings,
                        });
                    }
                    catch (e) {
                        customError = e.message;
                        result = { success: false };
                    }
                });
                if (result.success) {
                    await this.setConnection(connection);
                    break;
                }
                else {
                    await this.disconnect();
                    if (options.reconnecting && await vscode.window.showWarningMessage(`Could not reconnect`, {
                        modal: true,
                        detail: `Reconnection has failed. Would you like to try again?\n\n${customError || `No error provided.`}`
                    }, `Yes`)) {
                        options.reconnecting = true;
                        continue;
                    }
                    else {
                        break;
                    }
                }
            }
            if (result.success === false) {
                connection.dispose();
            }
            return result;
        });
    }
    async disconnect() {
        await this.setConnection();
        await Promise.all([
            vscode.commands.executeCommand("code-for-ibmi.refreshObjectBrowser"),
            vscode.commands.executeCommand("code-for-ibmi.refreshLibraryListView"),
            vscode.commands.executeCommand("code-for-ibmi.refreshIFSBrowser")
        ]);
    }
    async setConnection(connection) {
        if (this.connection) {
            await this.connection.dispose();
        }
        if (connection) {
            connection.setDisconnectedCallback(async () => {
                this.setConnection();
                this.fire(`disconnected`);
            });
            this.connection = connection;
            this.storage.setConnectionName(connection.currentConnectionName);
            await IBMi_1.default.GlobalStorage.setLastConnection(connection.currentConnectionName);
            this.fire(`connected`);
        }
        else {
            this.connection = undefined;
            this.storage.setConnectionName("");
        }
        await vscode.commands.executeCommand(`setContext`, `code-for-ibmi:connected`, connection !== undefined);
    }
    getConnection() {
        return this.connection;
    }
    async getLibraryList(connection, workspaceFolder) {
        const config = connection.getConfig();
        const env = workspaceFolder ? (await (0, env_1.getEnvConfig)(workspaceFolder)) : {};
        const librarySetup = {
            currentLibrary: env[`CURLIB`] || config.currentLibrary,
            libraryList: env[`LIBL`]?.split(` `) || config.libraryList,
        };
        return librarySetup;
    }
    async setConfig(newConfig) {
        if (this.connection) {
            this.connection.setConfig(newConfig);
        }
        await IBMi_1.default.connectionManager.update(newConfig);
    }
    /**
     * @deprecated Will be removed in `v3.0.0`; use {@link IBMi.getConfig()} instead
     */
    getConfig() {
        console.warn("[Code for IBM i] Deprecation warning: you are using Instance::getConfig which is deprecated and will be removed in v3.0.0. Please use IBMi::getConfig instead.");
        return this.connection?.getConfig();
    }
    /**
     * @deprecated Will be removed in `v3.0.0`; use {@link IBMi.getContent()} instead
     */
    getContent() {
        console.warn("[Code for IBM i] Deprecation warning: you are using Instance::getContent which is deprecated and will be removed in v3.0.0. Please use IBMi::getContent instead.");
        return this.connection?.getContent();
    }
    getStorage() {
        return this.storage.ready ? this.storage : undefined;
    }
    /**
     * Subscribe to an {@link IBMiEvent}. When the event is triggerred, the `func` function gets executed.
     *
     * Each `context`/`name` couple must be unique.
     * @param context the extension subscribing to the event
     * @param event the {@link IBMiEvent} to subscribe to
     * @param name a human-readable name summarizing the function
     * @param func the function to execute when the {@link IBMiEvent} is triggerred
     * @param transient if `true`, the function will only be executed once during the lifetime of a connection
     */
    subscribe(context, event, name, func, transient) {
        this.getSubscribers(event).set(`${context.extension.id} - ${name}`, { func, transient });
    }
    getSubscribers(event) {
        let eventSubscribers = this.subscribers.get(event) || new Map;
        if (!this.subscribers.has(event)) {
            this.subscribers.set(event, eventSubscribers);
        }
        return eventSubscribers;
    }
    /**
     * @deprecated Will be removed in `v3.0.0`; use {@link subscribe} instead
     */
    onEvent(event, func) {
        this.getSubscribers(event).set(`deprecated - ${func.name || "unknown"}_${this.deprecationCount++}`, { func });
        console.warn("[Code for IBM i] Deprecation warning: you are using Instance::onEvent which is deprecated and will be removed in v3.0.0. Please use Instance::subscribe instead.");
    }
    fire(event) {
        this.emitter?.fire(event);
    }
    async processEvent(event) {
        const eventSubscribers = this.getSubscribers(event);
        console.time(event);
        for (const [identity, callable] of eventSubscribers.entries()) {
            try {
                console.time(identity);
                await callable.func();
                console.timeEnd(identity);
            }
            catch (error) {
                console.error(`${event} event function ${identity} failed`, error);
            }
            finally {
                if (callable.transient) {
                    eventSubscribers.delete(identity);
                }
            }
        }
        console.timeEnd(event);
    }
}
exports.default = Instance;
//# sourceMappingURL=Instance.js.map