// The module 'vscode' contains the VS Code extensibility API
import { ExtensionContext, window, commands, workspace } from "vscode";

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed

import { setupEmitter, instance, setConnection, loadAllofExtension } from './Instance';
import { CustomUI, Field } from "./api/CustomUI";

import {ObjectBrowserProvider} from "./views/ConnectionBrowser";
import IBMi from "./api/IBMi";
import { ConnectionConfiguration } from "./api/Configuration";

export function activate(context: ExtensionContext) {

  // Use the console to output diagnostic information (console.log) and errors (console.error)
  // This line of code will only be executed once when your extension is activated
  console.log(`Congratulations, your extension "code-for-ibmi" is now active!`);

  //We setup the event emitter.
  setupEmitter();

  context.subscriptions.push(
    window.registerTreeDataProvider(
      `connectionBrowser`,
      new ObjectBrowserProvider(context)
    ),

    commands.registerCommand(`code-for-ibmi.connectDirect`,
      async (connectionData : ConnectionData) : Promise<boolean> => {
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
      const connection = instance.getConnection();
      if (connection) {
        const config = instance.getConfig();

        if (config && event.affectsConfiguration(`code-for-ibmi.connectionSettings`)) {
          Object.assign(config, (await ConnectionConfiguration.load(config.name)));
        }
      }
    })
  )

  return { instance, CustomUI, Field, baseContext: context };
}

// this method is called when your extension is deactivated
export function deactivate() { }