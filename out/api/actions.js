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
exports.getLocalActionsFiles = exports.updateAction = exports.getActions = void 0;
const vscode_1 = __importStar(require("vscode"));
const IBMi_1 = __importDefault(require("./IBMi"));
async function getActions(workspace) {
    return workspace ? await getLocalActions(workspace) : (IBMi_1.default.connectionManager.get(`actions`) || []);
}
exports.getActions = getActions;
async function updateAction(action, workspace, options) {
    const actions = await getActions(workspace);
    const currentIndex = actions.findIndex(a => action.name === a.name);
    action.name = options?.newName || action.name;
    if (options?.delete) {
        if (currentIndex >= 0) {
            actions.splice(currentIndex, 1);
        }
        else {
            throw new Error(vscode_1.l10n.t("Cannot find action {0} for delete operation", action.name));
        }
    }
    else {
        actions[currentIndex >= 0 ? currentIndex : actions.length] = action;
    }
    if (workspace) {
        const actionsFile = (await getLocalActionsFiles(workspace)).at(0);
        if (actionsFile) {
            await vscode_1.default.workspace.fs.writeFile(actionsFile, Buffer.from(JSON.stringify(actions, undefined, 2), "utf-8"));
        }
        else {
            throw new Error(vscode_1.l10n.t("No local actions file defined in workspace {0}", workspace.name));
        }
    }
    else {
        await IBMi_1.default.connectionManager.set(`actions`, actions);
    }
}
exports.updateAction = updateAction;
async function getLocalActionsFiles(workspace) {
    return workspace ? await vscode_1.default.workspace.findFiles(new vscode_1.default.RelativePattern(workspace, `**/.vscode/actions.json`)) : [];
}
exports.getLocalActionsFiles = getLocalActionsFiles;
async function getLocalActions(currentWorkspace) {
    const actions = [];
    if (currentWorkspace) {
        const actionsFiles = await getLocalActionsFiles(currentWorkspace);
        for (const file of actionsFiles) {
            const actionsContent = await vscode_1.default.workspace.fs.readFile(file);
            try {
                const actionsJson = JSON.parse(actionsContent.toString());
                // Maybe one day replace this with real schema validation
                if (Array.isArray(actionsJson)) {
                    actionsJson.forEach((action, index) => {
                        if (typeof action.name === `string` &&
                            typeof action.command === `string` &&
                            [`ile`, `pase`, `qsh`].includes(action.environment) &&
                            (!action.extensions || Array.isArray(action.extensions))) {
                            actions.push({
                                ...action,
                                type: `file`
                            });
                        }
                        else {
                            throw new Error(`Invalid Action defined at index ${index}.`);
                        }
                    });
                }
            }
            catch (e) {
                vscode_1.default.window.showErrorMessage(`Error parsing ${file.fsPath}: ${e.message}\n`);
            }
        }
        ;
    }
    return actions;
}
//# sourceMappingURL=actions.js.map