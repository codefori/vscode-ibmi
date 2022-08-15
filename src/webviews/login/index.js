const vscode = require(`vscode`);

const IBMi = require(`../../api/IBMi`);
const {CustomUI, Field} = require(`../../api/CustomUI`);
const Configuration = require(`../../api/Configuration`);

let instance = require(`../../Instance`);

module.exports = class Login {

  /**
   * Called when logging into a brand new system
   * @param {vscode.ExtensionContext} context
   */
  static async show(context) {
    if (instance.getConnection()) {
      vscode.window.showInformationMessage(`Disconnecting from ${instance.getConnection().currentHost}.`);
      if (!instance.disconnect()) return;
    }

    let existingConnections = Configuration.get(`connections`);

    let ui = new CustomUI();

    ui.addField(new Field(`input`, `name`, `Connection Name`));
    ui.addField(new Field(`input`, `host`, `Host or IP Address`));
    ui.addField(new Field(`input`, `port`, `Port (SSH)`));
    ui.fields[2].default = `22`;
    ui.addField(new Field(`input`, `username`, `Username`));
    ui.addField(new Field(`paragraph`, `authText`, `Only provide either the password or a private key - not both.`));
    ui.addField(new Field(`password`, `password`, `Password`));
    ui.addField(new Field(`checkbox`, `savePassword`, `Save Password`));
    ui.addField(new Field(`file`, `privateKey`, `Private Key`));    
    ui.addField(new Field(`submit`, `submitButton`, `Connect`));

    const {panel, data} = await ui.loadPage(`IBM i Login`);

    if (data) {
      panel.dispose();

      data.port = Number(data.port);

      if (data.name) {
        const existingConnection = existingConnections.find(item => item.name === data.name);

        if (existingConnection) {
          vscode.window.showErrorMessage(`Connection with name ${data.name} already exists.`);
        } else {
          vscode.window.showInformationMessage(`Connecting to ${data.host}.`);

          const connection = new IBMi();
    
          try {
            const connected = await connection.connect(data);
            if (connected.success) {
              instance.setConnection(connection);
              instance.loadAllofExtension(context);
    
              if (!existingConnections.some(item => item.name === data.name)) {
                // New connection!
                existingConnections.push({
                  name: data.name,
                  host: data.host,
                  port: data.port,
                  username: data.username,
                  privateKey: data.privateKey
                });

                if(data.savePassword) context.secrets.store(`${data.name}_password`, `${data.password}`);

                await Configuration.setGlobal(`connections`, existingConnections);

                vscode.window.showInformationMessage(`Connected to ${data.host}! Would you like to configure this connection?`, `Open configuration`).then(async (selectionA) => {
                  if (selectionA === `Open configuration`) {
                    vscode.commands.executeCommand(`code-for-ibmi.showAdditionalSettings`);

                  } else {
                    vscode.window.showInformationMessage(`Source dates are disabled by default. Enable them in the connection settings.`, `Open configuration`).then(async (selectionB) => {
                      if (selectionB === `Open configuration`) {
                        vscode.commands.executeCommand(`code-for-ibmi.showAdditionalSettings`);
                      }
                    });
                  }
                });
              } else {
                vscode.window.showInformationMessage(`Connected to ${data.host}!`);
              }
    
            } else {
              vscode.window.showErrorMessage(`Not connected to ${data.host}! ${connected.error.message || connected.error}`);
            }
    
          } catch (e) {
            vscode.window.showErrorMessage(`Error connecting to ${data.host}! ${e.message}`);
          }

        }
      } else {
        vscode.window.showErrorMessage(`Connection name is required.`);
      }
    }

    return;
        
  }

  /**
   * Start the login process to connect to a system
   * @param {string} name Connection name
   * @param {vscode.ExtensionContext} context
   */
  static async LoginToPrevious(name, context) {
    if (instance.getConnection()) {

      // If the user is already connected and trying to connect to a different system, disconnect them first
      if (name !== instance.getConnection().currentConnectionName) {
        vscode.window.showInformationMessage(`Disconnecting from ${instance.getConnection().currentHost}.`);
        if (!instance.disconnect()) return;
      }
    }

    const existingConnections = Configuration.get(`connections`);
    let connectionConfig = existingConnections.find(item => item.name === name);
 
    if (connectionConfig) {
      if (!connectionConfig.privateKey) {
        connectionConfig.password = await context.secrets.get(`${connectionConfig.name}_password`);
        if(!connectionConfig.password) {
          connectionConfig.password = await vscode.window.showInputBox({
            prompt: `Password for ${connectionConfig.name}`,
            password: true
          });
        }
        
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