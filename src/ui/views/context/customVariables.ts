import vscode, { l10n } from "vscode";
import IBMi from "../../../api/IBMi";
import { instance } from "../../../instantiate";
import { CustomVariable } from "../../../typings";
import { ContextItem } from "./contextItem";

export namespace CustomVariables {
  export function getAll() {
    return instance.getConnection()?.getConfig().customVariables || [];
  }

  export function validateName(name: string, names: string[]) {
    name = sanitizeVariableName(name);
    if (!name) {
      return l10n.t('Name cannot be empty');
    }
    else if (names.includes(name.toLocaleUpperCase())) {
      return l10n.t("Custom variable {0} already exists", name);
    }
  }

  function sanitizeVariableName(name: string) {
    return name.replace(/ /g, '_').replace(/&/g, '').toUpperCase();
  }

  export async function update(targetVariable: CustomVariable, options?: { newName?: string, delete?: boolean }) {
    const config = instance.getConnection()?.getConfig();
    if (config) {
      targetVariable.name = sanitizeVariableName(targetVariable.name);
      const variables = config.customVariables;
      const index = variables.findIndex(v => v.name === targetVariable.name);

      if (options?.delete) {
        if (index < 0) {
          throw new Error(l10n.t("Custom variable {0} not found for deletion.", targetVariable.name));
        }
        variables.splice(index, 1);
      }
      else {
        const variable = { name: sanitizeVariableName(options?.newName || targetVariable.name), value: targetVariable.value };
        variables[index < 0 ? variables.length : index] = variable;
      }

      await IBMi.connectionManager.update(config);
    }
  }
}

export class CustomVariablesNode extends ContextItem {
  constructor() {
    super(l10n.t("Custom Variables"), { state: vscode.TreeItemCollapsibleState.Collapsed });
    this.contextValue = `customVariablesNode`;
  }

  getChildren() {
    return CustomVariables.getAll().map(customVariable => new CustomVariableItem(this, customVariable));
  }
}

export class CustomVariableItem extends ContextItem {
  constructor(parent: ContextItem, readonly customVariable: CustomVariable) {
    super(customVariable.name, { parent, icon: "symbol-variable" });
    this.contextValue = `customVariableItem`;
    this.description = customVariable.value;

    this.command = {
      title: "Change value",
      command: "code-for-ibmi.environment.variable.edit",
      arguments: [this.customVariable]
    }
  }
}