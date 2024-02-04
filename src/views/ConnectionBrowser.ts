import vscode from 'vscode';
import { ConnectionData, Server } from '../typings';

import { ConnectionConfiguration, GlobalConfiguration } from '../api/Configuration';
import { GlobalStorage } from '../api/Storage';
import { instance } from '../instantiate';
import { t } from "../locale";
import { Login } from '../webviews/login';
import { SettingsUI } from '../webviews/settings';

export class ObjectBrowserProvider {
  private _attemptingConnection: boolean;
  private readonly _emitter: vscode.EventEmitter<ServerItem | undefined | null | void>;
  readonly onDidChangeTreeData: vscode.Event<ServerItem | undefined | null | void>;

  constructor(context: vscode.ExtensionContext) {
    this._attemptingConnection = false;
    this._emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._emitter.event;

    SettingsUI.init(context);

    context.subscriptions.push(
      vscode.commands.registerCommand(`code-for-ibmi.connect`, () => {
        if (!this._attemptingConnection) {
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
        if (!this._attemptingConnection) {
          this._attemptingConnection = true;

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

          this._attemptingConnection = false;
        }
      }),

      vscode.commands.registerCommand(`code-for-ibmi.connectToAndReload`, async (server: Server) => {
        if (!this._attemptingConnection && server) {
          const reloadServerSettings = true;
          vscode.commands.executeCommand(`code-for-ibmi.connectTo`, server.name, reloadServerSettings);
        }
      }),

      vscode.commands.registerCommand(`code-for-ibmi.refreshConnections`, () => {
        this.refresh();
      }),

      vscode.commands.registerCommand(`code-for-ibmi.deleteConnection`, (server: Server) => {
        if (!this._attemptingConnection && server) {
          vscode.window.showWarningMessage(
            t(`connectionBrowser.deleteConnection.warning`, server.name),
            t(`Yes`), t(`No`)
          ).then(async (value) => {
            if (value === t(`Yes`)) {
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

              this.refresh();
            }
          });
        }
      })
    );

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
