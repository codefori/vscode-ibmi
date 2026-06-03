"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CompileTools = void 0;
const IBMi_1 = __importDefault(require("./IBMi"));
const Tools_1 = require("./Tools");
const variables_1 = require("./variables");
var CompileTools;
(function (CompileTools) {
    CompileTools.NEWLINE = `\r\n`;
    CompileTools.DID_NOT_RUN = -123;
    /**
     * Execute a command
     */
    async function runCommand(connection, options, events = {}) {
        const config = connection.getConfig();
        if (config && connection) {
            const cwd = options.cwd;
            const variables = new variables_1.Variables(connection, options.env);
            const ileSetup = {
                currentLibrary: variables.get(`&CURLIB`) || config.currentLibrary,
                libraryList: variables.get(`&LIBL`)?.split(` `) || config.libraryList,
            };
            // Remove any duplicates from the library list
            ileSetup.libraryList = ileSetup.libraryList.filter(Tools_1.Tools.distinct);
            const libraryList = buildLibraryList(ileSetup);
            variables.set(`&LIBLS`, libraryList.join(` `));
            let commandString = variables.expand(options.command);
            if (events.commandConfirm) {
                commandString = await events.commandConfirm(commandString);
            }
            if (commandString) {
                const commands = commandString.split(`\n`).filter(command => command.trim().length > 0);
                if (events.writeEvent) {
                    if (options.environment === `ile` && !options.noLibList) {
                        events.writeEvent(`Current library: ` + ileSetup.currentLibrary + CompileTools.NEWLINE);
                        events.writeEvent(`Library list: ` + ileSetup.libraryList.join(` `) + CompileTools.NEWLINE);
                    }
                    if (options.cwd) {
                        events.writeEvent(`Working directory: ` + options.cwd + CompileTools.NEWLINE);
                    }
                    events.writeEvent(`Commands:\n${commands.map(command => `\t${command}\n`).join(``)}` + CompileTools.NEWLINE);
                }
                const callbacks = events.writeEvent ? {
                    onStdout: (data) => {
                        events.writeEvent(data.toString().replaceAll(`\n`, CompileTools.NEWLINE));
                    },
                    onStderr: (data) => {
                        events.writeEvent(data.toString().replaceAll(`\n`, CompileTools.NEWLINE));
                    }
                } : {};
                let commandResult;
                switch (options.environment) {
                    case `pase`:
                        commandResult = await connection.sendCommand({
                            command: commands.join(` && `),
                            directory: cwd,
                            env: variables.toPaseVariables(),
                            ...callbacks
                        });
                        break;
                    case `qsh`:
                        commandResult = await connection.sendQsh({
                            command: [
                                ...options.noLibList ? [] : buildLiblistCommands(connection, ileSetup),
                                ...commands,
                            ].join(` && `),
                            directory: cwd,
                            ...callbacks
                        });
                        break;
                    case `ile`:
                    default:
                        // escape $ and # in commands
                        commandResult = await connection.sendQsh({
                            command: [
                                ...options.noLibList ? [] : buildLiblistCommands(connection, ileSetup),
                                ...commands.map(command => `${`system "${IBMi_1.default.escapeForShell(command)}"`}`)
                            ].join(` && `),
                            directory: cwd,
                            ...callbacks
                        });
                        break;
                }
                commandResult.command = commandString;
                return commandResult;
            }
            else {
                return {
                    code: CompileTools.DID_NOT_RUN,
                    command: options.command,
                    stdout: ``,
                    stderr: `Command execution failed. (No command)`,
                };
            }
        }
        else {
            throw new Error("Please connect to an IBM i");
        }
    }
    CompileTools.runCommand = runCommand;
    function buildLibraryList(config) {
        //We have to reverse it because `liblist -a` adds the next item to the top always 
        return config.libraryList.slice(0).reverse();
    }
    function buildLiblistCommands(connection, config) {
        return [
            `liblist -d ${IBMi_1.default.escapeForShell(Tools_1.Tools.sanitizeObjNamesForPase(connection.defaultUserLibraries).join(` `))}`,
            `liblist -c ${IBMi_1.default.escapeForShell(Tools_1.Tools.sanitizeObjNamesForPase([config.currentLibrary])[0])}`,
            `liblist -a ${IBMi_1.default.escapeForShell(Tools_1.Tools.sanitizeObjNamesForPase(buildLibraryList(config)).join(` `))}`
        ];
    }
})(CompileTools = exports.CompileTools || (exports.CompileTools = {}));
//# sourceMappingURL=CompileTools.js.map