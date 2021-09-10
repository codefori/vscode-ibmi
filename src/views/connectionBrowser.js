
const vscode = require(`vscode`);

const Configuration = require(`../api/Configuration`);

const LoginPanel = require(`../webviews/login`);

module.exports = class objectBrowserProvider {
  /**
   * @param {vscode.ExtensionContext} context
   */
  constructor(context) {
    this.emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.emitter.event;

    context.subscriptions.push(
      vscode.commands.registerCommand(`code-for-ibmi.connect`, () => {
        LoginPanel.show(context);
      }),
      
      vscode.commands.registerCommand(`code-for-ibmi.connectPrevious`, (name) => {
        LoginPanel.LoginToPrevious(name, context);
      }),

      vscode.commands.registerCommand(`code-for-ibmi.refreshConnections`, () => {
        this.refresh();
      }),

      vscode.commands.registerCommand(`code-for-ibmi.deleteConnection`, (element) => {
        if (element) {
          vscode.window.showWarningMessage(
            `Are you sure you want to delete the connection ${element.label}?`,
            `Yes`, `No`
          ).then(async (value) => {
            if (value === `Yes`) {
              const connections = Configuration.get(`connections`);
              const newConnections = connections.filter(connection => connection.name !== element.label);

              await Configuration.setGlobal(`connections`, newConnections);

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
