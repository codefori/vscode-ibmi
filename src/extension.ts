// The module 'vscode' contains the VS Code extensibility API
import { commands, ExtensionContext, l10n, languages, window, workspace } from "vscode";

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed

import path from "path";
import IBMi from "./api/IBMi";
import { CopyToImport } from "./api/components/copyToImport";
import { CustomQSh } from "./api/components/cqsh";
import { GetMemberInfo } from "./api/components/getMemberInfo";
import { GetNewLibl } from "./api/components/getNewLibl";
import { extensionComponentRegistry } from "./api/components/manager";
import { parseErrors } from "./api/errors/parser";
import { CustomCLI } from "./api/tests/components/customCli";
import { onCodeForIBMiConfigurationChange } from "./config/Configuration";
import * as Debug from './debug';
import { CustomEditor, CustomEditorProvider } from "./editors/customEditorProvider";
import { IFSFS } from "./filesystems/ifsFs";
import { DeployTools } from "./filesystems/local/deployTools";
import { Deployment } from "./filesystems/local/deployment";
import { instance, loadAllofExtension } from './instantiate';
import { LocalActionCompletionItemProvider } from "./languages/actions/completion";
import { initialise } from "./testing";
import { CodeForIBMi } from "./typings";
import { VscodeTools } from "./ui/Tools";
import { registerActionTools } from "./ui/actions";
import { initializeConnectionBrowser } from "./ui/views/ConnectionBrowser";
import { initializeLibraryListView } from "./ui/views/LibraryListView";
import { initializeContextView } from "./ui/views/contextView";
import { initializeDebugBrowser } from "./ui/views/debugView";
import { HelpView } from "./ui/views/helpView";
import { initializeIFSBrowser } from "./ui/views/ifsBrowser";
import { initializeObjectBrowser } from "./ui/views/objectBrowser";
import { initializeSearchView } from "./ui/views/searchView";
import { registerURIHandler } from "./uri";
import { openURIHandler } from "./uri/handlers/open";
import { initializeSandbox, sandboxURIHandler } from "./uri/handlers/sandbox";
import { CustomUI } from "./webviews/CustomUI";
import { SettingsUI } from "./webviews/settings";

export async function activate(context: ExtensionContext): Promise<CodeForIBMi> {
  // Use the console to output diagnostic information (console.log) and errors (console.error)
  // This line of code will only be executed once when your extension is activated
  console.log(`Congratulations, your extension "code-for-ibmi" is now active!`);

  await loadAllofExtension(context);

  const updateLastConnectionAndServerCache = () => {
    const connections = IBMi.connectionManager.getAll();
    const lastConnections = (IBMi.GlobalStorage.getLastConnections() || []).filter(lc => connections.find(c => c.name === lc.name));
    IBMi.GlobalStorage.setLastConnections(lastConnections);
    commands.executeCommand(`setContext`, `code-for-ibmi:hasPreviousConnection`, lastConnections.length > 0);
    IBMi.GlobalStorage.deleteStaleServerSettingsCache(connections);
    commands.executeCommand(`code-for-ibmi.refreshConnections`);
  };

  SettingsUI.init(context);
  initializeConnectionBrowser(context);
  initializeObjectBrowser(context)
  initializeIFSBrowser(context);
  initializeDebugBrowser(context);
  initializeSearchView(context);
  initializeLibraryListView(context);
  initializeContextView(context);

  context.subscriptions.push(
    window.registerTreeDataProvider(
      `helpView`,
      new HelpView(context)
    ),

    onCodeForIBMiConfigurationChange("connections", updateLastConnectionAndServerCache),
    onCodeForIBMiConfigurationChange("connectionSettings", async () => {
      const connection = instance.getConnection();
      if (connection) {
        const config = connection.getConfig();
        if (config) {
          Object.assign(config, (await IBMi.connectionManager.load(config.name)));
        }
      }
    }),
    workspace.registerFileSystemProvider(`streamfile`, new IFSFS(), {
      isCaseSensitive: false
    }),
    languages.registerCompletionItemProvider({ language: 'json', pattern: "**/.vscode/actions.json" }, new LocalActionCompletionItemProvider(), "&"),
    window.registerCustomEditorProvider(`code-for-ibmi.editor`, new CustomEditorProvider(), {
      webviewOptions: {
        retainContextWhenHidden: true
      }
    })
  );

  registerActionTools(context);
  Debug.initialize(context);
  Deployment.initialize(context);
  updateLastConnectionAndServerCache();

  initializeSandbox();

  console.log(`Developer environment: ${process.env.DEV}`);
  if (process.env.DEV) {
    // Run tests if not in production build
    initialise(context);

    // Test user-component
    extensionComponentRegistry.registerComponent(context, new CustomCLI());
  }

  instance.subscribe(
    context,
    'connected',
    `Refresh views`,
    () => {
      commands.executeCommand("code-for-ibmi.refreshObjectBrowser");
      commands.executeCommand("code-for-ibmi.refreshLibraryListView");
      commands.executeCommand("code-for-ibmi.refreshIFSBrowser");
      commands.executeCommand("code-for-ibmi.context.refresh");
    });

  const customQsh = new CustomQSh();
  customQsh.setLocalAssetPath(path.join(context.extensionPath, `dist`, customQsh.getFileName()));

  extensionComponentRegistry.registerComponent(context, customQsh);
  extensionComponentRegistry.registerComponent(context, new GetNewLibl);
  extensionComponentRegistry.registerComponent(context, new GetMemberInfo());
  extensionComponentRegistry.registerComponent(context, new CopyToImport());

  registerURIHandler(context,
    sandboxURIHandler,
    openURIHandler
  );

  await mergeCommandProfiles();

  return {
    instance,
    customUI: () => new CustomUI(),
    customEditor: (target, onSave) => new CustomEditor(target, onSave),
    deployTools: DeployTools,
    evfeventParser: parseErrors,
    tools: VscodeTools,
    componentRegistry: extensionComponentRegistry
  };
}

// this method is called when your extension is deactivated
export async function deactivate() {
  await commands.executeCommand(`code-for-ibmi.disconnect`, true);
}

async function mergeCommandProfiles() {
  const connectionSettings = IBMi.connectionManager.getConnectionSettings();
  let updateSettings = false;
  for (const settings of connectionSettings.filter(setting => setting.commandProfiles)) {
    for (const commandProfile of settings.commandProfiles) {
      settings.connectionProfiles.push({
        name: commandProfile.name as string,
        setLibraryListCommand: commandProfile.command as string,
        currentLibrary: "QGPL",
        customVariables: [],
        homeDirectory: settings.homeDirectory,
        ifsShortcuts: [],
        libraryList: ["QGPL", "QTEMP"],
        objectFilters: []
      });
    }
    delete settings.commandProfiles;
    updateSettings = true;
  }
  if (updateSettings) {
    window.showInformationMessage(
      l10n.t("Your Command Profiles have been turned into Profiles since these two concepts have been merged with this new version of the Code for IBM i extension."),
      { modal: true, detail: l10n.t("Open the Context view once connected to find your profile(s) and run your library list command(s).") });
    await IBMi.connectionManager.updateAll(connectionSettings);
  }
}