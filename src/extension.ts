// The module 'vscode' contains the VS Code extensibility API
import { commands, ExtensionContext, languages, window, workspace } from "vscode";

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
import { ProfilesView } from "./ui/views/ProfilesView";
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

  context.subscriptions.push(
    window.registerTreeDataProvider(
      `helpView`,
      new HelpView(context)
    ),
    window.registerTreeDataProvider(
      `profilesView`,
      new ProfilesView(context)
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
    languages.registerCompletionItemProvider({ language: 'json', pattern: "**/.vscode/actions.json" }, new LocalActionCompletionItemProvider(), "&")
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
      commands.executeCommand("code-for-ibmi.refreshProfileView");
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

  return {
    instance, customUI: () => new CustomUI(),
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
