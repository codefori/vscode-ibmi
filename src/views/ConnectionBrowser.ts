import vscode from 'vscode';
import { ConnectionData, Server } from '../typings';

import { ConnectionConfiguration, GlobalConfiguration } from '../api/Configuration';
import { GlobalStorage } from '../api/Storage';
import { instance } from '../instantiate';
import { t } from "../locale";
import { Login } from '../webviews/login';

export function initializeConnectionBrowser(context: vscode.ExtensionContext) {
  const connectionBrowser = new ConnectionBrowser();
  const connectionTreeViewer = vscode.window.createTreeView(
    `connectionBrowser`, {
    treeDataProvider: connectionBrowser,
    showCollapseAll: false,
    canSelectMany: true
  });

  context.subscriptions.push(
    connectionTreeViewer,
    vscode.commands.registerCommand(`code-for-ibmi.connect`, () => {
      if (!connectionBrowser.attemptingConnection) {
        Login.show(context);
      }
    }),

    vscode.commands.registerCommand(`code-for-ibmi.connectToPrevious`, async () => {
      const lastConnection = GlobalStorage.get().getLastConnections()?.[0];
      if (lastConnection) {
        return await vscode.commands.executeCommand(`code-for-ibmi.connectTo`, lastConnection.name);
      }
    }),

    vscode.commands.registerCommand(`code-for-ibmi.connectTo`, async (name?: string | Server, reloadServerSettings?: boolean) => {
      if (!connectionBrowser.attemptingConnection) {
        connectionBrowser.attemptingConnection = true;

        if (!name) {
          const lastConnections = GlobalStorage.get().getLastConnections() || [];
          if (lastConnections && lastConnections.length) {
            name = (await vscode.window.showQuickPick([{ kind: vscode.QuickPickItemKind.Separator, label: t(`connectionBrowser.connectTo.lastConnection`) },
            ...lastConnections.map(lc => ({ label: lc.name, description: t(`connectionBrowser.connectTo.lastUsed`, new Date(lc.timestamp).toLocaleString()) }))],
              { title: t(`connectionBrowser.connectTo.title`) }
            ))?.label;
          }
        }

        switch (typeof name) {
          case `string`: // Name of connection object
            await Login.LoginToPrevious(name, context, reloadServerSettings);
            break;
          case `object`: // A Server object
            await Login.LoginToPrevious(name.name, context, reloadServerSettings);
            break;
          default:
            vscode.window.showErrorMessage(t(`connectionBrowser.connectTo.error`));
            break;
        }

        connectionBrowser.attemptingConnection = false;
      }
    }),

    vscode.commands.registerCommand(`code-for-ibmi.connectToAndReload`, async (server: Server) => {
      if (!connectionBrowser.attemptingConnection && server) {
        const reloadServerSettings = true;
        vscode.commands.executeCommand(`code-for-ibmi.connectTo`, server.name, reloadServerSettings);
      }
    }),

    vscode.commands.registerCommand(`code-for-ibmi.refreshConnections`, () => {
      connectionBrowser.refresh();
    }),

    vscode.commands.registerCommand(`code-for-ibmi.renameConnection`, async (server: Server) => {
      if (!connectionBrowser.attemptingConnection && server) {
        const existingConnections = GlobalConfiguration.get<ConnectionData[]>(`connections`) || [];
        const newName = await vscode.window.showInputBox({
          prompt: t(`connectionBrowser.renameConnection.prompt`, server.name),
          value: server.name,
          validateInput: newName => {
            if (newName === server.name) {
              return t(`connectionBrowser.renameConnection.invalid.input`);
            } else if (existingConnections.findIndex(item => item.name === newName) !== -1) {
              return t(`connectionBrowser.renameConnection.alreadyExists`, newName);
            }
          }
        });

        if (newName) {
          try {
            let index;
            // First rename the connection details
            const connections = GlobalConfiguration.get<ConnectionData[]>(`connections`) || [];
            index = connections.findIndex(connection => connection.name === server.name);
            if (index === -1) throw (t(`connectionBrowser.renameConnection.noConnectionFound`, server.name));
            connections[index].name = newName;

            // Then rename the connection settings
            const connectionSettings = GlobalConfiguration.get<ConnectionConfiguration.Parameters[]>(`connectionSettings`) || [];
            index = connectionSettings.findIndex(connection => connection.name === server.name);
            if (index === -1) throw (t(`connectionBrowser.renameConnection.noConnParmsFound`, server.name));
            connectionSettings[index].name = newName;

            // Then get the cached connection settings
            const cachedConnectionSettings = GlobalStorage.get().getServerSettingsCache(server.name);

            // Then get the password key
            const secret = await context.secrets.get(`${server.name}_password`);

            // No errors - update the settings.
            await GlobalConfiguration.set(`connectionSettings`, connectionSettings);
            await GlobalConfiguration.set(`connections`, connections);
            if (cachedConnectionSettings) {
              GlobalStorage.get().setServerSettingsCache(newName, cachedConnectionSettings);
              GlobalStorage.get().deleteServerSettingsCache(server.name);
            }
            if (secret) {
              await context.secrets.store(`${newName}_password`, secret);
              await context.secrets.delete(`${server.name}_password`);
            }

            connectionBrowser.refresh();
          } catch (e: any) {
            vscode.window.showErrorMessage(
              t(`connectionBrowser.renameConnection.error`, server.name, e.message || String(e)));
          }
        }
      }
    }),

    vscode.commands.registerCommand(`code-for-ibmi.sortConnections`, async () => {
      const connections = GlobalConfiguration.get<ConnectionData[]>(`connections`) || [];
      connections.sort((conn1, conn2) => conn1.name.localeCompare(conn2.name));
      await GlobalConfiguration.set(`connections`, connections);
      connectionBrowser.refresh();
    }),

    vscode.commands.registerCommand(`code-for-ibmi.deleteConnection`, async (single?: Server, servers?: Server[]) => {
      const toBeDeleted: Server[] = [];
      if (servers) {
        toBeDeleted.push(...servers);
      }
      else if (single) {
        toBeDeleted.push(single);
      }
      else {
        toBeDeleted.push(...connectionTreeViewer.selection);
      }

      if (!connectionBrowser.attemptingConnection && toBeDeleted.length) {
        const message = toBeDeleted.length === 1 ? t(`connectionBrowser.deleteConnection.warning`, toBeDeleted[0].name) : t(`connectionBrowser.deleteConnection.multiple.warning`, toBeDeleted.length);
        const detail = toBeDeleted.length === 1 ? undefined : toBeDeleted.map(server => `- ${server.name}`).join("\n");
        if (await vscode.window.showWarningMessage(message, { modal: true, detail }, t(`Yes`))) {
          for (const server of toBeDeleted) {
            // First remove the connection details
            const connections = GlobalConfiguration.get<ConnectionData[]>(`connections`) || [];
            const newConnections = connections.filter(connection => connection.name !== server.name);
            await GlobalConfiguration.set(`connections`, newConnections);

            // Also remove the connection settings
            const connectionSettings = GlobalConfiguration.get<ConnectionConfiguration.Parameters[]>(`connectionSettings`) || [];
            const newConnectionSettings = connectionSettings.filter(connection => connection.name !== server.name);
            await GlobalConfiguration.set(`connectionSettings`, newConnectionSettings);

            // Also remove the cached connection settings
            GlobalStorage.get().deleteServerSettingsCache(server.name);

            // Then remove the password
            await context.secrets.delete(`${server.name}_password`);
          }

          connectionBrowser.refresh();
        }
      }
    })
  );
}

class ConnectionBrowser implements vscode.TreeDataProvider<ServerItem> {
  public attemptingConnection: boolean = false;
  private readonly _emitter: vscode.EventEmitter<ServerItem | undefined | null | void> = new vscode.EventEmitter();
  readonly onDidChangeTreeData: vscode.Event<ServerItem | undefined | null | void> = this._emitter.event;

  constructor() {
    instance.onEvent("disconnected", () => this.refresh())
  }

  refresh() {
    this._emitter.fire(null);
  }

  getTreeItem(element: ServerItem): vscode.TreeItem {
    return element;
  }

  async getChildren(): Promise<ServerItem[]> {
    const lastConnection = GlobalStorage.get().getLastConnections()?.[0];
    return (GlobalConfiguration.get<ConnectionData[]>(`connections`) || [])
      .map(connection => new ServerItem(connection, connection.name === lastConnection?.name));
  }
}

class ServerItem extends vscode.TreeItem implements Server {
  constructor(readonly connection: ConnectionData, lastConnected?: boolean) {
    super(connection.name, vscode.TreeItemCollapsibleState.None);
    const readOnly = (GlobalConfiguration.get<ConnectionConfiguration.Parameters[]>(`connectionSettings`) || [])
      .find(settings => connection.name === settings.name)
      ?.readOnlyMode

    this.contextValue = `server`;
    this.description = `${connection.username}@${connection.host}`;
    this.tooltip = lastConnected ? t(`connectionBrowser.ServerItem.tooltip`) : "";
    this.iconPath = new vscode.ThemeIcon(readOnly ? `lock` : `remote`, lastConnected ? new vscode.ThemeColor("notificationsWarningIcon.foreground") : undefined);

    this.command = {
      command: `code-for-ibmi.connectTo`,
      title: t(`connectionBrowser.ServerItem.title`),
      arguments: [this]
    };
  }

  get name() {
    return this.connection.name;
  }
}
