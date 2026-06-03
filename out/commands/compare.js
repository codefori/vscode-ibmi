"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerCompareCommands = void 0;
const vscode_1 = require("vscode");
const typings_1 = require("../typings");
let selectedForCompare;
const VSCODE_DIFF_COMMAND = `vscode.diff`;
function registerCompareCommands() {
    return [
        vscode_1.commands.registerCommand(`code-for-ibmi.selectForCompare`, async (node) => {
            if (node?.resourceUri) {
                selectedForCompare = node.resourceUri;
                vscode_1.window.showInformationMessage(`Selected ${selectedForCompare.path} for compare.`);
            }
        }),
        vscode_1.commands.registerCommand(`code-for-ibmi.compareWithSelected`, async (node) => {
            if (selectedForCompare) {
                let uri;
                if (node) {
                    uri = node.resourceUri;
                }
                else {
                    const activeEditor = vscode_1.window.activeTextEditor;
                    const value = (activeEditor ? activeEditor.document.uri : selectedForCompare)
                        .with({ query: '' })
                        .toString();
                    const compareWith = await vscode_1.window.showInputBox({
                        prompt: `Enter the path to compare selected with`,
                        value,
                        title: `Compare with`
                    });
                    if (compareWith)
                        uri = vscode_1.Uri.parse(compareWith);
                }
                if (uri) {
                    vscode_1.commands.executeCommand(VSCODE_DIFF_COMMAND, selectedForCompare, uri);
                }
                else {
                    vscode_1.window.showErrorMessage(`No compare to path provided.`);
                }
            }
            else {
                vscode_1.window.showInformationMessage(`Nothing selected to compare.`);
            }
        }),
        vscode_1.commands.registerCommand(`code-for-ibmi.compareCurrentFileWithMember`, async (node) => {
            compareCurrentFile(node, `member`);
        }),
        vscode_1.commands.registerCommand(`code-for-ibmi.compareCurrentFileWithStreamFile`, async (node) => {
            compareCurrentFile(node, `streamfile`);
        }),
        vscode_1.commands.registerCommand(`code-for-ibmi.compareCurrentFileWithLocal`, async (node) => {
            compareCurrentFile(node, `file`);
        }),
        vscode_1.commands.registerCommand(`code-for-ibmi.compareWithActiveFile`, async (node) => {
            let selectedFile;
            if (node) {
                if (node instanceof typings_1.BrowserItem) {
                    selectedFile = node.resourceUri;
                }
                else if (node.scheme === `file`) {
                    selectedFile = node;
                }
                else {
                    vscode_1.window.showInformationMessage(vscode_1.l10n.t(`No file is open or selected`));
                }
                let activeFile;
                const editor = vscode_1.window.activeTextEditor;
                if (editor) {
                    activeFile = editor.document.uri;
                    if (activeFile) {
                        vscode_1.commands.executeCommand(VSCODE_DIFF_COMMAND, activeFile, selectedFile);
                    }
                    else {
                        vscode_1.window.showInformationMessage(vscode_1.l10n.t(`No file is open or selected`));
                    }
                }
                else {
                    vscode_1.window.showInformationMessage(vscode_1.l10n.t(`No file is open or selected`));
                }
            }
            else {
                vscode_1.window.showInformationMessage(vscode_1.l10n.t(`No file is open or selected`));
            }
        }),
        vscode_1.commands.registerCommand("code-for-ibmi.compareWithEachOther", async (node, nodes) => {
            const left = nodes.at(0)?.resourceUri;
            const right = nodes.at(1)?.resourceUri;
            if (left) {
                vscode_1.commands.executeCommand(VSCODE_DIFF_COMMAND, left, right);
            }
        }),
        //Same commands with shorter titles
        ...["compareWithSelected",
            "compareCurrentFileWithMember",
            "compareCurrentFileWithStreamFile",
            "compareCurrentFileWithLocal",
            "compareWithActiveFile"].map(command => vscode_1.commands.registerCommand(`code-for-ibmi.${command}.short`, node => vscode_1.commands.executeCommand(`code-for-ibmi.${command}`, node)))
    ];
}
exports.registerCompareCommands = registerCompareCommands;
async function compareCurrentFile(node, scheme) {
    let currentFile;
    // If we are comparing with an already targeted node
    if (node) {
        if (node instanceof typings_1.BrowserItem) {
            currentFile = node.resourceUri;
        }
        else if (node.scheme === `file`) {
            currentFile = node;
        }
    }
    else {
        // If we are comparing with the currently open file
        const editor = vscode_1.window.activeTextEditor;
        if (editor) {
            currentFile = editor.document.uri;
        }
    }
    if (currentFile) {
        let compareWith;
        if (scheme === "file") {
            compareWith = (await vscode_1.window.showOpenDialog({
                title: vscode_1.l10n.t(`Select the file to compare to`),
                canSelectMany: false,
            }))?.at(0);
        }
        else {
            compareWith = await vscode_1.window.showInputBox({
                prompt: vscode_1.l10n.t(`Enter the path to compare selected with`),
                title: vscode_1.l10n.t(`Compare with`),
                value: currentFile.path
            });
        }
        if (compareWith) {
            let uri;
            if (compareWith instanceof vscode_1.Uri) {
                uri = compareWith;
            }
            else {
                if (scheme == 'member' && !compareWith.startsWith('/')) {
                    compareWith = `/${compareWith}`;
                }
                uri = vscode_1.Uri.parse(`${scheme}:${compareWith}`);
            }
            vscode_1.commands.executeCommand(VSCODE_DIFF_COMMAND, currentFile, uri);
        }
    }
    else {
        vscode_1.window.showInformationMessage(vscode_1.l10n.t(`No file is open or selected`));
    }
}
//# sourceMappingURL=compare.js.map