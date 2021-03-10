const vscode = require(`vscode`);

const IBMi = require(`../../api/IBMi`);
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

    ui.addField(new Field(`input`, `host`, `Host or IP Address`));
    ui.addField(new Field(`input`, `port`, `Port`));
    ui.fields[1].default = `22`;
    ui.addField(new Field(`input`, `username`, `Username`));
    ui.addField(new Field(`password`, `password`, `Password`));
    ui.addField(new Field(`input`, `privateKey`, `Path to Private Key`));
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

          let existingConnectionsConfig = vscode.workspace.getConfiguration(`code-for-ibmi`);
          let existingConnections = existingConnectionsConfig.get(`connections`);
          if (!existingConnections.find(item => item.host === data.host)) {
            existingConnections.push({
              host: data.host,
              port: data.port,
              username: data.username,
              privateKey: data.privateKey
            });
            await existingConnectionsConfig.update(`connections`, existingConnections, vscode.ConfigurationTarget.Global);
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

    const existingConnectionsConfig = vscode.workspace.getConfiguration(`code-for-ibmi`);
    const existingConnections = existingConnectionsConfig
      .get(`connections`)
      .map(item => ({
        label: `${item.username}@${item.host}:${item.port}`,
        config: item
      }));

    const selected = await vscode.window.showQuickPick(existingConnections, {canPickMany: false});

    if (selected) {
      let connectionConfig = selected[`config`];

      if (!connectionConfig.privateKey) {
        connectionConfig.password = await vscode.window.showInputBox({
          prompt: `Password for ${selected[`label`]}`,
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

        } else {
          vscode.window.showErrorMessage(`Not connected to ${connectionConfig.host}! ${connected.error.message || connected.error}`);
        }
      } catch (e) {
        vscode.window.showErrorMessage(`Error connecting to ${connectionConfig.host}! ${e.message}`);
      }
    }
  }
  
}