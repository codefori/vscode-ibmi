import vscode from 'vscode';
import { ConnectionConfig, ConnectionData, Server } from '../../typings';

import { instance } from '../../instantiate';
import { Login } from '../../webviews/login';
import IBMi from '../../api/IBMi';
import { deleteStoredPassword, getStoredPassword, setStoredPassword } from '../../config/passwords';

type CopyOperationItem = {
  label: string
  picked: true
  copy: (from: ConnectionConfig, to: ConnectionConfig) => void
}

export function initializeConnectionBrowser(context: vscode.ExtensionContext) {
  const connectionBrowser = new ConnectionBrowser(context);
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
      const lastConnection = IBMi.GlobalStorage.getLastConnections()?.[0];
      if (lastConnection) {
        return await vscode.commands.executeCommand(`code-for-ibmi.connectTo`, lastConnection.name);
      }
    }),

    vscode.commands.registerCommand(`code-for-ibmi.connectTo`, async (name?: string | Server, reloadServerSettings?: boolean) => {
      if (!connectionBrowser.attemptingConnection) {
        connectionBrowser.attemptingConnection = true;

        if (!name) {
          const lastConnections = IBMi.GlobalStorage.getLastConnections() || [];
          if (lastConnections && lastConnections.length) {
            name = (await vscode.window.showQuickPick([{ kind: vscode.QuickPickItemKind.Separator, label: vscode.l10n.t(`Last connection`) },
            ...lastConnections.map(lc => ({ label: lc.name, description: vscode.l10n.t(`Last used: {0}`, new Date(lc.timestamp).toLocaleString()) }))],
              { title: vscode.l10n.t(`Last IBM i connections`) }
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
            vscode.window.showErrorMessage(vscode.l10n.t(`Use the Server Browser to select which system to connect to.`));
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
        const existingConnections = await IBMi.connectionManager.getAll();
        const newName = await vscode.window.showInputBox({
          prompt: vscode.l10n.t(`Rename connection "{0}"`, server.name),
          value: server.name,
          validateInput: newName => {
            if (newName === server.name) {
              return vscode.l10n.t(`New connection name must be different from its current name`);
            } else if (existingConnections.findIndex(item => item.name === newName) !== -1) {
              return vscode.l10n.t(`Connection "{0}" already exists.`, newName);
            }
          }
        });

        if (newName) {
          try {
            // First rename the connection details
            let { index, data } = (await IBMi.connectionManager.getByName(server.name))!
            if (index === -1) throw (vscode.l10n.t(`No connection named "{0}" was found`, server.name));
            data.name = newName;
            await IBMi.connectionManager.updateByIndex(index, data);

            // Then rename the connection settings
            const connectionSettings = IBMi.connectionManager.get<ConnectionConfig[]>(`connectionSettings`) || [];
            index = connectionSettings.findIndex(connection => connection.name === server.name);
            if (index === -1) throw (vscode.l10n.t(`No parameters for connection "{0}" was found`, server.name));
            connectionSettings[index].name = newName;

            // Then get the cached connection settings
            const cachedConnectionSettings = IBMi.GlobalStorage.getServerSettingsCache(server.name);

            // Then get the password key
            const secret = await getStoredPassword(context, server.name);

            // No errors - update the settings.
            await IBMi.connectionManager.set(`connectionSettings`, connectionSettings);
            if (cachedConnectionSettings) {
              IBMi.GlobalStorage.setServerSettingsCache(newName, cachedConnectionSettings);
              IBMi.GlobalStorage.deleteServerSettingsCache(server.name);
            }
            if (secret) {
              await setStoredPassword(context, newName, secret);
              await deleteStoredPassword(context, server.name);
            }

            connectionBrowser.refresh();
          } catch (e: any) {
            vscode.window.showErrorMessage(
              vscode.l10n.t(`Error renaming connection "{0}"! {1}`, server.name,  e.message || String(e)));
          }
        }
      }
    }),

    vscode.commands.registerCommand(`code-for-ibmi.sortConnections`, async () => {
      await IBMi.connectionManager.sort();
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
        const message = toBeDeleted.length === 1 ? vscode.l10n.t(`Are you sure you want to delete the connection "{0}"?`, toBeDeleted[0].name) : vscode.l10n.t("Are you sure you want to delete these {0} connections?", toBeDeleted.length);
        const detail = toBeDeleted.length === 1 ? undefined : toBeDeleted.map(server => `- ${server.name}`).join("\n");
        if (await vscode.window.showWarningMessage(message, { modal: true, detail }, vscode.l10n.t(`Yes`))) {
          for (const server of toBeDeleted) {
            // First remove the connection details
            await IBMi.connectionManager.deleteByName(server.name);

            // Also remove the connection settings
            const connectionSettings = IBMi.connectionManager.get<ConnectionConfig[]>(`connectionSettings`) || [];
            const newConnectionSettings = connectionSettings.filter(connection => connection.name !== server.name);
            await IBMi.connectionManager.set(`connectionSettings`, newConnectionSettings);

            // Also remove the cached connection settings
            IBMi.GlobalStorage.deleteServerSettingsCache(server.name);

            // Then remove the password
            await deleteStoredPassword(context, server.name);
          }

          connectionBrowser.refresh();
        }
      }
    }),
    vscode.commands.registerCommand(`code-for-ibmi.copyConnection`, async (server: Server) => {
      const connectionSettings = IBMi.connectionManager.get<ConnectionConfig[]>(`connectionSettings`) || [];

      const connection = IBMi.connectionManager.getByName(server.name);
      const connectionSetting = connectionSettings.find(connection => server.name === connection.name);

      if (connection && connectionSetting) {
        let newConnectionName;
        let copyOperations;
        do {
          newConnectionName = await vscode.window.showInputBox({
            prompt: vscode.l10n.t(`Copy connection "{0}"`, server.name),
            placeHolder: vscode.l10n.t(`New connection name`),
            value: newConnectionName,
            validateInput: async value => await IBMi.connectionManager.getByName(value) ?
              vscode.l10n.t(`Connection "{0}" already exists`, value) :
              undefined
          });

          if (newConnectionName) {
            copyOperations = (await vscode.window.showQuickPick<CopyOperationItem>([
              { label: vscode.l10n.t(`Home directory`), picked: true, copy: (from, to) => to.homeDirectory = from.homeDirectory },
              { label: vscode.l10n.t(`Library list`), picked: true, copy: (from, to) => { to.libraryList = from.libraryList; to.currentLibrary = from.currentLibrary; } },
              { label: vscode.l10n.t(`Object filters`), picked: true, copy: (from, to) => to.objectFilters = from.objectFilters },
              { label: vscode.l10n.t(`IFS shortcuts`), picked: true, copy: (from, to) => to.ifsShortcuts = from.ifsShortcuts },
              { label: vscode.l10n.t(`Custom variables`), picked: true, copy: (from, to) => to.customVariables = from.customVariables },
              { label: vscode.l10n.t(`Command profiles`), picked: true, copy: (from, to) => to.commandProfiles = from.commandProfiles },
              { label: vscode.l10n.t(`Connection profiles`), picked: true, copy: (from, to) => to.connectionProfiles = from.connectionProfiles }
            ],
              {
                canPickMany: true,
                title: vscode.l10n.t(`Select the settings to copy from "{0}" to "{1}"`, server.name,  newConnectionName)
              }))?.map(picked => picked.copy);
          }
        } while (newConnectionName && !copyOperations);

        if (newConnectionName && copyOperations) {
          const newConnection = Object.assign({}, connection.data);
          newConnection.name = newConnectionName;
          await IBMi.connectionManager.storeNew(newConnection);

          const newConnectionSetting = Object.assign({}, connectionSetting);
          newConnectionSetting.name = newConnectionName;
          newConnectionSetting.homeDirectory = '.';
          newConnectionSetting.currentLibrary = '';
          newConnectionSetting.libraryList = [];
          newConnectionSetting.objectFilters = [];
          newConnectionSetting.ifsShortcuts = [];
          newConnectionSetting.customVariables = [];
          newConnectionSetting.commandProfiles = [];
          newConnectionSetting.connectionProfiles = [];
          copyOperations.forEach(operation => operation(connectionSetting, newConnectionSetting));
          connectionSettings.push(newConnectionSetting);
          await IBMi.connectionManager.set(`connectionSettings`, connectionSettings);

          const password = await getStoredPassword(context, server.name);
          if (password) {
            await setStoredPassword(context, newConnectionName, password);
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

  constructor(context: vscode.ExtensionContext) {
    instance.subscribe(context, 'disconnected', 'Refresh Connection Browser', () => this.refresh());
  }

  refresh() {
    this._emitter.fire(null);
  }

  getTreeItem(element: ServerItem): vscode.TreeItem {
    return element;
  }

  async getChildren(): Promise<ServerItem[]> {
    const lastConnection = IBMi.GlobalStorage.getLastConnections()?.[0];
    return IBMi.connectionManager.getAll()
      .map(connection => new ServerItem(connection, connection.name === lastConnection?.name));
  }
}

class ServerItem extends vscode.TreeItem implements Server {
  constructor(readonly connection: ConnectionData, lastConnected?: boolean) {
    super(connection.name, vscode.TreeItemCollapsibleState.None);
    const readOnly = (IBMi.connectionManager.get<ConnectionConfig[]>(`connectionSettings`) || [])
      .find(settings => connection.name === settings.name)
      ?.readOnlyMode

    this.contextValue = `server`;
    this.description = `${connection.username}@${connection.host}`;
    this.tooltip = lastConnected ? vscode.l10n.t(` (previous connection)`) : "";
    this.iconPath = new vscode.ThemeIcon(readOnly ? `lock` : `remote`, lastConnected ? new vscode.ThemeColor("notificationsWarningIcon.foreground") : undefined);

    this.command = {
      command: `code-for-ibmi.connectTo`,
      title: vscode.l10n.t(`Connect`),
      arguments: [this]
    };
  }

  get name() {
    return this.connection.name;
  }
}
