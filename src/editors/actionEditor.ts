import vscode from "vscode";
import { updateAction } from "../api/actions";
import { Tools } from "../api/Tools";
import { Action, ActionEnvironment, ActionRefresh, ActionType } from "../typings";
import { CustomVariables } from "../ui/views/environment/customVariables";
import { Tab } from "../webviews/CustomUI";
import { CustomEditor } from "./customEditorProvider";

// Used to list info about available variables
type VariableInfo = {
  name: string
  text: string
}

type VariableInfoList = {
  member: VariableInfo[]
  streamFile: VariableInfo[]
  object: VariableInfo[]
}

type ActionData = {
  name: string
  command: string
  extensions: string
  type: ActionType
  environment: ActionEnvironment
  refresh: ActionRefresh
  runOnProtected: boolean
  outputToFile: string
}

const editedActions: Set<{ name: string, type?: ActionType }> = new Set;

export function isActionEdited(action: Action) {
  return editedActions.has({ name: action.name, type: action.type });
}

export function editAction(targetAction: Action, doAfterSave?: () => Thenable<void>, workspace?: vscode.WorkspaceFolder) {
  const customVariables = CustomVariables.getAll().map(variable => `<li><b><code>&amp;${variable.name}</code></b>: <code>${variable.value}</code></li>`).join(``);
  new CustomEditor<ActionData>(`${targetAction.name}.action`, (actionData) => save(targetAction, actionData, workspace).then(doAfterSave), () => editedActions.delete({ name: targetAction.name, type: targetAction.type }))
    .addInput(
      `command`,
      vscode.l10n.t(`Command(s) to run`),
      vscode.l10n.t(`Below are available variables based on the Type you have select below. You can specify different commands on each line. Each command run is stateless and run in their own job.`),
      { rows: 5, default: targetAction.command }
    )
    .addTabs(
      Object.entries(getVariablesInfo())
        .map(([type, variables]) => ({
          label: Tools.capitalize(type),
          value: `<ul>${variables.map(variable => `<li><b><code>${variable.name}</code></b>: ${variable.text}</li>`).join(``)}${customVariables}</ul>`
        } as Tab)), getDefaultTabIndex(targetAction.type)
    )
    .addHorizontalRule()
    .addInput(`extensions`, vscode.l10n.t(`Extensions`), vscode.l10n.t(`A comma delimited list of extensions for this action. This can be a member extension, a streamfile extension, an object type or an object attribute`), { default: targetAction.extensions?.join(`, `) })
    .addSelect(`type`, vscode.l10n.t(`Type`), workspace ? [{
      selected: targetAction.type === `file`,
      value: `file`,
      description: vscode.l10n.t(`Local File (Workspace)`),
      text: vscode.l10n.t(`Actions for local files in the VS Code Workspace.`)
    }] :
      [
        {
          selected: targetAction.type === `member`,
          value: `member`,
          description: vscode.l10n.t(`Member`),
          text: vscode.l10n.t(`Source members in the QSYS file system`),
        },
        {
          selected: targetAction.type === `streamfile`,
          value: `streamfile`,
          description: vscode.l10n.t(`Streamfile`),
          text: vscode.l10n.t(`Streamfiles in the IFS`)
        },
        {
          selected: targetAction.type === `object`,
          value: `object`,
          description: vscode.l10n.t(`Object`),
          text: vscode.l10n.t(`Objects in the QSYS file system`)
        }
      ],
      vscode.l10n.t(`The types of files this action can support.`),
      workspace ? true : false
    )
    .addSelect(`environment`, vscode.l10n.t(`Environment`), [
      {
        selected: targetAction.environment === `ile`,
        value: `ile`,
        description: vscode.l10n.t(`ILE`),
        text: vscode.l10n.t(`Runs as an ILE command`)
      },
      {
        selected: targetAction.environment === `qsh`,
        value: `qsh`,
        description: vscode.l10n.t(`QShell`),
        text: vscode.l10n.t(`Runs the command through QShell`)
      },
      {
        selected: targetAction.environment === `pase`,
        value: `pase`,
        description: vscode.l10n.t(`PASE`),
        text: vscode.l10n.t(`Runs the command in the PASE environment`)
      }], vscode.l10n.t(`Environment for command to be executed in.`)
    )
    .addSelect(`refresh`, vscode.l10n.t(`Refresh`), [
      {
        selected: targetAction.refresh === `no`,
        value: `no`,
        description: vscode.l10n.t(`No`),
        text: vscode.l10n.t(`No refresh`)
      },
      {
        selected: targetAction.refresh === `parent`,
        value: `parent`,
        description: vscode.l10n.t(`Parent`),
        text: vscode.l10n.t(`The parent container is refreshed`)
      },
      {
        selected: targetAction.refresh === `filter`,
        value: `filter`,
        description: vscode.l10n.t(`Filter`),
        text: vscode.l10n.t(`The parent filter is refreshed`)
      },
      {
        selected: targetAction.refresh === `browser`,
        value: `browser`,
        description: vscode.l10n.t(`Browser`),
        text: vscode.l10n.t(`The entire browser is refreshed`)
      }], vscode.l10n.t(`The browser level to refresh after the action is done`)
    )
    .addCheckbox("runOnProtected", vscode.l10n.t(`Run on protected/read only`), vscode.l10n.t(`Allows the execution of this Action on protected or read only targets`), targetAction.runOnProtected)
    .addInput(`outputToFile`, vscode.l10n.t(`Copy output to file`), vscode.l10n.t(`Copy the action output to a file. Variables can be used to define the file's path; use <code>&i</code> to compute file index.<br/>Example: <code>~/outputs/&CURLIB_&OPENMBR&i.txt</code>.`), { default: targetAction.outputToFile })
    .open();

  editedActions.add({ name: targetAction.name, type: targetAction.type });
}

async function save(targetAction: Action, actionData: ActionData, workspace?: vscode.WorkspaceFolder) {
  Object.assign(targetAction, actionData);
  // We don't want \r (Windows line endings)
  targetAction.command = targetAction.command.replace(new RegExp(`\\\r`, `g`), ``);
  targetAction.extensions = actionData.extensions.split(`,`).map(item => item.trim().toUpperCase())
  await updateAction(targetAction, workspace);
}

const generic: () => VariableInfo[] = () => [
  { name: `&amp;CURLIB`, text: vscode.l10n.t(`Current library, changeable in Library List`) },
  { name: `&amp;USERNAME`, text: vscode.l10n.t(`Username for connection`) },
  { name: `&amp;WORKDIR`, text: vscode.l10n.t(`Current working directory, changeable in IFS Browser`) },
  { name: `&amp;HOST`, text: vscode.l10n.t(`Hostname or IP address from the current connection`) },
  { name: `&amp;BUILDLIB`, text: vscode.l10n.t(`The same as <code>&amp;CURLIB</code>`) },
  { name: `&amp;LIBLC`, text: vscode.l10n.t(`Library list delimited by comma`) },
  { name: `&amp;LIBLS`, text: vscode.l10n.t(`Library list delimited by space`) }
];

export function getVariablesInfo(): VariableInfoList {
  return {
    member: [
      { name: `&amp;OPENLIB`, text: vscode.l10n.t(`Library name where the source member lives (<code>&amp;OPENLIBL</code> for lowercase)`) },
      { name: `&amp;OPENSPF`, text: vscode.l10n.t(`Source file name where the source member lives (<code>&amp;OPENSPFL</code> for lowercase)`) },
      { name: `&amp;OPENMBR`, text: vscode.l10n.t(`Name of the source member (<code>&amp;OPENMBRL</code> for lowercase)`) },
      { name: `&amp;EXT`, text: vscode.l10n.t(`Extension of the source member (<code>&amp;EXTL</code> for lowercase)`) },
      ...generic()
    ],
    streamFile: [
      { name: `&amp;FULLPATH`, text: vscode.l10n.t(`Full path of the file on the remote system`) },
      { name: `&amp;FILEDIR`, text: vscode.l10n.t(`Directory of the file on the remote system`) },
      { name: `&amp;RELATIVEPATH`, text: vscode.l10n.t(`Relative path of the streamfile from the working directory or workspace`) },
      { name: `&amp;PARENT`, text: vscode.l10n.t(`Name of the parent directory or source file`) },
      { name: `&amp;BASENAME`, text: vscode.l10n.t(`Name of the file, including the extension`) },
      { name: `&amp;NAME`, text: vscode.l10n.t(`Name of the file (<code>&amp;NAMEL</code> for lowercase)`) },
      { name: `&amp;EXT`, text: vscode.l10n.t(`Extension of the file (<code>&amp;EXTL</code> for lowercase)`) },
      ...generic()
    ],
    object: [
      { name: `&amp;LIBRARY`, text: vscode.l10n.t(`Library name where the object lives (<code>&amp;LIBRARYL</code> for lowercase)`) },
      { name: `&amp;NAME`, text: vscode.l10n.t(`Name of the object (<code>&amp;NAMEL</code> for lowercase)`) },
      { name: `&amp;TYPE`, text: vscode.l10n.t(`Type of the object (<code>&amp;TYPEL</code> for lowercase)`) },
      { name: `&amp;EXT`, text: vscode.l10n.t(`Extension/attribute of the object (<code>&amp;EXTL</code> for lowercase)`) },
      ...generic()
    ]
  }
}

function getDefaultTabIndex(type?: ActionType) {
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