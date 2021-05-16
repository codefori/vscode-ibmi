const vscode = require(`vscode`);

const {CustomUI, Field} = require(`../../api/CustomUI`);

let instance = require(`../../Instance`);
const Configuration = require(`../../api/Configuration`);

module.exports = class SettingsUI {

  /**
   * Called to log in to an IBM i
   * @param {vscode.ExtensionContext} context
   */
  static init(context) {
    context.subscriptions.push(
      vscode.commands.registerCommand(`code-for-ibmi.showActionsMaintenance`, async () => {
        this.MainMenu();
      })
    )
  }

  static async MainMenu() {
    const config = instance.getConfig();
    const allActions = Configuration.get(`actions`);

    let ui = new CustomUI();
    let field;

    field = new Field(`tree`, `actions`, `Work with Actions`);
    field.description = `Create or maintain Actions.`;
    field.treeItems = [
      {
        icons: {
          leaf: `plus`
        },
        label: `New Action`,
        value: `-1`
      },
      ...allActions.map((action, index) => ({
        icons: {
          leaf: `debug-start`
        },
        label: `${action.name} (${action.type}: ${action.extensions.join(`, `)})`,
        value: String(index)
      }))
    ];
    
    ui.addField(field);

    let {panel, data} = await ui.loadPage(`Work with Actions`);

    if (data) {
      panel.dispose();

      console.log(data);
    }
  }

}