"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerActionsCommands = void 0;
const path_1 = __importDefault(require("path"));
const vscode_1 = require("vscode");
const IBMi_1 = __importDefault(require("../api/IBMi"));
const Tools_1 = require("../api/Tools");
const actions_1 = require("../ui/actions");
const diagnostics_1 = require("../ui/diagnostics");
const types_1 = require("../ui/types");
function registerActionsCommands(instance) {
    return [
        vscode_1.commands.registerCommand(`code-for-ibmi.runAction`, async (item, items, action, method, workspaceFolder) => {
            const connection = instance.getConnection();
            if (connection) {
                const editor = vscode_1.window.activeTextEditor;
                const browserItems = [];
                const uris = [];
                const addTreeItem = (target) => {
                    if (target.resourceUri) {
                        uris.push(target.resourceUri);
                        if (target instanceof types_1.BrowserItem) {
                            browserItems.push(target);
                        }
                    }
                };
                if (typeof item === "string") {
                    switch (item) {
                        case "objectBrowser":
                            (await vscode_1.commands.executeCommand("code-for-ibmi.objectBrowser.selection")).forEach(addTreeItem);
                            break;
                        case "ifsBrowser":
                            (await vscode_1.commands.executeCommand("code-for-ibmi.ifsBrowser.selection")).forEach(addTreeItem);
                            break;
                        default:
                            if (editor?.document.uri) {
                                uris.push(editor.document.uri);
                            }
                    }
                }
                else {
                    for (const target of (Array.isArray(items) ? items : [item])) {
                        if (target instanceof vscode_1.Uri) {
                            uris.push(target);
                        }
                        else {
                            addTreeItem(target);
                        }
                    }
                }
                const scheme = uris[0]?.scheme;
                if (scheme) {
                    if (!uris.every(uri => uri.scheme === scheme)) {
                        vscode_1.window.showWarningMessage(vscode_1.l10n.t("Actions can't be run on multiple items of different natures. ({0})", uris.map(uri => uri.scheme).filter(Tools_1.Tools.distinct).join(", ")));
                        return false;
                    }
                    const config = connection.getConfig();
                    for (const openedEditor of vscode_1.window.visibleTextEditors) {
                        const path = openedEditor.document.uri.path;
                        if (uris.some(uri => uri.path === path) && openedEditor.document.isDirty) {
                            if (config.autoSaveBeforeAction) {
                                await openedEditor.document.save();
                            }
                            else {
                                const result = await vscode_1.window.showWarningMessage(`File ${path} must be saved to run Actions.`, `Save`, `Save automatically`, `Cancel`);
                                switch (result) {
                                    case `Save`:
                                        await openedEditor.document.save();
                                        break;
                                    case `Save automatically`:
                                        config.autoSaveBeforeAction = true;
                                        await IBMi_1.default.connectionManager.update(config);
                                        await openedEditor.document.save();
                                        break;
                                    default:
                                        return;
                                }
                            }
                        }
                    }
                    if ([`member`, `streamfile`, `file`, 'object'].includes(scheme)) {
                        return await (0, actions_1.runAction)(instance, uris, action, method, browserItems, workspaceFolder);
                    }
                }
            }
            else {
                vscode_1.window.showErrorMessage('Please connect to an IBM i first');
            }
            return false;
        }),
        vscode_1.commands.registerCommand(`code-for-ibmi.openErrors`, async (options) => {
            const detail = {
                asp: undefined,
                lib: ``,
                object: ``,
                ext: undefined
            };
            let inputPath;
            if (options.qualifiedObject) {
                // Value passed in via parameter
                inputPath = options.qualifiedObject;
            }
            else {
                // Value collected from user input
                let initialPath = ``;
                const editor = vscode_1.window.activeTextEditor;
                const connection = instance.getConnection();
                if (editor && connection) {
                    const config = connection.getConfig();
                    const uri = editor.document.uri;
                    if ([`member`, `streamfile`].includes(uri.scheme)) {
                        switch (uri.scheme) {
                            case `member`:
                                const memberPath = uri.path.split(`/`);
                                if (memberPath.length === 4) {
                                    detail.lib = memberPath[1];
                                }
                                else if (memberPath.length === 5) {
                                    detail.asp = memberPath[1];
                                    detail.lib = memberPath[2];
                                }
                                break;
                            case `streamfile`:
                                detail.asp = connection.getCurrentIAspName();
                                detail.lib = config.currentLibrary;
                                break;
                        }
                        const pathDetail = path_1.default.parse(editor.document.uri.path);
                        detail.object = pathDetail.name;
                        detail.ext = pathDetail.ext.substring(1);
                        initialPath = `${detail.lib}/${pathDetail.base}`;
                    }
                }
                inputPath = await vscode_1.window.showInputBox({
                    prompt: `Enter object path (LIB/OBJECT)`,
                    value: initialPath
                });
            }
            if (inputPath) {
                const [library, object] = inputPath.split(`/`);
                if (library && object) {
                    const nameDetail = path_1.default.parse(object);
                    (0, diagnostics_1.refreshDiagnosticsFromServer)(instance, [{ library, object: nameDetail.name, extension: (nameDetail.ext.length > 1 ? nameDetail.ext.substring(1) : undefined), workspace: options.workspace }], options.keepDiagnostics);
                }
            }
        }),
    ];
}
exports.registerActionsCommands = registerActionsCommands;
//# sourceMappingURL=actions.js.map