import { Action, ActionType } from "./types";

const ENVIRONMENTS = [`ile`, `pase`, `qsh`];

/**
 * Checks the content of an actions file. Maybe one day replace this with real schema validation.
 * @param types the action types the file may hold; the type is not checked if not set
 * @throws an Error if the content is not an array of valid actions
 */
export function validateActions(content: unknown, types?: ActionType[]): Action[] {
  if (!Array.isArray(content)) {
    throw new Error(`Actions must be defined in an array.`);
  }

  content.forEach((action, index) => {
    const problem =
      !action || typeof action !== `object` ? `it is not an object` :
        typeof action.name !== `string` ? `its name is missing` :
          typeof action.command !== `string` ? `its command is missing` :
            // Actions run in ILE when no environment is set
            action.environment !== undefined && !ENVIRONMENTS.includes(action.environment) ? `its environment must be one of ${ENVIRONMENTS.join(`, `)}` :
              action.extensions && !Array.isArray(action.extensions) ? `its extensions must be an array` :
                types && !types.includes(action.type) ? `its type must be one of ${types.join(`, `)}` :
                  undefined;

    if (problem) {
      throw new Error(`Invalid Action defined at index ${index}${typeof action?.name === `string` ? ` (${action.name})` : ``}: ${problem}.`);
    }
  });

  return content;
}
