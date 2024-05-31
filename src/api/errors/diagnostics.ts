
import * as vscode from "vscode";
import { FileError } from "../../typings";
import { GlobalConfiguration } from "../Configuration";
import Instance from "../Instance";
import { Tools } from "../Tools";
import { getEvfeventFiles } from "../local/actions";
import { parseErrors } from "./parser";

const ileDiagnostics = vscode.languages.createDiagnosticCollection(`ILE`);

export interface EvfEventInfo {
  asp?: string
  library: string,
  object: string,
  extension?: string,
  workspace?: vscode.WorkspaceFolder
}

export function registerDiagnostics(): vscode.Disposable[] {
  let disposables = [
    ileDiagnostics,

    vscode.commands.registerCommand(`code-for-ibmi.clearDiagnostics`, async () => {
      clearDiagnostics();
    }),
  ];

  if (GlobalConfiguration.get(`clearDiagnosticOnEdit`)) {
    disposables.push(
      vscode.workspace.onDidChangeTextDocument(e => {
        if (ileDiagnostics.has(e.document.uri)) {
          for (const change of e.contentChanges) {
            clearDiagnostic(e.document.uri, change.range)
          }
        }
      })
    )
  }

  return disposables;
}

/**
 * Does what it says on the tin.
 */
export function clearDiagnostics() {
  ileDiagnostics.clear();
}

export function clearDiagnostic(uri: vscode.Uri, changeRange: vscode.Range) {
  const currentList = ileDiagnostics.get(uri);

  if (currentList) {
    const newList = currentList.filter(d => !d.range.contains(changeRange));
    ileDiagnostics.set(uri, newList);
  }
}

export async function refreshDiagnosticsFromServer(instance: Instance, evfeventInfo: EvfEventInfo) {
  const content = instance.getContent();

  if (content) {
    const tableData = await content.getTable(evfeventInfo.library, `EVFEVENT`, evfeventInfo.object);
    const lines = tableData.map(row => String(row.EVFEVENT));

    if (GlobalConfiguration.get(`clearErrorsBeforeBuild`)) {
      // Clear all errors if the user has this setting enabled
      clearDiagnostics();
    }

    handleEvfeventLines(lines, instance, evfeventInfo);
  } else {
    throw new Error('Please connect to an IBM i');
  }
}

export async function refreshDiagnosticsFromLocal(instance: Instance, evfeventInfo: EvfEventInfo) {
  if (evfeventInfo.workspace) {
    const evfeventFiles = await getEvfeventFiles(evfeventInfo.workspace);
    if (evfeventFiles) {
      const filesContent = await Promise.all(evfeventFiles.map(uri => vscode.workspace.fs.readFile(uri)));

      if (GlobalConfiguration.get(`clearErrorsBeforeBuild`)) {
        // Clear all errors if the user has this setting enabled
        clearDiagnostics();
      }

      for (const contentBuffer of filesContent) {
        const content = contentBuffer.toString();
        const eol = content.includes(`\r\n`) ? `\r\n` : `\n`;
        const lines = content.split(eol);

        handleEvfeventLines(lines, instance, evfeventInfo);
      }

    } else {
      clearDiagnostics();
    }
  }
}

export function handleEvfeventLines(lines: string[], instance: Instance, evfeventInfo: EvfEventInfo) {
  const connection = instance.getConnection();
  const config = instance.getConfig();
  const asp = evfeventInfo.asp ? `${evfeventInfo.asp}/` : ``;

  const errorsByFiles = parseErrors(lines);

  const diagnostics: vscode.Diagnostic[] = [];
  if (errorsByFiles.size) {
    for (const [file, errors] of errorsByFiles.entries()) {
      diagnostics.length = 0;
      for (const error of errors) {
        error.column = Math.max(error.column - 1, 0);
        error.lineNum = Math.max(error.lineNum - 1, 0);
        error.toLineNum = Math.max(error.toLineNum - 1, 0);

        if (error.column === 0 && error.toColumn === 0) {
          error.column = 0;
          error.toColumn = 100;
        }

        const diagnostic = new vscode.Diagnostic(
          new vscode.Range(error.lineNum, error.column, error.toLineNum, error.toColumn),
          `${error.text} (${error.sev})`,
          diagnosticSeverity(error)
        );

        diagnostic.code = error.code;

        if (config) {
          if (!config.hideCompileErrors.includes(error.code)) {
            diagnostics.push(diagnostic);
          }
        } else {
          diagnostics.push(diagnostic);
        }
      }

      if (evfeventInfo.workspace) {
        const workspaceFolder = evfeventInfo.workspace;
        const storage = instance.getStorage();

        if (workspaceFolder && storage) {
          const workspaceDeployPath = storage.getWorkspaceDeployPath(workspaceFolder);
          const deployPathIndex = file.toLowerCase().indexOf(workspaceDeployPath.toLowerCase());

          let relativeCompilePath = (deployPathIndex !== -1 ? file.substring(0, deployPathIndex) + file.substring(deployPathIndex + workspaceDeployPath.length) : undefined);

          if (relativeCompilePath) {
            if (connection) {
              // Belive it or not, sometimes if the deploy directory is symlinked into as ASP, this can be a problem
              const aspNames = Object.values(connection.aspInfo);
              for (const aspName of aspNames) {
                const aspRoot = `/${aspName}`;
                if (relativeCompilePath.startsWith(aspRoot)) {
                  relativeCompilePath = relativeCompilePath.substring(aspRoot.length);
                  break;
                }
              }
            }

            const diagnosticTargetFile = vscode.Uri.joinPath(workspaceFolder.uri, relativeCompilePath);
            if (diagnosticTargetFile !== undefined) {
              ileDiagnostics.set(diagnosticTargetFile, diagnostics);
            } else {
              vscode.window.showWarningMessage("Couldn't show compile error(s) in problem view.");
            }
            continue;
          }
        }
      }

      if (file.startsWith(`/`)) {
        ileDiagnostics.set(Tools.findExistingDocumentUri(vscode.Uri.from({ scheme: `streamfile`, path: file })), diagnostics);
      }
      else {
        const memberUri = Tools.findExistingDocumentUri(vscode.Uri.from({ scheme: `member`, path: `/${asp}${file}${evfeventInfo.extension ? `.` + evfeventInfo.extension : ``}` }));
        ileDiagnostics.set(memberUri, diagnostics);
      }
    }
  } else {
    ileDiagnostics.clear();
  }
}

const diagnosticSeverity = (error: FileError) => {
  switch (error.sev) {
    case 20:
      return vscode.DiagnosticSeverity.Warning;
    case 30:
    case 40:
    case 50:
      return vscode.DiagnosticSeverity.Error;
    default: return vscode.DiagnosticSeverity.Information;
  }
}