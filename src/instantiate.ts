
import * as vscode from "vscode";
import { getDebugServiceDetails } from './api/configuration/DebugConfiguration';
import { registerActionsCommands } from './commands/actions';
import { registerCompareCommands } from './commands/compare';
import { registerConnectionCommands } from './commands/connection';
import { registerOpenCommands } from './commands/open';
import { registerPasswordCommands } from './commands/password';
import { onCodeForIBMiConfigurationChange } from "./config/Configuration";
import { debugPTFInstalled, isDebugEngineRunning } from './debug/server';
import { setupGitEventHandler } from './filesystems/local/git';
import { QSysFS } from "./filesystems/qsys/QSysFs";
import Instance from "./Instance";
import { Terminal } from './ui/Terminal';
import { ActionsUI } from './webviews/actions';
import { VariablesUI } from "./webviews/variables";
import { RemoteConfigFile } from './api/configuration/config/types';

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

  instance = new Instance(context);
  context.subscriptions.push(
    connectedBarItem,
    disconnectBarItem,

    ...registerConnectionCommands(context, instance),

    onCodeForIBMiConfigurationChange("connectionSettings", updateConnectedBar),

    ...registerOpenCommands(instance),

    ...registerCompareCommands(),

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

  // Register git events based on workspace folders
  if (vscode.workspace.workspaceFolders) {
    setupGitEventHandler(context);
  }
}

async function updateConnectedBar() {
  const connection = instance.getConnection();
  if (connection) {
    const config = connection.getConfig();

    const remoteConnectionConfig = connection.getConfigFile<RemoteConfigFile>(`settings`);
    const serverConfigOk = remoteConnectionConfig.getState().server === `ok`;
    let serverConfig: RemoteConfigFile|undefined;
    if (serverConfigOk) {
      serverConfig = await remoteConnectionConfig.get();
    }

    const systemReadOnly = serverConfig?.codefori?.readOnlyMode || false;
    connectedBarItem.text = `$(${systemReadOnly ? "shield" : (config.readOnlyMode ? "lock" : "settings-gear")}) ${config.name}`;
    const terminalMenuItem = systemReadOnly ? `` : `[$(terminal) Terminals](command:code-for-ibmi.launchTerminalPicker)`;
    const actionsMenuItem = systemReadOnly ? `` : `[$(file-binary) Actions](command:code-for-ibmi.showActionsMaintenance)`;
    const debugRunning = await isDebugEngineRunning();
    const connectedBarItemTooltips: String[] = systemReadOnly ? [`[System-wide read only](https://codefori.github.io/docs/settings/system/)`] : [];
    connectedBarItemTooltips.push(
      `[$(settings-gear) Settings](command:code-for-ibmi.showAdditionalSettings)`,
      actionsMenuItem,
      terminalMenuItem,
      debugPTFInstalled(connection) ?
        `[$(${debugRunning ? "bug" : "debug"}) Debugger ${((await getDebugServiceDetails(connection)).version)} (${debugRunning ? "on" : "off"})](command:ibmiDebugBrowser.focus)`
        :
        `[$(debug) No debug PTF](https://codefori.github.io/docs/developing/debug/#required-ptfs)`
    );
    connectedBarItem.tooltip = new vscode.MarkdownString(connectedBarItemTooltips.join(`\n\n---\n\n`), true);
    connectedBarItem.tooltip.isTrusted = true;

    vscode.commands.executeCommand(`setContext`, `code-for-ibmi:isReadonly`, config?.readOnlyMode || systemReadOnly);
    vscode.commands.executeCommand(`setContext`, `code-for-ibmi:isSystemReadonly`, systemReadOnly);
  }
}

async function onConnected() {
  const config = instance.getConnection()?.getConfig();
  [
    connectedBarItem,
    disconnectBarItem,
  ].forEach(barItem => barItem.show());

  updateConnectedBar();

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
