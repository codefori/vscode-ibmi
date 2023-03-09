
import vscode from 'vscode';
import { ConnectionData, Server } from '../typings';

import { ConnectionConfiguration, GlobalConfiguration } from '../api/Configuration';
import settingsUI from '../webviews/settings';
import { Login } from '../webviews/login';

export class ObjectBrowserProvider {
  private _attemptingConnection: boolean;
  private readonly _emitter: vscode.EventEmitter<ServerItem | undefined | null | void>;
  readonly onDidChangeTreeData: vscode.Event<ServerItem | undefined | null | void>;

  constructor(context: vscode.ExtensionContext) {
    this._attemptingConnection = false;
    this._emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._emitter.event;

    settingsUI.init(context);

    context.subscriptions.push(
      vscode.commands.registerCommand(`code-for-ibmi.connect`, () => {
        if (!this._attemptingConnection) {
          Login.show(context);
        }
      }),

      vscode.commands.registerCommand(`code-for-ibmi.connectPrevious`, async (name: string | Server) => {
        if (!this._attemptingConnection) {
          this._attemptingConnection = true;

          switch (typeof name) {
            case `string`: // Name of connection object
              await Login.LoginToPrevious(name, context);
              break;
            case `object`: // A Server object
              await Login.LoginToPrevious(name.name, context);
              break;
            default:
              vscode.window.showErrorMessage(`Use the Server Browser to select which system to connect to.`);
              break;
          }

          this._attemptingConnection = false;
        }
      }),

      vscode.commands.registerCommand(`code-for-ibmi.refreshConnections`, () => {
        this.refresh();
      }),

      vscode.commands.registerCommand(`code-for-ibmi.deleteConnection`, (server: Server) => {
        if (!this._attemptingConnection && server) {
          vscode.window.showWarningMessage(
            `Are you sure you want to delete the connection ${server.name}?`,
            `Yes`, `No`
          ).then(async (value) => {
            if (value === `Yes`) {
              // First remove the connection details
              const connections = GlobalConfiguration.get<ConnectionData[]>(`connections`) || [];
              const newConnections = connections.filter(connection => connection.name !== server.name);
              await GlobalConfiguration.set(`connections`, newConnections);

              // Also remove the connection settings
              const connectionSettings = GlobalConfiguration.get<ConnectionConfiguration.Parameters[]>(`connectionSettings`) || [];
              const newConnectionSettings = connectionSettings.filter(connection => connection.name !== server.name);
              await GlobalConfiguration.set(`connectionSettings`, newConnectionSettings);

              // Then remove the password
              context.secrets.delete(`${server.name}_password`);

              this.refresh();
            }
          });
        }
      })
    );
  }

  refresh() {
    this._emitter.fire(null);
  }

  getTreeItem(element: ServerItem): vscode.TreeItem {
    return element;
  }

  async getChildren(): Promise<ServerItem[]> {
    return (GlobalConfiguration.get<ConnectionData[]>(`connections`) || [])
      .map(connection => new ServerItem(connection));
  }
}

class ServerItem extends vscode.TreeItem implements Server {
  constructor(readonly connection: ConnectionData) {
    super(connection.name, vscode.TreeItemCollapsibleState.None);
    const readOnly = (GlobalConfiguration.get<ConnectionConfiguration.Parameters[]>(`connectionSettings`) || [])
      .find(settings => connection.name === settings.name)
      ?.readOnlyMode

    this.contextValue = `server`;
    this.description = `${connection.username}@${connection.host}`;
    this.iconPath = new vscode.ThemeIcon(readOnly ? `lock` : `remote`);

    this.command = {
      command: `code-for-ibmi.connectPrevious`,
      title: `Connect`,
      arguments: [this]
    };
  }

  get name() {
    return this.connection.name;
  }
}
