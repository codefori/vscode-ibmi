const vscode = require(`vscode`);

const {default: IBMi} = require(`../../api/IBMi`);
const {CustomUI, Field} = require(`../../api/CustomUI`);
const {GlobalConfiguration} = require(`../../api/Configuration`);

let {instance, disconnect, setConnection, loadAllofExtension} = require(`../../Instance`);

module.exports = class Login {

  /**
   * Called when logging into a brand new system
   * @param {vscode.ExtensionContext} context
   */
  static async show(context) {
    if (instance.getConnection()) {
      vscode.window.showInformationMessage(`Disconnecting from ${instance.getConnection().currentHost}.`);
      if (!disconnect()) return;
    }

    let existingConnections = GlobalConfiguration.get(`connections`);

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
    
    let field = new Field(`buttons`);
    field.items = [
      {
        id: `connect`,
        label: `Connect`,
      },
      {
        id: `saveExit`,
        label: `Save & Exit`,
      }
    ];
    ui.addField(field);

    const {panel, data} = await ui.loadPage(`IBM i Login`);

    if (data) {
      panel.dispose();

      data.port = Number(data.port);

      if (data.name) {
        const existingConnection = existingConnections.find(item => item.name === data.name);

        if (existingConnection) {
          vscode.window.showErrorMessage(`Connection with name ${data.name} already exists.`);
        } else {
          
          let newConnection = (!existingConnections.some(item => item.name === data.name));
          if (newConnection) {
            // New connection!
            existingConnections.push({
              name: data.name,
              host: data.host,
              port: data.port,
              username: data.username,
              privateKey: data.privateKey
            });

            if(data.savePassword) context.secrets.store(`${data.name}_password`, `${data.password}`);

            await GlobalConfiguration.set(`connections`, existingConnections);
            vscode.commands.executeCommand(`code-for-ibmi.refreshConnections`);
          }

          switch(data.buttons) {
          case `saveExit`:
            vscode.window.showInformationMessage(`Connection to ${data.host} saved!`);
            break;
          case `connect`:
            vscode.window.showInformationMessage(`Connecting to ${data.host}.`);
            const connection = new IBMi();
      
            try {
              const connected = await connection.connect(data);
              if (connected.success) {
                setConnection(connection);
                loadAllofExtension(context);
      
                if (newConnection) {
                  
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
            break;
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
        if (!disconnect()) return false;
      }
    }

    const existingConnections = GlobalConfiguration.get(`connections`);
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

          setConnection(connection);
          loadAllofExtension(context);

        } else {
          vscode.window.showErrorMessage(`Not connected to ${connectionConfig.host}! ${connected.error.message || connected.error}`);
        }

        return true;
      } catch (e) {
        vscode.window.showErrorMessage(`Error connecting to ${connectionConfig.host}! ${e.message}`);
      }
    }

    return false;
  }
  
}