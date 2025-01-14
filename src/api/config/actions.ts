import { Action } from "../../typings";
import { ConnectionConfiguration } from "../Configuration";
import IBMi from "../IBMi";
import { ConfigFile } from "./configFile";

export function getActionsConfig(connection: IBMi) {
  const ActionsConfig = new ConfigFile<Action[]>(connection, `actions`, []);

  ActionsConfig.hasServerFile = true;
  ActionsConfig.mergeArrays = true;

  ActionsConfig.validateAndCleanInPlace = (loadedConfig) => {
    let actions: Action[] = [];
    // Maybe one day replace this with real schema validation
    if (Array.isArray(loadedConfig)) {
      loadedConfig.forEach((action, index) => {
        if (
          typeof action.name === `string` &&
          typeof action.command === `string` &&
          [`ile`, `pase`, `qsh`].includes(action.environment) &&
          Array.isArray(action.extensions)
        ) {
          actions.push({
            type: `file`,
            ...action,
          });
        } else {
          throw new Error(`Invalid Action defined at index ${index}.`);
        }
      })
    }

    return actions;
  }

  return ActionsConfig;
}
