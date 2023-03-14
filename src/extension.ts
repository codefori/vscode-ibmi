// The module 'vscode' contains the VS Code extensibility API
import { ExtensionContext, window, commands, workspace, extensions } from "vscode";

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed

import { setupEmitter, instance, setConnection, loadAllofExtension } from './instantiate';
import { CustomUI, Field } from "./api/CustomUI";

import { ObjectBrowserProvider } from "./views/ConnectionBrowser";
import IBMi from "./api/IBMi";
import { ConnectionConfiguration, GlobalConfiguration } from "./api/Configuration";
import { CodeForIBMi, ConnectionData } from "./typings";
import * as Sandbox from "./sandbox";
import { Deployment } from "./api/local/deployment";
import { parseErrors } from "./api/errors/handler";
import { GlobalStorage } from "./api/Storage";

export function activate(context: ExtensionContext): CodeForIBMi {
  // Use the console to output diagnostic information (console.log) and errors (console.error)
  // This line of code will only be executed once when your extension is activated
  console.log(`Congratulations, your extension "code-for-ibmi" is now active!`);

  //We setup the event emitter.
  setupEmitter();

  const checkLastConnections = () => {
    const connections = (GlobalConfiguration.get<ConnectionData[]>(`connections`) || []);
    const lastConnections = (GlobalStorage.get().getLastConnections() || []).filter(lc => connections.find(c => c.name === lc.name));
    GlobalStorage.get().setLastConnections(lastConnections);
    commands.executeCommand(`setContext`, `code-for-ibmi:hasPreviousConnection`, lastConnections.length > 0);
  };

  context.subscriptions.push(
    window.registerTreeDataProvider(
      `connectionBrowser`,
      new ObjectBrowserProvider(context)
    ),

    commands.registerCommand(`code-for-ibmi.connectDirect`,
      async (connectionData: ConnectionData): Promise<boolean> => {
        const existingConnection = instance.getConnection();

        if (existingConnection) return false;

        const connection = new IBMi();
        const connected = await connection.connect(connectionData);
        if (connected.success) {
          setConnection(connection);
          loadAllofExtension(context);
        }

        return connected.success;
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
    })
  );

  GlobalStorage.initialize(context);
  checkLastConnections();

  Sandbox.handleStartup();
  Sandbox.registerUriHandler(context);

  return { instance, CustomUI, Field, baseContext: context, deploy: Deployment.deploy, evfeventParser: parseErrors };
}

// this method is called when your extension is deactivated
export function deactivate() { }
