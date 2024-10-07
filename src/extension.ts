// The module 'vscode' contains the VS Code extensibility API
import { ExtensionContext, commands, languages, window, workspace } from "vscode";

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed

import { CustomUI } from "./api/CustomUI";
import { instance, loadAllofExtension } from './instantiate';

import { CompileTools } from "./api/CompileTools";
import { ConnectionConfiguration, ConnectionManager, GlobalConfiguration, onCodeForIBMiConfigurationChange } from "./api/Configuration";
import IBMi from "./api/IBMi";
import { GlobalStorage } from "./api/Storage";
import { Tools } from "./api/Tools";
import * as Debug from './api/debug';
import { parseErrors } from "./api/errors/parser";
import { DeployTools } from "./api/local/deployTools";
import { Deployment } from "./api/local/deployment";
import { CopyToImport } from "./components/copyToImport";
import { GetMemberInfo } from "./components/getMemberInfo";
import { GetNewLibl } from "./components/getNewLibl";
import { extensionComponentRegistry } from "./components/manager";
import { IFSFS } from "./filesystems/ifsFs";
import { LocalActionCompletionItemProvider } from "./languages/actions/completion";
import { updateLocale } from "./locale";
import * as Sandbox from "./sandbox";
import { initialise } from "./testing";
import { CodeForIBMi, ConnectionData } from "./typings";
import { initializeConnectionBrowser } from "./views/ConnectionBrowser";
import { LibraryListProvider } from "./views/LibraryListView";
import { ProfilesView } from "./views/ProfilesView";
import { initializeDebugBrowser } from "./views/debugView";
import { HelpView } from "./views/helpView";
import { initializeIFSBrowser } from "./views/ifsBrowser";
import { initializeObjectBrowser } from "./views/objectBrowser";
import { initializeSearchView } from "./views/searchView";
import { SettingsUI } from "./webviews/settings";

export async function activate(context: ExtensionContext): Promise<CodeForIBMi> {
  // Use the console to output diagnostic information (console.log) and errors (console.error)
  // This line of code will only be executed once when your extension is activated
  console.log(`Congratulations, your extension "code-for-ibmi" is now active!`);

  await loadAllofExtension(context);
  const updateLastConnectionAndServerCache = () => {
    const connections = ConnectionManager.getAll();
    const lastConnections = (GlobalStorage.get().getLastConnections() || []).filter(lc => connections.find(c => c.name === lc.name));
    GlobalStorage.get().setLastConnections(lastConnections);
    commands.executeCommand(`setContext`, `code-for-ibmi:hasPreviousConnection`, lastConnections.length > 0);
    GlobalStorage.get().deleteStaleServerSettingsCache(connections);
    commands.executeCommand(`code-for-ibmi.refreshConnections`);
  };

  SettingsUI.init(context);
  initializeConnectionBrowser(context);
  initializeObjectBrowser(context)
  initializeIFSBrowser(context);
  initializeDebugBrowser(context);
  initializeSearchView(context);

  context.subscriptions.push(
    window.registerTreeDataProvider(
      `helpView`,
      new HelpView(context)
    ),
    window.registerTreeDataProvider(
      `libraryListView`,
      new LibraryListProvider(context)
    ),
    window.registerTreeDataProvider(
      `profilesView`,
      new ProfilesView(context)
    ),
    commands.registerCommand(`code-for-ibmi.connectDirect`,
      async (connectionData: ConnectionData, reloadSettings = false, savePassword = false): Promise<boolean> => {
        const existingConnection = instance.getConnection();

        if (existingConnection) {
          return false;
        }

        if (savePassword && connectionData.password) {
          await ConnectionManager.setStoredPassword(context, connectionData.name, connectionData.password);
        }

        return (await new IBMi().connect(connectionData, undefined, reloadSettings)).success;
      }
    ),
    onCodeForIBMiConfigurationChange("locale", updateLocale),
    onCodeForIBMiConfigurationChange("connections", updateLastConnectionAndServerCache),
    onCodeForIBMiConfigurationChange("connectionSettings", async () => {
      const connection = instance.getConnection();
      if (connection) {
        const config = instance.getConfig();
        if (config) {
          Object.assign(config, (await ConnectionConfiguration.load(config.name)));
        }
      }
    }),
    workspace.registerFileSystemProvider(`streamfile`, new IFSFS(), {
      isCaseSensitive: false
    }),
    languages.registerCompletionItemProvider({ language: 'json', pattern: "**/.vscode/actions.json" }, new LocalActionCompletionItemProvider(), "&")
  );

  CompileTools.register(context);
  GlobalStorage.initialize(context);
  Debug.initialize(context);
  Deployment.initialize(context);
  updateLastConnectionAndServerCache();

  Sandbox.handleStartup();
  Sandbox.registerUriHandler(context);

  console.log(`Developer environment: ${process.env.DEV}`);
  if (process.env.DEV) {
    // Run tests if not in production build
    initialise(context);
  }

  instance.subscribe(
    context,
    'connected',
    `Refresh views`,
    () => {
      commands.executeCommand("code-for-ibmi.refreshObjectBrowser");
      commands.executeCommand("code-for-ibmi.refreshLibraryListView");
      commands.executeCommand("code-for-ibmi.refreshIFSBrowser");
      commands.executeCommand("code-for-ibmi.refreshProfileView");
    });

  extensionComponentRegistry.registerComponent(context, GetNewLibl);
  extensionComponentRegistry.registerComponent(context, GetMemberInfo);
  extensionComponentRegistry.registerComponent(context, CopyToImport);

  return {
    instance, customUI: () => new CustomUI(),
    deployTools: DeployTools,
    evfeventParser: parseErrors,
    tools: Tools,
    componentRegistry: extensionComponentRegistry
  };
}

async function fixLoginSettings() {
  const connections = (GlobalConfiguration.get<ConnectionData[]>(`connections`) || []);
  let update = false;
  for (const connection of connections) {
    //privateKey was used to hold privateKeyPath 
    if ('privateKey' in connection) {
      const privateKey = connection["privateKey"] as string;
      if (privateKey) {
        connection.privateKeyPath = privateKey;
      }
      delete connection["privateKey"];
      update = true;
    }

    //An empty privateKeyPath will crash the connection
    if (!connection.privateKeyPath?.trim()) {
      connection.privateKeyPath = undefined;
      update = true;
    }

    //buttons were added by the login settings page
    if (`buttons` in connection) {
      delete connection["buttons"];
      update = true;
    }
  }

  if (update) {
    await GlobalConfiguration.set(`connections`, connections);
  }
}

// this method is called when your extension is deactivated
export async function deactivate() {
  await commands.executeCommand(`code-for-ibmi.disconnect`, true);
}
