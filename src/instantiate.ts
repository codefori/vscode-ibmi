import { Tools } from './api/Tools';

import path, { dirname } from 'path';
import * as vscode from "vscode";
import { CompileTools } from './api/actions/CompileTools';
import { ConnectionConfiguration, GlobalConfiguration, onCodeForIBMiConfigurationChange } from "./api/Configuration";
import Instance from "./api/Instance";
import { Search } from "./api/Search";
import { Terminal, connectTerminalCommands } from './api/Terminal';
import { refreshDiagnosticsFromServer } from './api/errors/diagnostics';
import { QSysFS, getMemberUri, getUriFromPath } from "./filesystems/qsys/QSysFs";
import { init as clApiInit } from "./languages/clle/clApi";
import * as clRunner from "./languages/clle/clRunner";
import { initGetNewLibl } from "./languages/clle/getnewlibl";
import { SEUColorProvider } from "./languages/general/SEUColorProvider";
import { Action, BrowserItem, DeploymentMethod, QsysFsOptions } from "./typings";
import { SearchView } from "./views/searchView";
import { ActionsUI } from './webviews/actions';
import { VariablesUI } from "./webviews/variables";
import IBMi from './api/IBMi';
import { connectOpenCommands } from './commands/open';
import { connectCompareCommands } from './commands/compare';
import { connectActionCommands } from './api/actions/commands';

export let instance: Instance;

const disconnectBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 12);
disconnectBarItem.command = {
  command: `code-for-ibmi.disconnect`,
  title: `Disconnect from system`
}
disconnectBarItem.tooltip = `Disconnect from system.`;
disconnectBarItem.text = `$(debug-disconnect)`;

const connectedBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10);
connectedBarItem.command = {
  command: `code-for-ibmi.showAdditionalSettings`,
  title: `Show connection settings`
};
connectedBarItem.tooltip = new vscode.MarkdownString([
  `[$(settings-gear) Settings](command:code-for-ibmi.showAdditionalSettings)`,
  `[$(file-binary) Actions](command:code-for-ibmi.showActionsMaintenance)`,
  `[$(terminal) Terminals](command:code-for-ibmi.launchTerminalPicker)`
].join(`\n\n---\n\n`), true);
connectedBarItem.tooltip.isTrusted = true;

let searchViewContext: SearchView;

export function setSearchResults(term: string, results: Search.Result[]) {
  searchViewContext.setResults(term, results);
}

export async function disconnect(): Promise<boolean> {
  let doDisconnect = true;

  for (const document of vscode.workspace.textDocuments) {
    // This code will check that sources are saved before closing
    if (!document.isClosed && [`member`, `streamfile`, `object`].includes(document.uri.scheme)) {
      if (document.isDirty) {
        if (doDisconnect) {
          if (await vscode.window.showTextDocument(document).then(() => vscode.window.showErrorMessage(`Cannot disconnect while files have not been saved.`, 'Disconnect anyway'))) {
            break;
          }
          else {
            doDisconnect = false;
          }
        }
      }
    }
  }

  if (doDisconnect) {
    const connection = instance.getConnection();
    if (connection) {
      await connection.end();
    }
  }

  return doDisconnect;
}

export async function loadAllofExtension(context: vscode.ExtensionContext) {
  // No connection when the extension is first activated
  vscode.commands.executeCommand(`setContext`, `code-for-ibmi:connected`, false);

  instance = new Instance(context);
  searchViewContext = new SearchView(context);

  connectOpenCommands(context, instance);
  connectCompareCommands(context);
  connectActionCommands(context, instance);
  connectTerminalCommands(context, instance);

  context.subscriptions.push(
    connectedBarItem,
    disconnectBarItem,
    vscode.commands.registerCommand(`code-for-ibmi.disconnect`, async (silent?: boolean) => {
      if (instance.getConnection()) {
        await disconnect();
      } else if (!silent) {
        vscode.window.showErrorMessage(`Not currently connected to any system.`);
      }
    }),
    onCodeForIBMiConfigurationChange("connectionSettings", updateConnectedBar),
    vscode.window.registerTreeDataProvider(
      `searchView`,
      searchViewContext
    ),

    vscode.commands.registerCommand(`code-for-ibmi.secret`, async (key: string, newValue: string) => {
      const connectionKey = `${instance.getConnection()!.currentConnectionName}_${key}`;
      if (newValue) {
        await context.secrets.store(connectionKey, newValue);
        return newValue;
      }

      const value = context.secrets.get(connectionKey);
      return value;
    }),
  );

  ActionsUI.initialize(context);
  VariablesUI.initialize(context);

  instance.onEvent("connected", () => onConnected(context));
  instance.onEvent("disconnected", onDisconnected);

  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider(`member`, new QSysFS(context), {
      isCaseSensitive: false
    })
  );

  // Color provider
  if (GlobalConfiguration.get<boolean>(`showSeuColors`)) {
    SEUColorProvider.intitialize(context);
  }

  clRunner.initialise(context);
}

function updateConnectedBar() {
  const config = instance.getConfig();
  if (config) {
    connectedBarItem.text = `$(${config.readOnlyMode ? "lock" : "settings-gear"}) ${config.name}`;
  }
}

async function onConnected(context: vscode.ExtensionContext) {
  const config = instance.getConfig();

  [
    connectedBarItem,
    disconnectBarItem,
  ].forEach(barItem => barItem.show());

  updateConnectedBar();

  // CL content assist
  const clExtension = vscode.extensions.getExtension(`IBM.vscode-clle`);
  if (clExtension) {
    clApiInit();
  }

  initGetNewLibl(instance);

  // Enable the profile view if profiles exist.
  vscode.commands.executeCommand(`setContext`, `code-for-ibmi:hasProfiles`, (config?.connectionProfiles || []).length > 0);
}

async function onDisconnected() {
  // Close the tabs with no dirty editors
  vscode.window.tabGroups.all
    .filter(group => !group.tabs.some(tab => tab.isDirty))
    .forEach(group => {
      group.tabs.forEach(tab => {
        if (tab.input instanceof vscode.TabInputText) {
          const uri = tab.input.uri;
          if ([`member`, `streamfile`, `object`].includes(uri.scheme)) {
            vscode.window.tabGroups.close(tab);
          }
        }
      })
    });

  // Hide the bar items
  [
    disconnectBarItem,
    connectedBarItem,
  ].forEach(barItem => barItem.hide())
}