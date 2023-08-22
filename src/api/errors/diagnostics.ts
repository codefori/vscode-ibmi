
import * as vscode from "vscode";
import Instance from "../Instance";
import { parseErrors } from "./parser";
import { FileError } from "../../typings";
import { getEvfeventFiles } from "../local/actions";

const ileDiagnostics = vscode.languages.createDiagnosticCollection(`ILE`);

export interface EvfEventInfo {
  asp?: string
  library: string,
  object: string,
  extension?: string,
  workspace?: vscode.WorkspaceFolder
}

export function registerDiagnostics(): vscode.Disposable[] {
  return [
    ileDiagnostics,

    vscode.commands.registerCommand(`code-for-ibmi.clearDiagnostics`, async () => {
      clearDiagnostics();
    }),
  ]
}

/**
 * Does what it says on the tin.
 */
export function clearDiagnostics() {
  ileDiagnostics.clear();
}

export async function refreshDiagnosticsFromServer(instance: Instance, evfeventInfo: EvfEventInfo) {
  const content = instance.getContent();

  if (content) {
    const tableData = await content.getTable(evfeventInfo.library, `EVFEVENT`, evfeventInfo.object);
    const lines = tableData.map(row => String(row.EVFEVENT));

    clearDiagnostics();

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

      clearDiagnostics();

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

export async function handleEvfeventLines(lines: string[], instance: Instance, evfeventInfo: EvfEventInfo) {
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
          `${error.code}: ${error.text} (${error.sev})`,
          diagnosticSeverity(error)
        );

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
          const relativeCompilePath = file.toLowerCase().replace(workspaceDeployPath, '');
          const diagnosticTargetFile = vscode.Uri.joinPath(workspaceFolder.uri, relativeCompilePath);

          if (diagnosticTargetFile !== undefined) {
            ileDiagnostics.set(diagnosticTargetFile, diagnostics);
          } else {
            vscode.window.showWarningMessage("Couldn't show compile error(s) in problem view.");
          }
        }
      } else {
        if (file.startsWith(`/`))
          ileDiagnostics.set(vscode.Uri.from({ scheme: `streamfile`, path: file }), diagnostics);
        else {
          const memberUri = vscode.Uri.from({ scheme: `member`, path: `/${asp}${file}${evfeventInfo.extension ? `.` + evfeventInfo.extension : ``}` });
          ileDiagnostics.set(memberUri, diagnostics);
        }
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