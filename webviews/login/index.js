const vscode = require('vscode');

const path = require('path');
const fs = require('fs');

const IBMi = require('../../api/IBMi');
const IBMiContent = require('../../api/IBMiContent');

var instance = require('../../Instance');

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

    panel.webview.html = this.getHTML();

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

              instance.connection = connection;
              instance.content = new IBMiContent(connection);

              vscode.window.showInformationMessage(`Connected to ${message.data.host}!`);

            } catch (e) {
              vscode.window.showErrorMessage(`Error connecting to ${message.data.host}! ${e.message}`);
            }

            return;
        }
      },
      undefined,
    );
  }

  static getHTML() {
    var html = LoginHTML;

    html = html.replace(new RegExp('\\!WEBFORMS\\!', 'g'), path.join(__dirname, '..', 'webforms.css'));

    console.log(html);
    return html;
  }
}