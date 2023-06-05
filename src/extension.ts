// The module 'vscode' contains the VS Code extensibility API
import { ExtensionContext, commands, window, workspace } from "vscode";

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed

import { CustomUI } from "./api/CustomUI";
import { instance, loadAllofExtension } from './instantiate';

import { CompileTools } from "./api/CompileTools";
import { ConnectionConfiguration, GlobalConfiguration } from "./api/Configuration";
import IBMi from "./api/IBMi";
import { GlobalStorage } from "./api/Storage";
import * as Debug from './api/debug';
import { parseErrors } from "./api/errors/handler";
import { Deployment } from "./api/local/deployment";
import { IFSFS } from "./filesystems/ifsFs";
import * as Sandbox from "./sandbox";
import { initialise } from "./testing";
import { CodeForIBMi, ConnectionData } from "./typings";
import { ObjectBrowserProvider } from "./views/ConnectionBrowser";
import { LibraryListProvider } from "./views/LibraryListView";
import { ProfilesView } from "./views/ProfilesView";
import { HelpView } from "./views/helpView";
import IFSBrowser from "./views/ifsBrowser";
import SPLFBrowser from "./views/splfBrowser";
import ObjectBrowser from "./views/objectBrowser";

export async function activate(context: ExtensionContext): Promise<CodeForIBMi> {
  // Use the console to output diagnostic information (console.log) and errors (console.error)
  // This line of code will only be executed once when your extension is activated
  console.log(`Congratulations, your extension "code-for-ibmi-w" is now active!`);

  await loadAllofExtension(context);

  const checkLastConnections = () => {
    const connections = (GlobalConfiguration.get<ConnectionData[]>(`connections`) || []);
    const lastConnections = (GlobalStorage.get().getLastConnections() || []).filter(lc => connections.find(c => c.name === lc.name));
    GlobalStorage.get().setLastConnections(lastConnections);
    commands.executeCommand(`setContext`, `code-for-ibmi:hasPreviousConnection`, lastConnections.length > 0);
  };

  new IFSBrowser(context);
  new SPLFBrowser(context);
  new ObjectBrowser(context);

  context.subscriptions.push(
    window.registerTreeDataProvider(
      `connectionBrowser`,
      new ObjectBrowserProvider(context)
    ),
    window.registerTreeDataProvider(
      `helpView`,
      new HelpView()
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
      async (connectionData: ConnectionData, reloadSettings = false): Promise<boolean> => {
        const existingConnection = instance.getConnection();

        if (existingConnection) {
          return false;
        }

        return (await new IBMi().connect(connectionData, undefined, reloadSettings)).success;
      }
    ),
    workspace.onDidChangeConfiguration(async event => {
      if (event.affectsConfiguration(`code-for-ibmi.connections`)) {
        checkLastConnections();
      }

      const connection = instance.getConnection();
      if (connection) {
        const config = instance.getConfig();
        if (config && event.affectsConfiguration(`code-for-ibmi.connectionSettings`)) {
          Object.assign(config, (await ConnectionConfiguration.load(config.name)));
        }
      }
    }),
    workspace.registerFileSystemProvider(`streamfile`, new IFSFS(), {
      isCaseSensitive: false
    })
  );

  CompileTools.register(context);
  GlobalStorage.initialize(context);
  Debug.initialize(context);
  Deployment.initialize(context);
  checkLastConnections();

  Sandbox.handleStartup();
  Sandbox.registerUriHandler(context);

  console.log(`Developer environment: ${process.env.DEV}`);
  if (process.env.DEV) {
    // Run tests if not in production build
    initialise(context);
  }

  instance.onEvent(`connected`, () => {
    Promise.all([
      commands.executeCommand("code-for-ibmi.refreshObjectBrowser"),
      commands.executeCommand("code-for-ibmi.refreshLibraryListView"),
      commands.executeCommand("code-for-ibmi.refreshIFSBrowser"),
      commands.executeCommand("code-for-ibmi.refreshProfileView")
    ]);
  })

  return { instance, customUI: () => new CustomUI(), deploy: Deployment.deploy, evfeventParser: parseErrors };
}

// this method is called when your extension is deactivated
export function deactivate() { }
