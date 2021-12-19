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
      vscode.commands.registerCommand(`code-for-ibmi.showVariableMaintenance`, async () => {
        this.MainMenu();
      })
    )
  }

  static async MainMenu() {
    const config = instance.getConfig();
    let variables = config.customVariables;

    let ui = new CustomUI();
    let field;
    
    field = new Field(`tree`, `variable`, `Work with Variables`);
    field.description = `Create or maintain custom variables. Custom variables can be used in any Action in this connection.`;
    field.treeList = [
      ...variables.map((variable, index) => ({
        label: `&${variable.name}: \`${variable.value}\``,
        value: String(index)
      })).sort((a, b) => a.label.localeCompare(b.label))
    ];
    
    ui.addField(field);

    field = new Field(`buttons`);
    field.items = [
      {
        id: `newVariable`,
        label: `New Variable`,
      },
    ];
    ui.addField(field);

    let {panel, data} = await ui.loadPage(`Work with Variables`);

    if (data) {
      panel.dispose();

      switch (data.buttons) {
      case `newVariable`:
        this.WorkVariable(-1);
        break;
      default:
        this.WorkVariable(Number(data.variable));
        break;
      }
    }
  }

  /**
   * Edit an existing action
   * @param {number} id Existing action index, or -1 for a brand new index
   */
  static async WorkVariable(id) {
    const config = instance.getConfig();
    let allVariables = config.customVariables;
    let currentVariable;
    
    if (id >= 0) {
      //Fetch existing variable
      currentVariable = allVariables[id];

    } else {
      //Otherwise.. prefill with defaults
      currentVariable = {
        name: ``,
        value: ``
      }
    }

    let ui = new CustomUI();
    let field;

    field = new Field(`input`, `name`, `Variable name`);
    field.description = `<code>&</code> not required. Will be forced uppercase.`;
    field.default = currentVariable.name;
    ui.addField(field);

    field = new Field(`input`, `value`, `Variable value`);
    field.default = currentVariable.value;
    ui.addField(field);

    field = new Field(`buttons`);
    field.items = [
      {
        id: `save`,
        label: `Save`
      },
      {
        id: `delete`,
        label: `Delete`
      }
    ];
    ui.addField(field);

    let {panel, data} = await ui.loadPage(`Work with Variable`);

    if (data) {
      panel.dispose();
      
      switch (data.buttons) {
      case `delete`:
        if (id >= 0) {
          allVariables.splice(id, 1);
          await config.set(`customVariables`, allVariables);
        }
        break;

      default: //save
        data.name = data.name.replace(new RegExp(` `, `g`), `_`).toUpperCase();

        const newAction = {
          name: data.name,
          value: data.value
        };

        if (id >= 0) {
          allVariables[id] = newAction;
        } else {
          allVariables.push(newAction);
        }

        await config.set(`customVariables`, allVariables);
        break;
      }
    
    }

    this.MainMenu();
  }

}