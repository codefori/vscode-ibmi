const vscode = require('vscode');

const path = require('path');
const fs = require('fs');

const IBMi = require('../../api/IBMi');

var instance = require('../../instance');

const LoginHTML = fs.readFileSync(path.join(__dirname, 'login.html'), {encoding: 'utf8'});

module.exports = class Login {
  static show() {
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
            vscode.window.showInformationMessage(`Connecting to ${message.data.host}.`);

            const connection = new IBMi();

            try {
              await connection.connect(message.data);
              panel.dispose();

              vscode.window.showInformationMessage(`Connected to ${message.data.host}!`);

              instance.setConnection(connection);
              instance.loadAllofExtension();

            } catch (e) {
              vscode.window.showErrorMessage(`Error connecting to ${message.data.host}! ${e.message}`);
            }

            return;
        }
      },
      undefined,
    );
  }
}