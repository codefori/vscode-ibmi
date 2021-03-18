const vscode = require(`vscode`);

const {CustomUI, Field} = require(`../../api/CustomUI`);

let instance = require(`../../Instance`);

module.exports = class SettingsUI {

  /**
   * Called to log in to an IBM i
   * @param {vscode.ExtensionContext} context
   */
  static init(context) {

    context.subscriptions.push(
      vscode.commands.registerCommand(`code-for-ibmi.showAdditionalSettings`, async () => {
        const config = instance.getConfig();

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
    
        field = new Field(`submit`, `save`, `Save settings`);
        ui.addField(field);
    
        let {panel, data} = await ui.loadPage(`Additional settings`);
    
        if (data) {
          panel.dispose();

          for (const key in data) {
    
            //In case we need to play with the data
            switch (key) {
            case `sourceASP`:
              if (data[key].trim() === ``) data[key] = null;
              break;
            }
          }
          
          config.setMany(data);
        }
      })
    )


  }

}