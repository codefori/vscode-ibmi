import { RelativePattern, window, workspace, WorkspaceFolder } from "vscode";
import { Action } from "../../typings";

export async function getLocalActions(currentWorkspace: WorkspaceFolder) {
  const actions: Action[] = [];

  if (currentWorkspace) {
    const relativeSearch = new RelativePattern(currentWorkspace, `**/.vscode/actions.json`);
    const actionsFiles = await workspace.findFiles(relativeSearch);

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

/**
 * Gets actions from the `iproj.json` file
 */
export async function getiProjActions(currentWorkspace: WorkspaceFolder) {
  const actions: Action[] = [];

  if (currentWorkspace) {
    const relativeSearch = new RelativePattern(currentWorkspace, `**/iproj.json`);
    const iprojectFiles = await workspace.findFiles(relativeSearch, null, 1);

    for (const file of iprojectFiles) {
      const iProjectContent = await workspace.fs.readFile(file);
      try {
        const iProject = JSON.parse(iProjectContent.toString());

        const description = iProject.description || `iproj.json`

        if (iProject.buildCommand) {
          actions.push({
            name: `${description} (build)`,
            command: iProject.buildCommand,
            environment: `pase`,
            extensions: [`GLOBAL`],
            deployFirst: true,
            type: `file`,
            postDownload: [
              ".logs/",
            ]
          });
        }

        if (iProject.compileCommand) {
          actions.push({
            name: `${description} (compile)`,
            command: `ERR=*EVENTF ${iProject.compileCommand}`,
            environment: `pase`,
            extensions: [`GLOBAL`],
            deployFirst: true,
            type: `file`,
            postDownload: [
              ".logs/",
            ]
          });
        }
      } catch (e: any) {
        // ignore
        window.showErrorMessage(`Error parsing ${file.fsPath}: ${e.message}\n`);
      }
    };
  }

  return actions;
}