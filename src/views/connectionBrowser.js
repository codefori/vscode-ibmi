
const vscode = require(`vscode`);

const Configuration = require(`../api/Configuration`);

const LoginPanel = require(`../webviews/login`);
const settingsUI = require(`../webviews/settings`);

module.exports = class objectBrowserProvider {
  /**
   * @param {vscode.ExtensionContext} context
   */
  constructor(context) {
    this.attemptingConnection = false;
    this.emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.emitter.event;

    settingsUI.init(context);

    context.subscriptions.push(
      vscode.commands.registerCommand(`code-for-ibmi.connect`, () => {
        if (this.attemptingConnection) return;
        LoginPanel.show(context);
      }),
      
      vscode.commands.registerCommand(`code-for-ibmi.connectPrevious`, async (name) => {
        if (this.attemptingConnection) return;

        this.attemptingConnection = true;

        switch (typeof name) {
        case `string`: // Name of connection object
          await LoginPanel.LoginToPrevious(name, context);
          break;
        case `object`: // Usually a connection object
          await LoginPanel.LoginToPrevious(name.name, context);
          break;
        default:
          vscode.window.showErrorMessage(`Use the Server Browser to select which system to connect to.`);
          break;
        }

        this.attemptingConnection = false;
      }),

      vscode.commands.registerCommand(`code-for-ibmi.refreshConnections`, () => {
        this.refresh();
      }),

      vscode.commands.registerCommand(`code-for-ibmi.deleteConnection`, (element) => {
        if (this.attemptingConnection) return;

        if (element) {
          vscode.window.showWarningMessage(
            `Are you sure you want to delete the connection ${element.label}?`,
            `Yes`, `No`
          ).then(async (value) => {
            if (value === `Yes`) {
              // First remove the connection details
              const connections = Configuration.get(`connections`);
              const newConnections = connections.filter(connection => connection.name !== element.label);
              await Configuration.setGlobal(`connections`, newConnections);

              // Also remove the connection settings
              const connectionSettings = Configuration.get(`connectionSettings`);
              const newConnectionSettings = connectionSettings.filter(connection => connection.name !== element.label);
              await Configuration.setGlobal(`connectionSettings`, newConnectionSettings);

              // Then remove the password
              context.secrets.delete(`${element.label}_password`);

              this.refresh();
            }
          });
        }
      })
    );
  }

  refresh() {
    this.emitter.fire();
  }

  /**
   * @param {vscode.TreeItem} element
   * @returns {vscode.TreeItem};
   */
  getTreeItem(element) {
    return element;
  }

  /**
   * @returns {Promise<vscode.TreeItem[]>};
   */
  async getChildren() {
    let items = [];

    const connections = Configuration.get(`connections`);

    for (const connection of connections) {
      items.push(new Server(connection.name, connection.username, connection.host));
    }
    
    return items;
  }
}

class Server extends vscode.TreeItem {
  /**
   * @param {string} name
   * @param {string} user
   * @param {string} host
   */
  constructor(name, user, host) {
    super(name, vscode.TreeItemCollapsibleState.None);

    this.name = name;
    this.contextValue = `server`;
    this.description = `${user}@${host}`;
    this.iconPath = new vscode.ThemeIcon(`remote`);

    this.command = {
      command: `code-for-ibmi.connectPrevious`,
      title: `Connect`,
      arguments: [name]
    };
  }
}
