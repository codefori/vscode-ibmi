import vscode from "vscode";
import IBMi from "../../api/IBMi";
import { instance } from "../../instantiate";
import { CustomVariable } from "../../typings";
import { CustomUI } from "../CustomUI";

type VariablesListPage = {
  value?: string
  buttons?: "newVariable"
}

type EditVariablePage = {
  name: string
  value: string
  buttons?: "save" | "delete"
}

export namespace VariablesUI {
  export function initialize(context: vscode.ExtensionContext) {
    context.subscriptions.push(
      vscode.commands.registerCommand(`code-for-ibmi.showVariableMaintenance`, openVariablesList)
    )
  }

  async function openVariablesList() {
    const config = instance.getConnection()?.getConfig();
    if (config) {
      const variables = config.customVariables;

      const ui = new CustomUI()
        .addTree(`variable`, `Work with Variables`, [
          ...variables.map((variable, index) => ({
            label: `&${variable.name}: '${variable.value}'`,
            value: String(index)
          })).sort((a, b) => a.label.localeCompare(b.label))
        ], `Create or maintain custom variables. Custom variables can be used in any Action in this connection.`)
        .addButtons({ id: `newVariable`, label: `New Variable` });

      const page = await ui.loadPage<VariablesListPage>(`Work with Variables`);
      if (page && page.data) {
        page.panel.dispose();

        const data = page.data;
        switch (data.buttons) {
          case `newVariable`:
            editVariable();
            break;
          default:
            editVariable(Number(data.value));
            break;
        }
      }
    }
  }

  async function editVariable(id?: number) {
    const config = instance.getConnection()?.getConfig();
    if (config) {
      const allVariables = config.customVariables;
      const currentVariable: CustomVariable = id !== undefined ? allVariables[id] : { name: ``, value: `` };

      const ui = new CustomUI()
        .addInput(`name`, `Variable name`, `<code>&</code> not required. Will be forced uppercase.`, { default: currentVariable.name })
        .addInput(`value`, `Variable value`, ``, { default: currentVariable.value })
        .addButtons({ id: `save`, label: `Save` }, { id: `delete`, label: `Delete` });

      const page = await ui.loadPage<EditVariablePage>(`Work with Variable`);
      if (page && page.data) {
        page.panel.dispose();

        const data = page.data;
        switch (data.buttons) {
          case `delete`:
            if (id !== undefined) {
              allVariables.splice(id, 1);
              config.customVariables = allVariables;
              await IBMi.connectionManager.update(config);
            }
            break;

          case "save":
          default:
            data.name = data.name.replace(/ /g, '_')
              .replace(/&/g, '')
              .toUpperCase();

            const newAction = { ...data };
            if (id !== undefined) {
              allVariables[id] = newAction;
            } else {
              allVariables.push(newAction);
            }

            config.customVariables = allVariables;
            await IBMi.connectionManager.update(config);
            break;
        }
      }

      openVariablesList();
    }
  }

}