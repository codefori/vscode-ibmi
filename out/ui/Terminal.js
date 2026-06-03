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
exports.Terminal = void 0;
const path_1 = __importDefault(require("path"));
const vscode_1 = __importStar(require("vscode"));
const IBMi_1 = __importDefault(require("../api/IBMi"));
const Tools_1 = require("../api/Tools");
const instantiate_1 = require("../instantiate");
const PASE_INIT_FLAG = '#C4IINIT';
const PASE_INIT_FLAG_REGEX = /#+C+4+I+I+N+I+T+$/;
function getOrDefaultToUndefined(value) {
    if (value && value !== `default`) {
        return value;
    }
}
var Terminal;
(function (Terminal) {
    let TerminalType;
    (function (TerminalType) {
        TerminalType["PASE"] = "PASE";
        TerminalType["_5250"] = "5250";
    })(TerminalType = Terminal.TerminalType || (Terminal.TerminalType = {}));
    const typeItems = Object.values(TerminalType).map(entry => {
        return {
            label: entry,
            type: entry
        };
    });
    let terminalCount = 0;
    function setHalted(state) {
        vscode_1.commands.executeCommand(`setContext`, `code-for-ibmi:term5250Halted`, state);
    }
    const BACKSPACE = 127;
    const RESET = 18;
    const ATTENTION = 1;
    const TAB = 9;
    function registerTerminalCommands(context) {
        return [
            vscode_1.default.commands.registerCommand(`code-for-ibmi.launchTerminalPicker`, () => {
                return selectAndOpen(context);
            }),
            vscode_1.default.commands.registerCommand(`code-for-ibmi.openTerminalHere`, async (ifsNode) => {
                const content = instantiate_1.instance.getConnection()?.getContent();
                if (content) {
                    const ifsPath = (await content.isDirectory(ifsNode.path)) ? ifsNode.path : path_1.default.dirname(ifsNode.path);
                    await selectAndOpen(context, { openType: TerminalType.PASE, currentDirectory: ifsPath });
                }
            }),
            vscode_1.default.commands.registerCommand(`code-for-ibmi.term5250.resetPosition`, () => {
                const term = vscode_1.default.window.activeTerminal;
                if (term) {
                    term.sendText(Buffer.from([RESET, TAB]).toString(), false);
                    setHalted(false);
                }
            })
        ];
    }
    Terminal.registerTerminalCommands = registerTerminalCommands;
    async function selectAndOpen(context, options) {
        const connection = instantiate_1.instance.getConnection();
        if (connection) {
            const configuration = connection.getConfig();
            const type = options?.openType || (await vscode_1.default.window.showQuickPick(typeItems, {
                placeHolder: `Select a terminal type`
            }))?.type;
            if (type) {
                const terminalSettings = {
                    type,
                    location: IBMi_1.default.connectionManager.get(`terminals.${type.toLowerCase()}.openInEditorArea`) ? vscode_1.default.TerminalLocation.Editor : vscode_1.default.TerminalLocation.Panel,
                    connectionString: configuration.connectringStringFor5250,
                    currentDirectory: options?.currentDirectory
                };
                if (terminalSettings.type === TerminalType._5250) {
                    if (!connection.remoteFeatures.tn5250) {
                        vscode_1.default.window.showErrorMessage(`5250 terminal is not supported. Please install tn5250 via yum on the remote system.`);
                        return;
                    }
                    terminalSettings.encoding = getOrDefaultToUndefined(configuration.encodingFor5250);
                    terminalSettings.terminal = getOrDefaultToUndefined(configuration.terminalFor5250);
                    if (configuration.setDeviceNameFor5250) {
                        terminalSettings.name = await vscode_1.default.window.showInputBox({
                            prompt: `Enter a device name for the terminal.`,
                            value: ``,
                            placeHolder: `Blank for default.`
                        }) || undefined;
                    }
                    // This makes it so the function keys continue to work in the terminal instead of sending them as VS Code commands
                    vscode_1.default.workspace.getConfiguration().update(`terminal.integrated.sendKeybindingsToShell`, true, true);
                }
                return createTerminal(context, connection, terminalSettings);
            }
        }
    }
    const HALTED = ` II`;
    async function createTerminal(context, connection, terminalSettings) {
        let ready = terminalSettings.type === TerminalType._5250;
        const writeEmitter = new vscode_1.default.EventEmitter();
        const channel = await connection.client.requestShell({ term: "xterm" });
        channel.on(`data`, (data) => {
            const dataString = data.toString();
            if (ready) {
                if (dataString.includes(HALTED)) {
                    setHalted(true);
                }
                writeEmitter.fire(String(data));
            }
            if (!ready) {
                ready = PASE_INIT_FLAG_REGEX.test(dataString.trim());
            }
        });
        let emulatorTerminal;
        await new Promise((resolve) => {
            emulatorTerminal = vscode_1.default.window.createTerminal({
                name: `IBM i ${terminalSettings.type}: ${connection.getConfig().name}`,
                location: terminalSettings.location,
                pty: {
                    onDidWrite: writeEmitter.event,
                    open: resolve,
                    close: () => {
                        channel.close();
                    },
                    handleInput: (data) => {
                        if (terminalSettings.type === TerminalType._5250) {
                            const buffer = Buffer.from(data);
                            switch (buffer[0]) {
                                case BACKSPACE: //Backspace
                                    //Move back one, space, move back again - deletes a character
                                    channel.stdin.write(Buffer.from([
                                        27, 79, 68,
                                        27, 91, 51, 126 //Delete character
                                    ]));
                                    break;
                                default:
                                    if (buffer[0] === RESET || buffer[0] === ATTENTION) {
                                        setHalted(false);
                                    }
                                    channel.stdin.write(data);
                                    break;
                            }
                        }
                        else {
                            channel.stdin.write(data);
                        }
                    },
                    setDimensions: (dim) => {
                        channel.setWindow(String(dim.rows), String(dim.columns), `500`, `500`);
                    }
                },
            });
            emulatorTerminal.show();
        });
        if (emulatorTerminal) {
            channel.on(`close`, () => {
                channel.destroy();
                writeEmitter.dispose();
            });
            channel.on(`exit`, (code, signal, coreDump, desc) => {
                writeEmitter.fire(`----------\r\n`);
                if (code === 0) {
                    writeEmitter.fire(`Completed successfully.\r\n`);
                }
                else if (code) {
                    writeEmitter.fire(`Exited with error code ${code}.\r\n`);
                }
                else {
                    writeEmitter.fire(`Exited with signal ${signal}.\r\n`);
                }
            });
            channel.on(`error`, (err) => {
                vscode_1.default.window.showErrorMessage(`Connection error: ${err.message}`);
                emulatorTerminal.dispose();
                channel.destroy();
            });
            if (terminalSettings.type === TerminalType._5250) {
                channel.write([
                    `/QOpenSys/pkgs/bin/tn5250`,
                    terminalSettings.encoding ? `map=${terminalSettings.encoding}` : ``,
                    terminalSettings.terminal ? `env.TERM=${terminalSettings.terminal}` : ``,
                    terminalSettings.name ? `env.DEVNAME=${terminalSettings.name}` : ``,
                    terminalSettings.connectionString || `+uninhibited localhost`,
                    `\n`
                ].join(` `));
            }
            else {
                const initialCommands = [];
                if (terminalSettings.currentDirectory) {
                    initialCommands.push(`cd ${Tools_1.Tools.escapePath(terminalSettings.currentDirectory)}`);
                }
                initialCommands.push(`echo -e "\\0033[0;32mTerminal started, thanks for using \\0033[0;34mCode for IBM i. \\0033[0;32mCurrent directory is \\0033[0;34m"$(pwd)"\\0033[0m."`);
                initialCommands.push([PASE_INIT_FLAG].join(" "));
                channel.write(`${initialCommands.join('; ')}\n`);
            }
            instantiate_1.instance.subscribe(context, 'disconnected', `Dispose Terminal ${terminalCount++}`, () => emulatorTerminal.dispose(), true);
            return emulatorTerminal;
        }
    }
})(Terminal = exports.Terminal || (exports.Terminal = {}));
//# sourceMappingURL=Terminal.js.map