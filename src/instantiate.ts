
import * as vscode from "vscode";
import { GlobalConfiguration, onCodeForIBMiConfigurationChange } from "./api/Configuration";
import Instance from "./api/Instance";
import { Terminal } from './api/Terminal';
import { getDebugServiceDetails } from './api/debug/config';
import { debugPTFInstalled, isDebugEngineRunning } from './api/debug/server';
import { setupGitEventHandler } from './api/local/git';
import { registerActionsCommands } from './commands/actions';
import { registerCompareCommands } from './commands/compare';
import { registerConnectionCommands } from './commands/connection';
import { registerOpenCommands } from './commands/open';
import { registerPasswordCommands } from './commands/password';
import { QSysFS } from "./filesystems/qsys/QSysFs";
import { SEUColorProvider } from "./languages/general/SEUColorProvider";
import { ActionsUI } from './webviews/actions';
import { VariablesUI } from "./webviews/variables";
import { getAllProfiles } from './views/ProfilesView';

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

export async function safeDisconnect(): Promise<boolean> {
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
    await instance.disconnect();
  }

  return doDisconnect;
}

export async function loadAllofExtension(context: vscode.ExtensionContext) {
  // No connection when the extension is first activated
  vscode.commands.executeCommand(`setContext`, `code-for-ibmi:connected`, false);
  vscode.workspace.getConfiguration().update(`workbench.editor.enablePreview`, false, true);

  instance = new Instance(context);
  context.subscriptions.push(
    connectedBarItem,
    disconnectBarItem,

    ...registerConnectionCommands(context, instance),

    onCodeForIBMiConfigurationChange("connectionSettings", updateConnectedBar),

    ...registerOpenCommands(instance),

    ...registerCompareCommands(instance),

    ...registerActionsCommands(instance),

    ...Terminal.registerTerminalCommands(context),

    ...registerPasswordCommands(context, instance),

    vscode.commands.registerCommand("code-for-ibmi.updateConnectedBar", updateConnectedBar),
  );

  ActionsUI.initialize(context);
  VariablesUI.initialize(context);
  instance.subscribe(context, 'connected', 'Load status bars', onConnected);
  instance.subscribe(context, 'disconnected', 'Unload status bars', onDisconnected);

  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider(`member`, new QSysFS(context), {
      isCaseSensitive: false
    })
  );

  // Color provider
  if (GlobalConfiguration.get<boolean>(`showSeuColors`)) {
    SEUColorProvider.intitialize(context);
  }

  // Register git events based on workspace folders
  if (vscode.workspace.workspaceFolders) {
    setupGitEventHandler(context);
  }
}

async function updateConnectedBar() {
  const config = instance.getConnection()?.getConfig();
  if (config) {
    connectedBarItem.text = `$(${config.readOnlyMode ? "lock" : "settings-gear"}) ${config.name}`;
  }

  const debugRunning = await isDebugEngineRunning();
  connectedBarItem.tooltip = new vscode.MarkdownString([
    `[$(settings-gear) Settings](command:code-for-ibmi.showAdditionalSettings)`,
    `[$(file-binary) Actions](command:code-for-ibmi.showActionsMaintenance)`,
    `[$(terminal) Terminals](command:code-for-ibmi.launchTerminalPicker)`,
    debugPTFInstalled() ?
      `[$(${debugRunning ? "bug" : "debug"}) Debugger ${((await getDebugServiceDetails()).version)} (${debugRunning ? "on" : "off"})](command:ibmiDebugBrowser.focus)`
      :
      `[$(debug) No debug PTF](https://codefori.github.io/docs/developing/debug/#required-ptfs)`
  ].join(`\n\n---\n\n`), true);
  connectedBarItem.tooltip.isTrusted = true;
}

async function onConnected() {
  [
    connectedBarItem,
    disconnectBarItem,
  ].forEach(barItem => barItem.show());

  updateConnectedBar();

  const connection = instance.getConnection()!;
  const profiles = await getAllProfiles(connection);
  vscode.commands.executeCommand(`setContext`, `code-for-ibmi:hasProfiles`, profiles.length > 0);
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

