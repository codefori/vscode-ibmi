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
exports.startDebug = exports.initialize = exports.isManaged = void 0;
const vscode_1 = require("vscode");
const path_1 = __importDefault(require("path"));
const vscode = __importStar(require("vscode"));
const DebugConfiguration_1 = require("../api/configuration/DebugConfiguration");
const passwords_1 = require("../config/passwords");
const env_1 = require("../filesystems/local/env");
const instantiate_1 = require("../instantiate");
const Tools_1 = require("../ui/Tools");
const certificates = __importStar(require("./certificates"));
const server = __importStar(require("./server"));
const debugExtensionId = `IBM.ibmidebug`;
const debugContext = 'code-for-ibmi:debug';
// TODO: Remove this by 4.0.0
const debugSEPContext = 'code-for-ibmi:debug.SEP';
// These context values are used for walkthroughs only
const ptfContext = `code-for-ibmi:debug.ptf`;
let connectionConfirmed = false;
let temporaryPassword;
function isManaged() {
    return process.env[`DEBUG_MANAGED`] === `true`;
}
exports.isManaged = isManaged;
const activateDebugExtension = async () => {
    const debugclient = vscode.extensions.getExtension(debugExtensionId);
    if (debugclient && !debugclient.isActive) {
        await debugclient.activate();
    }
};
const debugExtensionAvailable = () => {
    const debugclient = vscode.extensions.getExtension(debugExtensionId);
    return debugclient && debugclient.isActive;
};
async function initialize(context) {
    const startDebugging = async (type, objectType, objectLibrary, objectName, env) => {
        if (debugExtensionAvailable()) {
            const connection = instantiate_1.instance.getConnection();
            if (connection) {
                const config = connection.getConfig();
                if (connection.remoteFeatures[`startDebugService.sh`]) {
                    const password = await getPassword();
                    const libraries = {
                        currentLibrary: config?.currentLibrary,
                        libraryList: config?.libraryList
                    };
                    // If we are debugging from a workspace, perhaps
                    // the user has a custom CURLIB and LIBL setup.
                    if (env) {
                        if (env[`CURLIB`]) {
                            libraries.currentLibrary = env[`CURLIB`];
                        }
                        if (env[`LIBL`]) {
                            libraries.libraryList = env[`LIBL`].split(` `);
                        }
                    }
                    if (!isManaged()) {
                        try {
                            await certificates.checkClientCertificate(connection);
                        }
                        catch (error) {
                            vscode.window.showWarningMessage(`Debug Service Certificate issue.`, { detail: String(error), modal: true }, "Setup")
                                .then(setup => {
                                if (setup) {
                                    vscode.commands.executeCommand(`code-for-ibmi.debug.setup.local`);
                                }
                            });
                            return;
                        }
                    }
                    if (password) {
                        let debugOpts = {
                            password,
                            library: objectLibrary,
                            object: objectName,
                            libraries
                        };
                        if (type === `sep`) {
                            debugOpts.sep = {
                                type: objectType
                            };
                        }
                        startDebug(instantiate_1.instance, debugOpts);
                    }
                }
            }
        }
        else {
            vscode.window.showInformationMessage(`Debug extension missing`, {
                detail: `The IBM i Debug extension is not installed. It can be installed from the Marketplace.`,
                modal: true
            }, `Go to Marketplace`).then(result => {
                if (result) {
                    vscode.commands.executeCommand('code-for-ibmi.debug.extension');
                }
            });
        }
    };
    let cachedResolvedTypes = {};
    const getObjectType = async (library, objectName) => {
        const path = library + `/` + objectName;
        if (cachedResolvedTypes[path]) {
            return cachedResolvedTypes[path];
        }
        else {
            const connection = instantiate_1.instance.getConnection();
            const [row] = await connection.runSQL(`select OBJTYPE from table(qsys2.object_statistics('${library}', '*PGM *SRVPGM', '${objectName}')) X`);
            if (row) {
                cachedResolvedTypes[path] = row.OBJTYPE;
                return row.OBJTYPE;
            }
            ;
        }
    };
    const getObjectFromUri = (uri, env) => {
        const connection = instantiate_1.instance.getConnection();
        const qualifiedPath = { library: undefined, object: undefined };
        if (connection) {
            const configuration = connection.getConfig();
            switch (uri.scheme) {
                case `member`:
                    const memberPath = connection.parserMemberPath(uri.path);
                    qualifiedPath.library = memberPath.library;
                    qualifiedPath.object = memberPath.name;
                    break;
                case `streamfile`:
                    const streamfilePath = path_1.default.parse(uri.path);
                    qualifiedPath.library = env?.CURLIB || configuration.currentLibrary;
                    qualifiedPath.object = streamfilePath.name;
                    break;
                case `file`:
                    const localPath = path_1.default.parse(uri.path);
                    qualifiedPath.library = env?.CURLIB || configuration.currentLibrary;
                    qualifiedPath.object = localPath.name;
                    break;
            }
            if (qualifiedPath.object) {
                // Remove .pgm ending potentially
                qualifiedPath.object = connection.upperCaseName(qualifiedPath.object);
                if (qualifiedPath.object.endsWith(`.PGM`))
                    qualifiedPath.object = qualifiedPath.object.substring(0, qualifiedPath.object.length - 4);
            }
        }
        return qualifiedPath;
    };
    const getPassword = async () => {
        const connection = instantiate_1.instance.getConnection();
        let password = await (0, passwords_1.getStoredPassword)(context, connection.currentConnectionName);
        if (!password) {
            password = temporaryPassword;
        }
        if (!password) {
            password = await vscode.window.showInputBox({
                password: true,
                prompt: `Password for user profile ${connection.currentUser} is required to debug. Password is not stored on device, but is stored temporarily for this connection.`
            });
            // Store for later
            temporaryPassword = password;
        }
        return password;
    };
    const validateWorkspaceFolder = (maybeFolder) => {
        if (maybeFolder && "uri" in maybeFolder && "name" in maybeFolder && "index" in maybeFolder) {
            return maybeFolder;
        }
    };
    context.subscriptions.push(vscode.commands.registerCommand(`code-for-ibmi.debug.extension`, () => {
        vscode.commands.executeCommand('extension.open', debugExtensionId);
    }), vscode.commands.registerCommand(`code-for-ibmi.debug.endDebug`, () => {
        return vscode.debug.stopDebugging();
    }), vscode.debug.onDidTerminateDebugSession(async (session) => {
        const connection = instantiate_1.instance.getConnection();
        if (connection && session.configuration.type === `IBMiDebug`) {
            server.getStuckJobs(connection).then(jobIds => {
                if (jobIds.length > 0) {
                    vscode.window.showInformationMessage(`You have ${jobIds.length} debug job${jobIds.length !== 1 ? `s` : ``} stuck at MSGW under your user profile.`, `End jobs`, `Ignore`)
                        .then(selection => {
                        if (selection === `End jobs`) {
                            server.endJobs(jobIds, connection);
                        }
                    });
                }
            });
        }
    }), vscode.commands.registerCommand(`code-for-ibmi.debug.batch`, (node, wsFolder) => {
        vscode.commands.executeCommand(`code-for-ibmi.debug`, `batch`, node, validateWorkspaceFolder(wsFolder));
    }), vscode.commands.registerCommand(`code-for-ibmi.debug.sep`, (node, wsFolder) => {
        vscode.commands.executeCommand(`code-for-ibmi.debug`, `sep`, node, validateWorkspaceFolder(wsFolder));
    }), vscode.commands.registerCommand(`code-for-ibmi.debug`, async (debugType, node, wsFolder) => {
        if (debugType && node) {
            const workspaceFolder = wsFolder || (node instanceof vscode_1.Uri ? vscode.workspace.getWorkspaceFolder(node) : undefined);
            const env = workspaceFolder ? await (0, env_1.getEnvConfig)(workspaceFolder) : undefined;
            if (node instanceof vscode_1.Uri) {
                const qualifiedObject = getObjectFromUri(node, env);
                if (qualifiedObject.library && qualifiedObject.object) {
                    const objectType = await getObjectType(qualifiedObject.library, qualifiedObject.object);
                    if (objectType) {
                        startDebugging(debugType, objectType, qualifiedObject.library, qualifiedObject.object, env);
                    }
                    else {
                        vscode.window.showErrorMessage(`Failed to determine object type. Ensure the object exists and is a program (*PGM)${debugType === "sep" ? " or service program (*SRVPGM)" : ""}.`);
                    }
                }
            }
            else {
                const { library, name, type } = node.object;
                startDebugging(debugType, type, library, name, env);
            }
        }
    }), vscode.commands.registerCommand(`code-for-ibmi.debug.setup.local`, () => vscode.window.withProgress({ title: "Downloading Debug Service Certificate", location: vscode.ProgressLocation.Window }, async () => await Tools_1.VscodeTools.withContext("code-for-ibmi:debugWorking", async () => {
        const connection = instantiate_1.instance.getConnection();
        if (connection) {
            const debugEnabled = await server.isDebugSupported(connection);
            if (debugEnabled) {
                try {
                    const remoteCertExists = await certificates.remoteCertificatesExists();
                    // If the client certificate exists on the server, download it
                    if (remoteCertExists) {
                        await certificates.downloadClientCert(connection);
                        vscode.window.showInformationMessage(`Debug client certificate downloaded from the server.`);
                    }
                }
                catch (e) {
                    vscode.window.showErrorMessage(`Failed to work with debug client certificate. See Code for IBM i logs. (${e})`);
                }
            }
            else {
                vscode.window.showInformationMessage(`Import of debug client certificate skipped as debug is either not installed or not version 3.`);
            }
            server.refreshDebugSensitiveItems();
        }
        else {
            vscode.window.showErrorMessage(`Debug PTF not installed.`);
        }
    }))), vscode.commands.registerCommand("code-for-ibmi.debug.open.service.config", () => vscode.commands.executeCommand("code-for-ibmi.openEditable", DebugConfiguration_1.ORIGINAL_DEBUG_CONFIG_FILE)));
    // Run during startup:
    instantiate_1.instance.subscribe(context, 'connected', `Load debugger status`, async () => {
        activateDebugExtension();
        const connection = instantiate_1.instance.getConnection();
        if (connection) {
            const debuggerInstalled = server.debugPTFInstalled(connection);
            const debugDetails = await (0, DebugConfiguration_1.getDebugServiceDetails)(connection);
            if (debuggerInstalled) {
                if (debugDetails.semanticVersion().major >= server.MIN_DEBUG_VERSION) {
                    vscode.commands.executeCommand(`setContext`, ptfContext, true);
                    //Enable debug related commands
                    vscode.commands.executeCommand(`setContext`, debugContext, true);
                    //Enable service entry points related commands
                    vscode.commands.executeCommand(`setContext`, debugSEPContext, true);
                    const isDebugManaged = isManaged();
                    vscode.commands.executeCommand(`setContext`, `code-for-ibmi:debugManaged`, isDebugManaged);
                    if (!isDebugManaged) {
                        if (validateIPv4address(connection.currentHost)) {
                            vscode.window.showWarningMessage(`You are using an IPv4 address to connect to this system. This may cause issues with debugging. Please use a hostname in the Login Settings instead.`);
                        }
                        // Set the debug environment variables early to be safe
                        setCertEnv(true, connection);
                        // Download the client certificate if it doesn't exist.
                        certificates.checkClientCertificate(connection).catch(() => {
                            vscode.commands.executeCommand(`code-for-ibmi.debug.setup.local`);
                        });
                    }
                }
                else {
                    const storage = instantiate_1.instance.getStorage();
                    if (storage && debugDetails.semanticVersion().major < server.MIN_DEBUG_VERSION) {
                        const debugUpdateMessageId = `debugUpdateRequired-${server.MIN_DEBUG_VERSION}`;
                        const showMessage = !storage.hasMessageBeenShown(debugUpdateMessageId);
                        if (showMessage) {
                            vscode.window.showWarningMessage(`Debug service version ${debugDetails.version} is below the minimum required version ${server.MIN_DEBUG_VERSION}.0.0. Please update the debug service PTF.`, `Open docs`, `Dismiss`).then(selected => {
                                switch (selected) {
                                    case `Open docs`:
                                        vscode_1.env.openExternal(vscode_1.Uri.parse(`https://codefori.github.io/docs/developing/debug/`));
                                        break;
                                    case `Dismiss`:
                                        storage.markMessageAsShown(debugUpdateMessageId);
                                        break;
                                }
                            });
                        }
                    }
                }
            }
        }
    });
    instantiate_1.instance.subscribe(context, 'disconnected', `Clear debugger status`, () => {
        (0, DebugConfiguration_1.resetDebugServiceDetails)();
        vscode.commands.executeCommand(`setContext`, debugContext, false);
        vscode.commands.executeCommand(`setContext`, debugSEPContext, false);
    });
}
exports.initialize = initialize;
function validateIPv4address(ipaddress) {
    if (/^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/.test(ipaddress)) {
        return (true);
    }
    return (false);
}
;
async function startDebug(instance, options) {
    const connection = instance.getConnection();
    const config = connection.getConfig();
    const storage = instance.getStorage();
    const serviceDetails = await (0, DebugConfiguration_1.getDebugServiceDetails)(connection);
    const port = config?.debugPort;
    const updateProductionFiles = config?.debugUpdateProductionFiles;
    const enableDebugTracing = config?.debugEnableDebugTracing;
    const debugIgnoreCertificateErrors = config?.debugIgnoreCertificateErrors;
    let secure = true;
    secure = setCertEnv(secure, connection);
    if (options.sep) {
        if (serviceDetails.semanticVersion().major < 2) {
            vscode.window.showErrorMessage(`The debug service on this system, version ${serviceDetails.version}, does not support service entry points.`);
            return;
        }
        // libraryName/programName programType/moduleName/procedureName
        const formattedDebugString = `${options.library.toUpperCase()}/${options.object.toUpperCase()} ${options.sep.type}/${options.sep.moduleName || `*ALL`}/${options.sep.procedureName || `*ALL`}`;
        vscode.commands.executeCommand(`ibmidebug.create-service-entry-point-with-prompt`, connection?.currentHost, connection?.currentUser.toUpperCase(), options.password, formattedDebugString, Number(config?.debugPort), Number(config?.debugSepPort));
    }
    else {
        const pathKey = options.library.trim() + `/` + options.object.trim();
        const previousCommands = storage.getDebugCommands();
        let currentCommand = previousCommands[pathKey] || `CALL PGM(` + pathKey + `)`;
        currentCommand = await vscode.window.showInputBox({
            ignoreFocusOut: true,
            title: `Debug command`,
            prompt: `Command used to start debugging the ${pathKey} program object. The command is wrapped around SBMJOB.`,
            value: currentCommand
        });
        if (currentCommand) {
            previousCommands[pathKey] = currentCommand;
            storage?.setDebugCommands(previousCommands);
            const debugConfig = {
                "type": `IBMiDebug`,
                "request": `launch`,
                "name": `IBM i batch debug: program ${options.library.toUpperCase()}/${options.object.toUpperCase()}`,
                "user": connection.currentUser.toUpperCase(),
                "password": options.password,
                "host": connection.currentHost,
                "port": port,
                "secure": secure,
                "ignoreCertificateErrors": debugIgnoreCertificateErrors,
                "subType": "batch",
                "library": options.library.toUpperCase(),
                "program": options.object.toUpperCase(),
                "startBatchJobCommand": `SBMJOB CMD(${currentCommand}) INLLIBL(${options.libraries.libraryList.join(` `)}) CURLIB(${options.libraries.currentLibrary}) JOBQ(QSYSNOMAX) MSGQ(*USRPRF) CPYENVVAR(*YES)`,
                "updateProductionFiles": updateProductionFiles,
                "trace": enableDebugTracing,
            };
            const debugResult = await vscode.debug.startDebugging(undefined, debugConfig, undefined);
            if (debugResult) {
                connectionConfirmed = true;
            }
            else {
                if (!connectionConfirmed) {
                    temporaryPassword = undefined;
                }
            }
        }
    }
}
exports.startDebug = startDebug;
function setCertEnv(secure, connection) {
    if (isManaged()) {
        // If we're in a managed environment, only set secure if a cert is set
        secure = process.env[`DEBUG_CA_PATH`] ? true : false;
    }
    else {
        process.env[`DEBUG_CA_PATH`] = certificates.getLocalCertPath(connection);
    }
    return secure;
}
//# sourceMappingURL=index.js.map