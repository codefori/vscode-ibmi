// The module 'vscode' contains the VS Code extensibility API
import { ExtensionContext, window, commands, workspace } from "vscode";

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed

import { instance, loadAllofExtension } from './instantiate';
import { CustomUI, Field } from "./api/CustomUI";

import { ObjectBrowserProvider } from "./views/ConnectionBrowser";
import IBMi from "./api/IBMi";
import { ConnectionConfiguration, GlobalConfiguration } from "./api/Configuration";
import { CodeForIBMi, ConnectionData } from "./typings";
import * as Sandbox from "./sandbox";
import { Deployment } from "./api/local/deployment";
import { parseErrors } from "./api/errors/handler";
import { GlobalStorage } from "./api/Storage";
import { CompileTools } from "./api/CompileTools";
import { HelpView } from "./views/helpView";
import { ProfilesView } from "./views/ProfilesView";
import * as Debug from './api/debug';
import IFSBrowser from "./views/ifsBrowser";
import ObjectBrowser from "./views/objectBrowser";

export async function activate(context: ExtensionContext): Promise<CodeForIBMi> {
  // Use the console to output diagnostic information (console.log) and errors (console.error)
  // This line of code will only be executed once when your extension is activated
  console.log(`Congratulations, your extension "code-for-ibmi" is now active!`);

  await loadAllofExtension(context);

  const checkLastConnections = () => {
    const connections = (GlobalConfiguration.get<ConnectionData[]>(`connections`) || []);
    const lastConnections = (GlobalStorage.get().getLastConnections() || []).filter(lc => connections.find(c => c.name === lc.name));
    GlobalStorage.get().setLastConnections(lastConnections);
    commands.executeCommand(`setContext`, `code-for-ibmi:hasPreviousConnection`, lastConnections.length > 0);
  };

  new IFSBrowser(context);
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
      new (require(`./views/libraryListView`))(context)
    ),
    window.registerTreeDataProvider(
      `profilesView`,
      new ProfilesView(context)
    ),
    commands.registerCommand(`code-for-ibmi.connectDirect`,
      async (connectionData: ConnectionData): Promise<boolean> => {
        const existingConnection = instance.getConnection();

        if (existingConnection) {
          return false;
        }

        return (await new IBMi().connect(connectionData)).success;
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
    workspace.registerFileSystemProvider(`streamfile`, new (require(`./filesystems/ifs`)), {
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

  return { instance, customUI: () => new CustomUI(), baseContext: context, deploy: Deployment.deploy, evfeventParser: parseErrors };
}

// this method is called when your extension is deactivated
export function deactivate() { }
