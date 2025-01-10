import { RelativePattern, window, workspace, WorkspaceFolder } from "vscode";
import { Action } from "../../typings";

export async function getEvfeventFiles(currentWorkspace: WorkspaceFolder) {
  if (currentWorkspace) {
    const relativeSearch = new RelativePattern(currentWorkspace, `**/.evfevent/*`);
    const iprojectFiles = await workspace.findFiles(relativeSearch, null);

    return iprojectFiles;
  }
}