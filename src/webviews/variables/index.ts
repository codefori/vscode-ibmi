import vscode from "vscode";
import { CustomUI } from "../CustomUI";
import { instance } from "../../instantiate";
import IBMi from "../../api/IBMi";

export class VariablesUI {

  /**
   * Called to log in to an IBM i
   * @param {vscode.ExtensionContext} context
   */
  static initialize(context: vscode.ExtensionContext) {
    context.subscriptions.push(
      vscode.commands.registerCommand(`code-for-ibmi.showVariableMaintenance`, async () => {
        this.MainMenu();
      })
    )
  }

  static async MainMenu() {
    const config = instance.getConfig();
    if (config) {
      let variables = config.customVariables;

      const ui = new CustomUI()
        .addTree(`variable`, `Work with Variables`, [
          ...variables.map((variable, index) => ({
            label: `&${variable.name}: \`${variable.value}\``,
            value: String(index)
          })).sort((a, b) => a.label.localeCompare(b.label))
        ], `Create or maintain custom variables. Custom variables can be used in any Action in this connection.`)
        .addButtons({ id: `newVariable`, label: `New Variable` });

      const page = await ui.loadPage<any>(`Work with Variables`);
      if (page && page.data) {
        page.panel.dispose();

        const data = page.data;
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
  }

  /**
   * Edit an existing action
   * @param {number} id Existing action index, or -1 for a brand new index
   */
  static async WorkVariable(id: number) {
    const config = instance.getConfig();
    if (config) {
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

      const ui = new CustomUI()
        .addInput(`name`, `Variable name`, `<code>&</code> not required. Will be forced uppercase.`, { default: currentVariable.name })
        .addInput(`value`, `Variable value`, ``, { default: currentVariable.value })
        .addButtons({ id: `save`, label: `Save` }, { id: `delete`, label: `Delete` });

      const page = await ui.loadPage<any>(`Work with Variable`);
      if (page && page.data) {
        page.panel.dispose();

        const data = page.data;
        switch (data.buttons) {
          case `delete`:
            if (id >= 0) {
              allVariables.splice(id, 1);
              config.customVariables = allVariables;
              await IBMi.connectionManager.update(config);
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

            config.customVariables = allVariables;
            await IBMi.connectionManager.update(config);
            break;
        }

      }

      this.MainMenu();
    }
  }

}