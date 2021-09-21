const vscode = require(`vscode`);

const {CustomUI, Field} = require(`../../api/CustomUI`);

const Configuration = require(`../../api/Configuration`);
let instance = require(`../../Instance`);

module.exports = class SettingsUI {

  /**
   * Called to log in to an IBM i
   * @param {vscode.ExtensionContext} context
   */
  static init(context) {

    context.subscriptions.push(
      vscode.commands.registerCommand(`code-for-ibmi.showAdditionalSettings`, async (server) => {
        const connectionSettings = Configuration.get(`connectionSettings`);
        const connection = instance.getConnection();

        let name;
        let existingConfigIndex;
        let config;

        if (server) {
          name = server.name;
          existingConfigIndex = connectionSettings.findIndex(connection => connection.name === name);

          if (existingConfigIndex >= 0) {
            config = connectionSettings[existingConfigIndex];
          } else {
            vscode.window.showErrorMessage(`Connection ${name} not found`);
            return;
          }

        } else {
          if (connection) {
            config = await instance.getConfig();
            name = config.name;
          } else {
            vscode.window.showErrorMessage(`No connection is active.`);
            return;
          }
        }

        const restartFields = [`enableSQL`, `enableSourceDates`, `sourceDateLocation`, `clContentAssistEnabled`];
        let restart = false;

        let ui = new CustomUI();
        let field;
    
        field = new Field(`input`, `tempLibrary`, `Temporary library`);
        field.default = config.tempLibrary;
        field.description = `Temporary library. Cannot be QTEMP.`;
        ui.addField(field);
    
        field = new Field(`checkbox`, `enableSQL`, `Enable SQL`);
        field.default = (config.enableSQL ? `checked` : ``);
        field.description = `Must be enabled to make the use of db2util and is enabled by default. If you find db2util isn't working for some reason, disable this. If this config is changed, you must reconnect to the system.`;
        ui.addField(field);
    
        field = new Field(`input`, `sourceASP`, `Source ASP`);
        field.default = config.sourceASP;
        field.description = `If source files live within a specific ASP, please specify it here. Leave blank otherwise. You can ignore this if you have access to <code>QSYS2.ASP_INFO</code> and have db2util installed, as Code for IBM i will fetch ASP information automatically.`;
        ui.addField(field);
    
        field = new Field(`input`, `sourceFileCCSID`, `Source file CCSID`);
        field.default = config.sourceFileCCSID;
        field.description = `The CCSID of source files on your system. You should only change this setting from <code>*FILE</code> if you have a source file that is 65535 - otherwise use <code>*FILE</code>. Note that this config is used to fetch all members. If you have any source files using 65535, you have bigger problems.`;
        ui.addField(field);
    
        field = new Field(`input`, `hideCompileErrors`, `Errors to ignore`);
        field.default = config.hideCompileErrors.join(`, `);
        field.description = `A comma delimited list of errors to be hidden from the result of an Action in the EVFEVENT file. Useful for codes like <code>RNF5409</code>.`;
        ui.addField(field);

        ui.addField(new Field(`hr`));
    
        field = new Field(`checkbox`, `enableSourceDates`, `Enable Source Dates`);
        field.default = (config.enableSourceDates ? `checked` : ``);
        field.description = `When enabled, source dates will be retained and updated when editing source members. Requires restart when changed.`;
        ui.addField(field);

        field = new Field(`select`, `sourceDateLocation`, `Source Date Location`);
        field.description = `The location of the source date of the current line will be displayed.`;
        field.items = [
          {
            selected: config.sourceDateLocation === `none`,
            value: `none`,
            description: `Hidden`,
            text: `Source date is not shown.`,
          },
          {
            selected: config.sourceDateLocation === `inline`,
            value: `inline`,
            description: `Inline`,
            text: `Source date is show on same line being edited.`,
          },
          {
            selected: config.sourceDateLocation === `bar`,
            value: `bar`,
            description: `Bar`,
            text: `Source date is shown on the VS Code status bar.`,
          }
        ];
        ui.addField(field);

        ui.addField(new Field(`hr`));
    
        field = new Field(`checkbox`, `clContentAssistEnabled`, `Enable CL Content Assist`);
        field.default = (config.clContentAssistEnabled ? `checked` : ``);
        field.description = `Enable CL content assist and hover support. After enabled and restarted, Code for IBM i will ask you to install the required tools for the feature to work. This will install programs into your temporary library.`;
        ui.addField(field);

        ui.addField(new Field(`hr`));
    
        field = new Field(`submit`, `save`, `Save settings`);
        ui.addField(field);
    
        let {panel, data} = await ui.loadPage(`Settings: ${name}`);
    
        if (data) {
          panel.dispose();

          for (const key in data) {
    
            //In case we need to play with the data
            switch (key) {
            case `sourceASP`:
              if (data[key].trim() === ``) data[key] = null;
              break;
            case `hideCompileErrors`:
              data[key] = data[key].split(`,`).map(item => item.trim().toUpperCase()).filter(item => item !== ``);
              break;
            }
          }

          if (server) {
            if (existingConfigIndex >= 0) {
              config = {
                ...config,
                ...data,
              };

              connectionSettings[existingConfigIndex] = config;
              await Configuration.setGlobal(`connectionSettings`, connectionSettings);
            }
          } else {
            if (connection) {
              if (restartFields.some(item => data[item] !== config[item])) {
                restart = true;
              }
              
              await config.setMany(data);
            }
          }

          if (restart) {
            vscode.window.showInformationMessage(`Some settings require a restart to take effect. Reload workspace now?`, `Reload`, `No`)
              .then(async (value) => {
                if (value === `Reload`) {
                  await vscode.commands.executeCommand(`workbench.action.reloadWindow`);
                }
              });
          }
        }
      }),

      vscode.commands.registerCommand(`code-for-ibmi.showLoginSettings`, async (server) => {
        if (server) {
          const connections = Configuration.get(`connections`);
          const name = server.name;

          const connectionIdx = connections.findIndex(item => item.name === name);
          let connection = connections[connectionIdx];

          let ui = new CustomUI();
          let field;

          field = new Field(`input`, `host`, `Host or IP Address`);
          field.default = connection.host;
          ui.addField(field);

          field = new Field(`input`, `port`, `Port`);
          field.default = connection.port;
          ui.addField(field);

          field = new Field(`input`, `username`, `Username`);
          field.default = connection.username;
          ui.addField(field);

          field = new Field(`paragraph`, `authText`, `Only provide either the password or a private key - not both.`);
          ui.addField(field);

          field = new Field(`password`, `password`, `Password`);
          field.description = `Only provide a password if you want to update an existing one or set a new one.`
          ui.addField(field);

          field = new Field(`file`, `privateKey`, `Private Key`);
          field.description = `Only provide a private key if you want to update from the existing one or set one.`
          field.default = connection.privateKey;
          ui.addField(field);

          ui.addField(new Field(`submit`, `submitButton`, `Save`));

          const {panel, data} = await ui.loadPage(`Login Settings: ${name}`);

          if (data) {
            panel.dispose();
      
            data.port = Number(data.port);
            if (data.privateKey === ``) data.privateKey = connection.privateKey;

            if(data.password && !data.privateKey) {
              context.secrets.delete(`${name}_password`);
              context.secrets.store(`${name}_password`, `${data.password}`)
            };


            connection = {
              ...connection,
              ...data
            };

            connections[connectionIdx] = connection;
            await Configuration.setGlobal(`connections`, connections);
          }
        }
      })
    )


  }

}