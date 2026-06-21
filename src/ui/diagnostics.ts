
import * as vscode from "vscode";
import IBMi from "../api/IBMi";
import { parseErrors } from "../api/errors/parser";
import { instance } from "../instantiate";
import { FileError } from "../typings";
import { VscodeTools } from "./Tools";

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

  if (IBMi.connectionManager.get(`clearDiagnosticOnEdit`)) {
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

export function refreshDiagnosticsFromServer(connection: IBMi, evfeventInfo: EvfEventInfo[], keepDiagnostics?: boolean) {
  if (IBMi.connectionManager.get(`clearErrorsBeforeBuild`) && !keepDiagnostics) {
    // Clear all errors if the user has this setting enabled
    clearDiagnostics();
  }

  evfeventInfo.forEach(async e => {
    const overFile = await connection.getContent().overDBFile(e.library, "EVFEVENT", e.object);
    try {
      const lines = (await connection.runSQL(/* sql */`select trim(cast(EVFEVENT as VarChar(400) CCSID ${connection.getCcsid()})) EVFEVENT from ${overFile}`))
        .map(row => String(row.EVFEVENT));

      if (lines.length) {
        await handleEvfeventLines(connection, lines, e);
      }
    }
    finally {
      connection.getContent().deleteOVRDBFile(overFile);
    }
  });
}

export async function refreshDiagnosticsFromLocal(connection: IBMi, evfeventInfo: EvfEventInfo) {
  if (evfeventInfo.workspace) {
    const evfeventFiles = await vscode.workspace.findFiles(new vscode.RelativePattern(evfeventInfo.workspace, `**/.evfevent/*`), null);
    if (evfeventFiles) {
      const filesContent = await Promise.all(evfeventFiles.map(uri => vscode.workspace.fs.readFile(uri)));

      if (IBMi.connectionManager.get(`clearErrorsBeforeBuild`)) {
        // Clear all errors if the user has this setting enabled
        clearDiagnostics();
      }

      for (const contentBuffer of filesContent) {
        const content = contentBuffer.toString();
        const eol = content.includes(`\r\n`) ? `\r\n` : `\n`;
        const lines = content.split(eol);

        await handleEvfeventLines(connection, lines, evfeventInfo);
      }

    } else {
      clearDiagnostics();
    }
  }
}

export async function handleEvfeventLines(connection: IBMi, lines: string[], evfeventInfo: EvfEventInfo) {
  const config = connection.getConfig();
  const errorsByFiles = parseErrors(lines);

  const diagnostics: vscode.Diagnostic[] = [];
  if (errorsByFiles.size) {
    for (const [file, errors] of errorsByFiles) {
      if (file !== '.') {
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
      }

      if (evfeventInfo.workspace) {
        const workspaceFolder = evfeventInfo.workspace;
        const storage = instance.getStorage();

        if (workspaceFolder && storage) {
          const workspaceDeployPath = storage.getWorkspaceDeployPath(workspaceFolder.uri.fsPath);
          const deployPathIndex = file.toLowerCase().indexOf(workspaceDeployPath.toLowerCase());

          let relativeCompilePath = (deployPathIndex !== -1 ? file.substring(0, deployPathIndex) + file.substring(deployPathIndex + workspaceDeployPath.length) : undefined);

          if (relativeCompilePath) {
            if (evfeventInfo.asp) {
              // Believe it or not, sometimes if the deploy directory is symlinked into an ASP, this can be a problem              
              const aspRoot = `/${evfeventInfo.asp}`;
              if (relativeCompilePath.startsWith(aspRoot)) {
                relativeCompilePath = relativeCompilePath.substring(aspRoot.length);
                break;
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

      // For member paths: try to find an open local document by name before falling back to server URI.
      // findExistingDocumentByName searches all open tabs — no workspace needed — so this works for
      // member-type actions too (where evfeventInfo.workspace is not set).
      if (!file.startsWith(`/`) && evfeventInfo.extension) {
        const baseName = file.split(`/`).pop();
        const lookupName = `${baseName}.${evfeventInfo.extension}`;
        const openFile = VscodeTools.findExistingDocumentByName(lookupName);
        if (openFile) {
          ileDiagnostics.set(openFile, diagnostics);
          continue;
        }
      }

      if (file.startsWith(`/`)) {
        ileDiagnostics.set(VscodeTools.findExistingDocumentUri(vscode.Uri.from({ scheme: `streamfile`, path: file })), diagnostics);
      }
      else {
        const asp = await connection.getLibraryIAsp(file.split('/')[0]);
        const memberUri = VscodeTools.findExistingDocumentUri(vscode.Uri.from({ scheme: `member`, path: `/${asp ? `${asp}/` : ''}${file}${evfeventInfo.extension ? `.` + evfeventInfo.extension : ``}` }));
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