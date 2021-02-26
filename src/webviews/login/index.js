const vscode = require('vscode');

const path = require('path');
const fs = require('fs');

const IBMi = require('../../api/IBMi');

var instance = require('../../Instance');

const LoginHTML = fs.readFileSync(path.join(__dirname, 'login.html'), {encoding: 'utf8'});

module.exports = class Login {

  /**
   * Called to log in to an IBM i
   * @param {vscode.ExtensionContext} context
   */
  static show(context) {
    if (instance.getConnection()) {
      vscode.window.showInformationMessage(`Disconnecting from ${instance.getConnection().currentHost}.`);
      instance.disconnect();
    }

    const panel = vscode.window.createWebviewPanel(
      'systemLogin',
      'IBM i Login',
      vscode.ViewColumn.One,
      {
        enableScripts: true
      }
    );

    panel.webview.html = LoginHTML;

    // Handle messages from the webview
    panel.webview.onDidReceiveMessage(
      async message => {
        switch (message.command) {
          case 'login':
            message.data.port = Number(message.data.port);

            vscode.window.showInformationMessage(`Connecting to ${message.data.host}.`);

            const connection = new IBMi();

            try {
              const connected = await connection.connect(message.data);
              if (connected) {
                panel.dispose();

                vscode.window.showInformationMessage(`Connected to ${message.data.host}!`);

                instance.setConnection(connection);
                instance.loadAllofExtension(context);

                var existingConnectionsConfig = vscode.workspace.getConfiguration('code-for-ibmi');
                var existingConnections = existingConnectionsConfig.get('connections');
                if (!existingConnections.find(item => item.host === message.data.host)) {
                  existingConnections.push({
                    host: message.data.host,
                    port: message.data.port,
                    username: message.data.username
                  });
                  await existingConnectionsConfig.update('connections', existingConnections, true);
                }

              } else {
                vscode.window.showErrorMessage(`Not connected to ${message.data.host}!`);
              }

            } catch (e) {
              vscode.window.showErrorMessage(`Error connecting to ${message.data.host}! ${e.message}`);
            }

            return;
        }
      },
      undefined,
    );
  }

  /**
   * Shows window which will let the user pick from previous connections
   * @param {vscode.ExtensionContext} context
   */
  static async LoginToPrevious(context) {
    if (instance.getConnection()) {
      vscode.window.showInformationMessage(`Disconnecting from ${instance.getConnection().currentHost}.`);
      instance.disconnect();
    }

    const existingConnectionsConfig = vscode.workspace.getConfiguration('code-for-ibmi');
    const existingConnections = existingConnectionsConfig.get('connections');
    const items = existingConnections.map(item => `${item.username}@${item.host}:${item.port}`);

    const selected = await vscode.window.showQuickPick(items, {canPickMany: false});

    if (selected) {
      const [username, hostname] = selected.split('@');
      const [host, port] = hostname.split(':');

      const password = await vscode.window.showInputBox({
        prompt: `Password for ${selected}`,
        password: true
      });

      if (password) {
        const connection = new IBMi();

        try {
          const connected = await connection.connect({host, port: Number(port), username, password});
          if (connected) {
            vscode.window.showInformationMessage(`Connected to ${host}!`);

            instance.setConnection(connection);
            instance.loadAllofExtension(context);

          } else {
            vscode.window.showErrorMessage(`Not connected to ${host}!`);
          }
        } catch (e) {
          vscode.window.showErrorMessage(`Error connecting to ${host}! ${e.message}`);
        }
      }
    }
  }
}