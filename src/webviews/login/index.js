const vscode = require(`vscode`);

const IBMi = require(`../../api/IBMi`);
const Configuration = require(`../../api/Configuration`);
const {CustomUI, Field} = require(`../../api/CustomUI`);

let instance = require(`../../Instance`);

module.exports = class Login {

  /**
   * Called to log in to an IBM i
   * @param {vscode.ExtensionContext} context
   */
  static async show(context) {
    if (instance.getConnection()) {
      vscode.window.showInformationMessage(`Disconnecting from ${instance.getConnection().currentHost}.`);
      if (!instance.disconnect()) return;
    }

    let ui = new CustomUI();

    ui.addField(new Field(`input`, `name`, `Connection Name`));
    ui.addField(new Field(`input`, `host`, `Host or IP Address`));
    ui.addField(new Field(`input`, `port`, `Port`));
    ui.fields[2].default = `22`;
    ui.addField(new Field(`input`, `username`, `Username`));
    ui.addField(new Field(`password`, `password`, `Password`));
    ui.addField(new Field(`file`, `privateKey`, `Private Key`));
    ui.addField(new Field(`submit`, `submitButton`, `Connect`));

    const {panel, data} = await ui.loadPage(`IBM i Login`);

    if (data) {
      data.port = Number(data.port);

      vscode.window.showInformationMessage(`Connecting to ${data.host}.`);

      const connection = new IBMi();

      try {
        const connected = await connection.connect(data);
        if (connected.success) {

          vscode.window.showInformationMessage(`Connected to ${data.host}!`);

          instance.setConnection(connection);
          instance.loadAllofExtension(context);

          ;
          let existingConnections = Configuration.get(`connections`);
          if (!existingConnections.some(item => item.name === data.name)) {
            existingConnections.push({
              name: data.name,
              host: data.host,
              port: data.port,
              username: data.username,
              privateKey: data.privateKey
            });
            await Configuration.setGlobal(`connections`, existingConnections)
          }

        } else {
          vscode.window.showErrorMessage(`Not connected to ${data.host}! ${connected.error.message || connected.error}`);
        }

        panel.dispose();

      } catch (e) {
        vscode.window.showErrorMessage(`Error connecting to ${data.host}! ${e.message}`);
      }
    }

    return;
        
  }

  /**
   * Shows window which will let the user pick from previous connections
   * @param {vscode.ExtensionContext} context
   */
  static async LoginToPrevious(context) {
    if (instance.getConnection()) {
      vscode.window.showInformationMessage(`Disconnecting from ${instance.getConnection().currentHost}.`);
      if (!instance.disconnect()) return;
    }

    const existingConnections = Configuration
      .get(`connections`)
      .map(item => ({
        label: `${item.name}`,
        config: item
      }));

    let selected = undefined;
    if (existingConnections.length === 1)
      selected = existingConnections[0];
    else
      selected = await vscode.window.showQuickPick(existingConnections, {canPickMany: false});
 
    if (selected) {
      let connectionConfig = selected[`config`];

      await this.login(context, connectionConfig);
    }
  }
  
  /**
   * Log into an existing connection by name
   * @param {vscode.ExtensionContext} context
   * @param {string} name Connection name 
   */
  static async LoginByName(context, name) {
    const existingConnections = Configuration.get(`connections`);

    const connectionConfig = existingConnections.find(conn => conn.name === name);

    if (connectionConfig) {
      await this.login(context, connectionConfig);

    } else {
      vscode.window.showErrorMessage(`Connection ${name} was not found.`);
    }
  }

  static async login(context, connectionConfig) {
    if (!connectionConfig.privateKey) {
      connectionConfig.password = await vscode.window.showInputBox({
        prompt: `Password for ${connectionConfig.name}`,
        password: true
      });
      
      if (!connectionConfig.password) {
        return;
      }
    }

    const connection = new IBMi();

    try {
      const connected = await connection.connect(connectionConfig);
      if (connected.success) {
        vscode.window.showInformationMessage(`Connected to ${connectionConfig.host}!`);

        instance.setConnection(connection);
        instance.loadAllofExtension(context);

        if (vscode.workspace.workspaceFile) {
          if (vscode.workspace.workspaceFile.scheme !== `untitled`) {
            const workspaceConnection = Configuration.get(`vscode-ibmi-connection`);
            if (!workspaceConnection) {
              let result = await vscode.window.showWarningMessage(`Do you always want to connect to ${connectionConfig.name} when opening this workspace?`, `Yes`, `No`);

              if (result === `Yes`) {
                await Configuration.setWorkspace(`vscode-ibmi-connection`, connectionConfig.name);
              }
            }
          }
        }

      } else {
        vscode.window.showErrorMessage(`Not connected to ${connectionConfig.host}! ${connected.error.message || connected.error}`);
      }
    } catch (e) {
      vscode.window.showErrorMessage(`Error connecting to ${connectionConfig.host}! ${e.message}`);
    }
  }
}