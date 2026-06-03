"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getVariablesInfo = exports.editAction = exports.isActionEdited = void 0;
const vscode_1 = __importDefault(require("vscode"));
const actions_1 = require("../api/actions");
const Tools_1 = require("../api/Tools");
const customVariables_1 = require("../ui/views/environment/customVariables");
const customEditorProvider_1 = require("./customEditorProvider");
const editedActions = new Set;
function isActionEdited(action) {
    return editedActions.has(action.name);
}
exports.isActionEdited = isActionEdited;
function editAction(targetAction, doAfterSave, workspace) {
    const customVariables = customVariables_1.CustomVariables.getAll().map(variable => `<li><b><code>&amp;${variable.name}</code></b>: <code>${variable.value}</code></li>`).join(``);
    new customEditorProvider_1.CustomEditor(`${targetAction.name}.action`, (actionData) => save(targetAction, actionData, workspace).then(doAfterSave), () => editedActions.delete(targetAction.name))
        .addInput(`command`, vscode_1.default.l10n.t(`Command(s) to run`), vscode_1.default.l10n.t(`Below are available variables based on the Type you have select below. You can specify different commands on each line. Each command run is stateless and run in their own job.`), { rows: 5, default: targetAction.command })
        .addTabs(Object.entries(getVariablesInfo())
        .map(([type, variables]) => ({
        label: Tools_1.Tools.capitalize(type),
        value: `<ul>${variables.map(variable => `<li><b><code>${variable.name}</code></b>: ${variable.text}</li>`).join(``)}${customVariables}</ul>`
    })), getDefaultTabIndex(targetAction.type))
        .addHorizontalRule()
        .addInput(`extensions`, vscode_1.default.l10n.t(`Extensions`), vscode_1.default.l10n.t(`A comma delimited list of extensions for this action. This can be a member extension, a streamfile extension, an object type or an object attribute`), { default: targetAction.extensions?.join(`, `) })
        .addSelect(`type`, vscode_1.default.l10n.t(`Type`), workspace ? [{
            selected: targetAction.type === `file`,
            value: `file`,
            description: vscode_1.default.l10n.t(`Local File (Workspace)`),
            text: vscode_1.default.l10n.t(`Actions for local files in the VS Code Workspace.`)
        }] :
        [
            {
                selected: targetAction.type === `member`,
                value: `member`,
                description: vscode_1.default.l10n.t(`Member`),
                text: vscode_1.default.l10n.t(`Source members in the QSYS file system`),
            },
            {
                selected: targetAction.type === `streamfile`,
                value: `streamfile`,
                description: vscode_1.default.l10n.t(`Streamfile`),
                text: vscode_1.default.l10n.t(`Streamfiles in the IFS`)
            },
            {
                selected: targetAction.type === `object`,
                value: `object`,
                description: vscode_1.default.l10n.t(`Object`),
                text: vscode_1.default.l10n.t(`Objects in the QSYS file system`)
            }
        ], vscode_1.default.l10n.t(`The types of files this action can support.`), workspace ? true : false)
        .addSelect(`environment`, vscode_1.default.l10n.t(`Environment`), [
        {
            selected: targetAction.environment === `ile`,
            value: `ile`,
            description: vscode_1.default.l10n.t(`ILE`),
            text: vscode_1.default.l10n.t(`Runs as an ILE command`)
        },
        {
            selected: targetAction.environment === `qsh`,
            value: `qsh`,
            description: vscode_1.default.l10n.t(`QShell`),
            text: vscode_1.default.l10n.t(`Runs the command through QShell`)
        },
        {
            selected: targetAction.environment === `pase`,
            value: `pase`,
            description: vscode_1.default.l10n.t(`PASE`),
            text: vscode_1.default.l10n.t(`Runs the command in the PASE environment`)
        }
    ], vscode_1.default.l10n.t(`Environment for command to be executed in.`))
        .addSelect(`refresh`, vscode_1.default.l10n.t(`Refresh`), [
        {
            selected: targetAction.refresh === `no`,
            value: `no`,
            description: vscode_1.default.l10n.t(`No`),
            text: vscode_1.default.l10n.t(`No refresh`)
        },
        {
            selected: targetAction.refresh === `parent`,
            value: `parent`,
            description: vscode_1.default.l10n.t(`Parent`),
            text: vscode_1.default.l10n.t(`The parent container is refreshed`)
        },
        {
            selected: targetAction.refresh === `filter`,
            value: `filter`,
            description: vscode_1.default.l10n.t(`Filter`),
            text: vscode_1.default.l10n.t(`The parent filter is refreshed`)
        },
        {
            selected: targetAction.refresh === `browser`,
            value: `browser`,
            description: vscode_1.default.l10n.t(`Browser`),
            text: vscode_1.default.l10n.t(`The entire browser is refreshed`)
        }
    ], vscode_1.default.l10n.t(`The browser level to refresh after the action is done`))
        .addCheckbox("runOnProtected", vscode_1.default.l10n.t(`Run on protected/read only`), vscode_1.default.l10n.t(`Allows the execution of this Action on protected or read only targets`), targetAction.runOnProtected)
        .addInput(`outputToFile`, vscode_1.default.l10n.t(`Copy output to file`), vscode_1.default.l10n.t(`Copy the action output to a file. Variables can be used to define the file's path; use <code>&i</code> to compute file index.<br/>Example: <code>~/outputs/&CURLIB_&OPENMBR&i.txt</code>.`), { default: targetAction.outputToFile })
        .open();
    editedActions.add(targetAction.name);
}
exports.editAction = editAction;
async function save(targetAction, actionData, workspace) {
    Object.assign(targetAction, actionData);
    // We don't want \r (Windows line endings)
    targetAction.command = targetAction.command.replace(new RegExp(`\\\r`, `g`), ``);
    targetAction.extensions = actionData.extensions.split(`,`).map(item => item.trim().toUpperCase());
    await (0, actions_1.updateAction)(targetAction, workspace);
}
const generic = () => [
    { name: `&amp;CURLIB`, text: vscode_1.default.l10n.t(`Current library, changeable in Library List`) },
    { name: `&amp;USERNAME`, text: vscode_1.default.l10n.t(`Username for connection`) },
    { name: `&amp;WORKDIR`, text: vscode_1.default.l10n.t(`Current working directory, changeable in IFS Browser`) },
    { name: `&amp;HOST`, text: vscode_1.default.l10n.t(`Hostname or IP address from the current connection`) },
    { name: `&amp;BUILDLIB`, text: vscode_1.default.l10n.t(`The same as <code>&amp;CURLIB</code>`) },
    { name: `&amp;LIBLC`, text: vscode_1.default.l10n.t(`Library list delimited by comma`) },
    { name: `&amp;LIBLS`, text: vscode_1.default.l10n.t(`Library list delimited by space`) }
];
function getVariablesInfo() {
    return {
        member: [
            { name: `&amp;OPENLIB`, text: vscode_1.default.l10n.t(`Library name where the source member lives (<code>&amp;OPENLIBL</code> for lowercase)`) },
            { name: `&amp;OPENSPF`, text: vscode_1.default.l10n.t(`Source file name where the source member lives (<code>&amp;OPENSPFL</code> for lowercase)`) },
            { name: `&amp;OPENMBR`, text: vscode_1.default.l10n.t(`Name of the source member (<code>&amp;OPENMBRL</code> for lowercase)`) },
            { name: `&amp;EXT`, text: vscode_1.default.l10n.t(`Extension of the source member (<code>&amp;EXTL</code> for lowercase)`) },
            ...generic()
        ],
        streamFile: [
            { name: `&amp;FULLPATH`, text: vscode_1.default.l10n.t(`Full path of the file on the remote system`) },
            { name: `&amp;FILEDIR`, text: vscode_1.default.l10n.t(`Directory of the file on the remote system`) },
            { name: `&amp;RELATIVEPATH`, text: vscode_1.default.l10n.t(`Relative path of the streamfile from the working directory or workspace`) },
            { name: `&amp;PARENT`, text: vscode_1.default.l10n.t(`Name of the parent directory or source file`) },
            { name: `&amp;BASENAME`, text: vscode_1.default.l10n.t(`Name of the file, including the extension`) },
            { name: `&amp;NAME`, text: vscode_1.default.l10n.t(`Name of the file (<code>&amp;NAMEL</code> for lowercase)`) },
            { name: `&amp;EXT`, text: vscode_1.default.l10n.t(`Extension of the file (<code>&amp;EXTL</code> for lowercase)`) },
            ...generic()
        ],
        object: [
            { name: `&amp;LIBRARY`, text: vscode_1.default.l10n.t(`Library name where the object lives (<code>&amp;LIBRARYL</code> for lowercase)`) },
            { name: `&amp;NAME`, text: vscode_1.default.l10n.t(`Name of the object (<code>&amp;NAMEL</code> for lowercase)`) },
            { name: `&amp;TYPE`, text: vscode_1.default.l10n.t(`Type of the object (<code>&amp;TYPEL</code> for lowercase)`) },
            { name: `&amp;EXT`, text: vscode_1.default.l10n.t(`Extension/attribute of the object (<code>&amp;EXTL</code> for lowercase)`) },
            ...generic()
        ]
    };
}
exports.getVariablesInfo = getVariablesInfo;
function getDefaultTabIndex(type) {
    switch (type) {
        case `file`:
        case `streamfile`:
            return 1;
        case `object`:
            return 2;
        case `member`:
        default:
            return 0;
    }
}
//# sourceMappingURL=actionEditor.js.map