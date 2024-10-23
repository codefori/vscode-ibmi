
import * as vscode from 'vscode';

export function getVscodeConfiguration(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration(`code-for-ibmi`);
}
