"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleEvfeventLines = exports.refreshDiagnosticsFromLocal = exports.refreshDiagnosticsFromServer = exports.clearDiagnostic = exports.clearDiagnostics = exports.registerDiagnostics = void 0;
const vscode = __importStar(require("vscode"));
const IBMi_1 = __importDefault(require("../api/IBMi"));
const parser_1 = require("../api/errors/parser");
const Tools_1 = require("./Tools");
const ileDiagnostics = vscode.languages.createDiagnosticCollection(`ILE`);
function registerDiagnostics() {
    let disposables = [
        ileDiagnostics,
        vscode.commands.registerCommand(`code-for-ibmi.clearDiagnostics`, async () => {
            clearDiagnostics();
        }),
    ];
    if (IBMi_1.default.connectionManager.get(`clearDiagnosticOnEdit`)) {
        disposables.push(vscode.workspace.onDidChangeTextDocument(e => {
            if (ileDiagnostics.has(e.document.uri)) {
                for (const change of e.contentChanges) {
                    clearDiagnostic(e.document.uri, change.range);
                }
            }
        }));
    }
    return disposables;
}
exports.registerDiagnostics = registerDiagnostics;
/**
 * Does what it says on the tin.
 */
function clearDiagnostics() {
    ileDiagnostics.clear();
}
exports.clearDiagnostics = clearDiagnostics;
function clearDiagnostic(uri, changeRange) {
    const currentList = ileDiagnostics.get(uri);
    if (currentList) {
        const newList = currentList.filter(d => !d.range.contains(changeRange));
        ileDiagnostics.set(uri, newList);
    }
}
exports.clearDiagnostic = clearDiagnostic;
async function refreshDiagnosticsFromServer(instance, evfeventInfo, keepDiagnostics) {
    const connection = instance.getConnection();
    if (connection) {
        const content = connection.getContent();
        if (IBMi_1.default.connectionManager.get(`clearErrorsBeforeBuild`) && !keepDiagnostics) {
            // Clear all errors if the user has this setting enabled
            clearDiagnostics();
        }
        evfeventInfo.forEach(async (e) => {
            const tableData = await content.getTable(e.library, `EVFEVENT`, e.object);
            const lines = tableData.map(row => String(row.EVFEVENT));
            handleEvfeventLines(lines, instance, e);
        });
    }
    else {
        throw new Error('Please connect to an IBM i');
    }
}
exports.refreshDiagnosticsFromServer = refreshDiagnosticsFromServer;
async function refreshDiagnosticsFromLocal(instance, evfeventInfo) {
    if (evfeventInfo.workspace) {
        const evfeventFiles = await vscode.workspace.findFiles(new vscode.RelativePattern(evfeventInfo.workspace, `**/.evfevent/*`), null);
        if (evfeventFiles) {
            const filesContent = await Promise.all(evfeventFiles.map(uri => vscode.workspace.fs.readFile(uri)));
            if (IBMi_1.default.connectionManager.get(`clearErrorsBeforeBuild`)) {
                // Clear all errors if the user has this setting enabled
                clearDiagnostics();
            }
            for (const contentBuffer of filesContent) {
                const content = contentBuffer.toString();
                const eol = content.includes(`\r\n`) ? `\r\n` : `\n`;
                const lines = content.split(eol);
                handleEvfeventLines(lines, instance, evfeventInfo);
            }
        }
        else {
            clearDiagnostics();
        }
    }
}
exports.refreshDiagnosticsFromLocal = refreshDiagnosticsFromLocal;
function handleEvfeventLines(lines, instance, evfeventInfo) {
    const connection = instance.getConnection();
    const config = connection.getConfig();
    const asp = evfeventInfo.asp ? `${evfeventInfo.asp}/` : ``;
    const errorsByFiles = (0, parser_1.parseErrors)(lines);
    const diagnostics = [];
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
                const diagnostic = new vscode.Diagnostic(new vscode.Range(error.lineNum, error.column, error.toLineNum, error.toColumn), `${error.text} (${error.sev})`, diagnosticSeverity(error));
                diagnostic.code = error.code;
                if (config) {
                    if (!config.hideCompileErrors.includes(error.code)) {
                        diagnostics.push(diagnostic);
                    }
                }
                else {
                    diagnostics.push(diagnostic);
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
                        if (connection) {
                            // Belive it or not, sometimes if the deploy directory is symlinked into as ASP, this can be a problem
                            const aspNames = connection.getAllIAsps().map(asp => asp.name);
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
                        }
                        else {
                            vscode.window.showWarningMessage("Couldn't show compile error(s) in problem view.");
                        }
                        continue;
                    }
                    // If we get there, that means that even though we compiled from local, we likely had to use a temp member.
                    // We should try to find the file in the workspace. Since we can use findFile (it's async), then we look for open
                    // tabs like we do below.
                    if (evfeventInfo.extension) {
                        const baseName = file.split(`/`).pop();
                        const openFile = Tools_1.VscodeTools.findExistingDocumentByName(`${baseName}.${evfeventInfo.extension}`);
                        if (openFile) {
                            ileDiagnostics.set(openFile, diagnostics);
                            continue;
                        }
                    }
                }
            }
            if (file.startsWith(`/`)) {
                ileDiagnostics.set(Tools_1.VscodeTools.findExistingDocumentUri(vscode.Uri.from({ scheme: `streamfile`, path: file })), diagnostics);
            }
            else {
                const memberUri = Tools_1.VscodeTools.findExistingDocumentUri(vscode.Uri.from({ scheme: `member`, path: `/${asp}${file}${evfeventInfo.extension ? `.` + evfeventInfo.extension : ``}` }));
                ileDiagnostics.set(memberUri, diagnostics);
            }
        }
    }
    else {
        ileDiagnostics.clear();
    }
}
exports.handleEvfeventLines = handleEvfeventLines;
const diagnosticSeverity = (error) => {
    switch (error.sev) {
        case 20:
            return vscode.DiagnosticSeverity.Warning;
        case 30:
        case 40:
        case 50:
            return vscode.DiagnosticSeverity.Error;
        default: return vscode.DiagnosticSeverity.Information;
    }
};
//# sourceMappingURL=diagnostics.js.map