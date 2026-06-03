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
exports.deactivate = exports.activate = void 0;
// The module 'vscode' contains the VS Code extensibility API
const vscode_1 = require("vscode");
// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
const path_1 = __importDefault(require("path"));
const IBMi_1 = __importDefault(require("./api/IBMi"));
const copyToImport_1 = require("./api/components/copyToImport");
const cqsh_1 = require("./api/components/cqsh");
const getMemberInfo_1 = require("./api/components/getMemberInfo");
const getNewLibl_1 = require("./api/components/getNewLibl");
const manager_1 = require("./api/components/manager");
const parser_1 = require("./api/errors/parser");
const customCli_1 = require("./api/tests/components/customCli");
const Configuration_1 = require("./config/Configuration");
const Debug = __importStar(require("./debug"));
const customEditorProvider_1 = require("./editors/customEditorProvider");
const ifsFs_1 = require("./filesystems/ifsFs");
const deployTools_1 = require("./filesystems/local/deployTools");
const deployment_1 = require("./filesystems/local/deployment");
const instantiate_1 = require("./instantiate");
const completion_1 = require("./languages/actions/completion");
const mergeProfiles_1 = require("./mergeProfiles");
const testing_1 = require("./testing");
const Tools_1 = require("./ui/Tools");
const actions_1 = require("./ui/actions");
const ConnectionBrowser_1 = require("./ui/views/ConnectionBrowser");
const LibraryListView_1 = require("./ui/views/LibraryListView");
const debugView_1 = require("./ui/views/debugView");
const environmentView_1 = require("./ui/views/environment/environmentView");
const helpView_1 = require("./ui/views/helpView");
const ifsBrowser_1 = require("./ui/views/ifsBrowser");
const objectBrowser_1 = require("./ui/views/objectBrowser");
const searchView_1 = require("./ui/views/searchView");
const uri_1 = require("./uri");
const open_1 = require("./uri/handlers/open");
const sandbox_1 = require("./uri/handlers/sandbox");
const CustomUI_1 = require("./webviews/CustomUI");
const settings_1 = require("./webviews/settings");
async function activate(context) {
    // Use the console to output diagnostic information (console.log) and errors (console.error)
    // This line of code will only be executed once when your extension is activated
    console.log(`Congratulations, your extension "code-for-ibmi" is now active!`);
    await (0, instantiate_1.loadAllofExtension)(context);
    const updateLastConnectionAndServerCache = () => {
        const connections = IBMi_1.default.connectionManager.getAll();
        const lastConnections = (IBMi_1.default.GlobalStorage.getLastConnections() || []).filter(lc => connections.find(c => c.name === lc.name));
        IBMi_1.default.GlobalStorage.setLastConnections(lastConnections);
        vscode_1.commands.executeCommand(`setContext`, `code-for-ibmi:hasPreviousConnection`, lastConnections.length > 0);
        IBMi_1.default.GlobalStorage.deleteStaleServerSettingsCache(connections);
        vscode_1.commands.executeCommand(`code-for-ibmi.refreshConnections`);
    };
    settings_1.SettingsUI.init(context);
    (0, ConnectionBrowser_1.initializeConnectionBrowser)(context);
    (0, objectBrowser_1.initializeObjectBrowser)(context);
    (0, ifsBrowser_1.initializeIFSBrowser)(context);
    (0, debugView_1.initializeDebugBrowser)(context);
    (0, searchView_1.initializeSearchView)(context);
    (0, LibraryListView_1.initializeLibraryListView)(context);
    (0, environmentView_1.initializeEnvironmentView)(context);
    context.subscriptions.push(vscode_1.window.registerTreeDataProvider(`helpView`, new helpView_1.HelpView(context)), (0, Configuration_1.onCodeForIBMiConfigurationChange)("connections", updateLastConnectionAndServerCache), (0, Configuration_1.onCodeForIBMiConfigurationChange)("connectionSettings", async () => {
        const connection = instantiate_1.instance.getConnection();
        if (connection) {
            const config = connection.getConfig();
            if (config) {
                Object.assign(config, (await IBMi_1.default.connectionManager.load(config.name)));
            }
        }
    }), vscode_1.workspace.registerFileSystemProvider(`streamfile`, new ifsFs_1.IFSFS(), {
        isCaseSensitive: false
    }), vscode_1.languages.registerCompletionItemProvider({ language: 'json', pattern: "**/.vscode/actions.json" }, new completion_1.LocalActionCompletionItemProvider(), "&"), vscode_1.window.registerCustomEditorProvider(`code-for-ibmi.editor`, new customEditorProvider_1.CustomEditorProvider(), {
        webviewOptions: {
            retainContextWhenHidden: true
        }
    }));
    (0, actions_1.registerActionTools)(context);
    Debug.initialize(context);
    deployment_1.Deployment.initialize(context);
    updateLastConnectionAndServerCache();
    (0, sandbox_1.initializeSandbox)();
    console.log(`Developer environment: ${process.env.DEV}`);
    if (process.env.DEV) {
        // Run tests if not in production build
        (0, testing_1.initialise)(context);
        // Test user-component
        manager_1.extensionComponentRegistry.registerComponent(context, new customCli_1.CustomCLI());
    }
    instantiate_1.instance.subscribe(context, 'connected', `Refresh views`, () => {
        vscode_1.commands.executeCommand("code-for-ibmi.refreshObjectBrowser");
        vscode_1.commands.executeCommand("code-for-ibmi.refreshLibraryListView");
        vscode_1.commands.executeCommand("code-for-ibmi.refreshIFSBrowser");
        vscode_1.commands.executeCommand("code-for-ibmi.environment.refresh");
    });
    const customQsh = new cqsh_1.CustomQSh();
    customQsh.setLocalAssetPath(path_1.default.join(context.extensionPath, `dist`, customQsh.getFileName()));
    manager_1.extensionComponentRegistry.registerComponent(context, customQsh);
    manager_1.extensionComponentRegistry.registerComponent(context, new getNewLibl_1.GetNewLibl);
    manager_1.extensionComponentRegistry.registerComponent(context, new getMemberInfo_1.GetMemberInfo());
    manager_1.extensionComponentRegistry.registerComponent(context, new copyToImport_1.CopyToImport());
    (0, uri_1.registerURIHandler)(context, sandbox_1.sandboxURIHandler, open_1.openURIHandler);
    await (0, mergeProfiles_1.mergeCommandProfiles)();
    return {
        instance: instantiate_1.instance,
        customUI: () => new CustomUI_1.CustomUI(),
        customEditor: (target, onSave, onClosed) => new customEditorProvider_1.CustomEditor(target, onSave, onClosed),
        deployTools: deployTools_1.DeployTools,
        evfeventParser: parser_1.parseErrors,
        tools: Tools_1.VscodeTools,
        componentRegistry: manager_1.extensionComponentRegistry
    };
}
exports.activate = activate;
// this method is called when your extension is deactivated
async function deactivate() {
    await vscode_1.commands.executeCommand(`code-for-ibmi.disconnect`, true);
}
exports.deactivate = deactivate;
//# sourceMappingURL=extension.js.map