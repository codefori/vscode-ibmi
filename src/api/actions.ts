import vscode, { l10n } from "vscode";
import { instance } from "../instantiate";
import { validateActions } from "./actionsValidation";
import { ConfigConflictError, ConfigFileUpdateStep, hashObject } from "./configuration/configFile";
import IBMi from "./IBMi";
import { Action, ActionType } from "./types";

/**
 * An action stored in /etc/vscode/actions.json, shared by all the users of the system
 */
export type ServerAction = Action & {
  /** Hash of the action's content when it was read from the server; undefined if it is not on the server */
  loadedHash?: string
};

/**
 * Thrown when a server action was changed (or deleted, or created) by someone else since it was last loaded
 */
export class ActionConflictError extends ConfigConflictError {
  constructor(readonly actionName: string) {
    super(l10n.t("Server action {0} has been changed on the server since it was last loaded.", actionName));
  }
}

export namespace ActionTools {
  export async function getActions(workspace?: vscode.WorkspaceFolder) {
    return workspace ? await getLocalActions(workspace) : getConnectionActions();
  }

  async function getLocalActions(currentWorkspace: vscode.WorkspaceFolder) {
    const actions: Action[] = [];

    if (currentWorkspace) {
      const actionsFiles = await getLocalActionsFiles(currentWorkspace);

      for (const file of actionsFiles) {
        const actionsContent = await vscode.workspace.fs.readFile(file);
        try {
          const actionsJson = JSON.parse(actionsContent.toString());
          if (Array.isArray(actionsJson)) {
            validateActions(actionsJson).forEach(action => actions.push({
              ...action,
              type: `file`
            }));
          }
        } catch (e: any) {
          vscode.window.showErrorMessage(`Error parsing ${file.fsPath}: ${e.message}\n`);
        }
      };
    }

    return actions;
  }

  export function getConnectionActions() {
    return IBMi.connectionManager.get<Action[]>(`actions`) || [];
  }

  /**
   * @returns the actions stored in /etc/vscode/actions.json, as they were when the file was last loaded.
   * Each action is a copy that can be changed freely.
   */
  export async function getServerActions(): Promise<ServerAction[]> {
    const connection = instance.getConnection();
    if (connection) {
      const actions = await connection.getConfigFile<Action[]>(`actions`).get();
      return actions.map(action => ({ ...structuredClone(action), loadedHash: hashObject(action) }));
    }
    else {
      return [];
    }
  }

  export async function getLocalActionsFiles(workspace: vscode.WorkspaceFolder) {
    return workspace ?
      await vscode.workspace.findFiles(new vscode.RelativePattern(workspace, `**/.vscode/actions.json`)) :
      [];
  }

  export async function updateAction(action: Action, workspace?: vscode.WorkspaceFolder, options?: { newName?: string, oldType?: string, delete?: boolean }) {
    const actions = await getActions(workspace);
    const type = options?.oldType || action.type;
    const currentIndex = actions.findIndex(a => action.name === a.name && type === a.type);

    action.name = options?.newName || action.name;

    if (options?.delete) {
      if (currentIndex >= 0) {
        actions.splice(currentIndex, 1);
      }
      else {
        throw new Error(l10n.t("Cannot find action {0} for delete operation", action.name));
      }
    }
    else {
      actions[currentIndex >= 0 ? currentIndex : actions.length] = action;
    }

    if (workspace) {
      const actionsFile = (await getLocalActionsFiles(workspace)).at(0);
      if (actionsFile) {
        await vscode.workspace.fs.writeFile(actionsFile, Buffer.from(JSON.stringify(actions, undefined, 2), "utf-8"));
      }
      else {
        throw new Error(l10n.t("No local actions file defined in workspace {0}", workspace.name));
      }
    }
    else {
      await IBMi.connectionManager.set(`actions`, actions);
    }
  }

  /**
   * Creates, changes or deletes an action in /etc/vscode/actions.json. Only this action is changed, on top of the latest
   * content of the file: changes made by others to other actions are kept.
   *
   * @throws an {@link ActionConflictError} if the action was changed on the server since it was loaded, unless `force` is set
   */
  export async function updateServerAction(action: ServerAction, options?: { newName?: string, oldType?: ActionType, delete?: boolean, force?: boolean, onProgress?: (step: ConfigFileUpdateStep) => void }) {
    const connection = instance.getConnection();
    if (!connection) {
      throw new Error(l10n.t("Not connected to an IBM i"));
    }

    const currentName = action.name;
    const currentType = options?.oldType || action.type;
    const newName = options?.newName || currentName;
    const { loadedHash, ...serverAction } = action;
    serverAction.name = newName;

    await connection.getConfigFile<Action[]>(`actions`).update(serverActions => {
      const index = serverActions.findIndex(a => a.name === currentName && a.type === currentType);
      const currentHash = index < 0 ? undefined : hashObject(serverActions[index]);
      if (!options?.force && currentHash !== loadedHash) {
        throw new ActionConflictError(currentName);
      }

      if (options?.delete) {
        if (index >= 0) {
          serverActions.splice(index, 1);
        }
      }
      else {
        if (serverActions.some((a, i) => i !== index && a.name === newName && a.type === serverAction.type)) {
          throw new Error(l10n.t("The action '{0}' already exists for the '{1}' type", newName, serverAction.type!));
        }
        serverActions[index < 0 ? serverActions.length : index] = serverAction;
      }

      return serverActions;
    }, options?.onProgress);

    // The action may be saved again (e.g. from the same editor): it now matches what is on the server
    action.name = newName;
    action.loadedHash = options?.delete ? undefined : hashObject(serverAction);
  }
}
