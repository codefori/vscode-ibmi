import { RelativePattern, window, workspace, WorkspaceFolder } from "vscode";
import { Action } from "../../api/types";

export async function getLocalActionsFiles(currentWorkspace?: WorkspaceFolder) {
  return currentWorkspace ? await workspace.findFiles(new RelativePattern(currentWorkspace, `**/.vscode/actions.json`)) : [];
}

export async function getLocalActions(currentWorkspace: WorkspaceFolder) {
  const actions: Action[] = [];

  if (currentWorkspace) {
    const actionsFiles = await getLocalActionsFiles(currentWorkspace);

    for (const file of actionsFiles) {
      const actionsContent = await workspace.fs.readFile(file);
      try {
        const actionsJson: Action[] = JSON.parse(actionsContent.toString());

        // Maybe one day replace this with real schema validation
        if (Array.isArray(actionsJson)) {
          actionsJson.forEach((action, index) => {
            if (
              typeof action.name === `string` &&
              typeof action.command === `string` &&
              [`ile`, `pase`, `qsh`].includes(action.environment) &&
              Array.isArray(action.extensions)
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
        // ignore
        window.showErrorMessage(`Error parsing ${file.fsPath}: ${e.message}\n`);
      }
    };
  }

  return actions;
}

export async function getEvfeventFiles(currentWorkspace: WorkspaceFolder) {
  if (currentWorkspace) {
    const relativeSearch = new RelativePattern(currentWorkspace, `**/.evfevent/*`);
    const iprojectFiles = await workspace.findFiles(relativeSearch, null);

    return iprojectFiles;
  }
}