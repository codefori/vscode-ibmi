import vscode, { l10n } from "vscode";
import IBMi from "./IBMi";
import { Action } from "./types";

export async function getActions(workspace?: vscode.WorkspaceFolder) {
  return workspace ? await getLocalActions(workspace) : (IBMi.connectionManager.get<Action[]>(`actions`) || []);
}

export async function updateAction(action: Action, workspace?: vscode.WorkspaceFolder, options?: { newName?: string, delete?: boolean }) {
  const actions = await getActions(workspace);
  const currentIndex = actions.findIndex(a => action.name === a.name && action.type === a.type);

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

export async function getLocalActionsFiles(workspace: vscode.WorkspaceFolder) {
  return workspace ? await vscode.workspace.findFiles(new vscode.RelativePattern(workspace, `**/.vscode/actions.json`)) : [];
}

async function getLocalActions(currentWorkspace: vscode.WorkspaceFolder) {
  const actions: Action[] = [];

  if (currentWorkspace) {
    const actionsFiles = await getLocalActionsFiles(currentWorkspace);

    for (const file of actionsFiles) {
      const actionsContent = await vscode.workspace.fs.readFile(file);
      try {
        const actionsJson: Action[] = JSON.parse(actionsContent.toString());

        // Maybe one day replace this with real schema validation
        if (Array.isArray(actionsJson)) {
          actionsJson.forEach((action, index) => {
            if (
              typeof action.name === `string` &&
              typeof action.command === `string` &&
              [`ile`, `pase`, `qsh`].includes(action.environment) &&
              (!action.extensions || Array.isArray(action.extensions))
            ) {
              actions.push({
                ...action,
                type: `file`
              });
            } else {
              throw new Error(`Invalid Action defined at index ${index}.`);
            }
          })
        }
      } catch (e: any) {
        vscode.window.showErrorMessage(`Error parsing ${file.fsPath}: ${e.message}\n`);
      }
    };
  }

  return actions;
}