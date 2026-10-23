import vscode, { l10n } from "vscode";
import { ActionTools } from "../api/actions";
import { Tools } from "../api/Tools";
import { Action, ActionEnvironment, ActionRefresh, ActionType } from "../typings";
import { ActionLocation, Actions } from "../ui/views/environment/actions";
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
  deployFirst: boolean
  postDownload: string
}

const editedActions: Set<string> = new Set;

function getEditedKey(action: Action, location: ActionLocation) {
  const store = location.server ? `server` : location.workspace ? location.workspace.uri.toString() : `connection`;
  return `${store}|${action.type}|${action.name}`;
}

export function isActionEdited(action: Action, location: ActionLocation = {}) {
  return editedActions.has(getEditedKey(action, location));
}

export function editAction(targetAction: Action, doAfterSave?: () => Thenable<void>, location: ActionLocation = {}) {
  // Server actions may have the same name as connection actions: they need their own editor
  const actionEditor: CustomEditor<ActionData> = new CustomEditor<ActionData>(
    `${location.server ? `server/` : ``}${targetAction.type}/${targetAction.name}.action`,
    actionData => save(actionEditor, targetAction, actionData, location).then(doAfterSave),
    () => editedActions.delete(getEditedKey(targetAction, location)),
    // The target action is only changed once it has been saved: reverting is just showing it again
    async () => actionEditor.rebuild(editor => buildForm(editor, targetAction, location), getFormData(targetAction, location), false)
  );
  buildForm(actionEditor, targetAction, location);
  actionEditor.open();

  editedActions.add(getEditedKey(targetAction, location));
}

function getFormData(action: Action, location: ActionLocation): ActionData {
  return {
    name: action.name,
    command: action.command,
    extensions: action.extensions?.join(`, `) || ``,
    type: action.type!,
    environment: action.environment,
    refresh: action.refresh!,
    runOnProtected: Boolean(action.runOnProtected),
    outputToFile: action.outputToFile || ``,
    // Only shown (and saved) for workspace actions
    ...(location.workspace ? { deployFirst: Boolean(action.deployFirst), postDownload: action.postDownload?.join(`, `) || `` } : {})
  } as ActionData;
}

function buildForm(actionEditor: CustomEditor<ActionData>, action: Action, location: ActionLocation) {
  const customVariables = CustomVariables.getAll().map(variable => `<li><b><code>&amp;${variable.name}</code></b>: <code>${variable.value}</code></li>`).join(``);
  actionEditor
    .addInput(
      `command`,
      vscode.l10n.t(`Command(s) to run`),
      vscode.l10n.t(`Below are available variables based on the type you have selected below. You can specify different commands on each line. Each command is stateless and runs in its own job.`),
      { rows: 5, default: action.command }
    )
    .addTabs(
      Object.entries(getVariablesInfo())
        .map(([type, variables]) => ({
          label: Tools.capitalize(type),
          value: `<ul>${variables.map(variable => `<li><b><code>${variable.name}</code></b>: ${variable.text}</li>`).join(``)}${customVariables}</ul>`
        } as Tab)), getDefaultTabIndex(action.type)
    )
    .addHorizontalRule()
    .addInput(`extensions`, vscode.l10n.t(`Extensions`), vscode.l10n.t(`A comma separated list of extensions for this action. This can be a member extension, a streamfile extension, an object type or an object attribute`), { default: action.extensions?.join(`, `) })
    .addSelect(`type`, vscode.l10n.t(`Type`), location.workspace ? [{
      selected: action.type === `file`,
      value: `file`,
      description: vscode.l10n.t(`Local File (Workspace)`),
      text: vscode.l10n.t(`Actions for local files in the VS Code Workspace.`)
    }] :
      [
        {
          selected: action.type === `member`,
          value: `member`,
          description: vscode.l10n.t(`Member`),
          text: vscode.l10n.t(`Source members in the QSYS file system`),
        },
        {
          selected: action.type === `streamfile`,
          value: `streamfile`,
          description: vscode.l10n.t(`Streamfile`),
          text: vscode.l10n.t(`Streamfiles in the IFS`)
        },
        {
          selected: action.type === `object`,
          value: `object`,
          description: vscode.l10n.t(`Object`),
          text: vscode.l10n.t(`Objects in the QSYS file system`)
        }
      ],
      vscode.l10n.t(`The types of files this action can support.`),
      location.workspace ? true : false
    )
    .addSelect(`environment`, vscode.l10n.t(`Environment`), [
      {
        selected: action.environment === `ile`,
        value: `ile`,
        description: vscode.l10n.t(`ILE`),
        text: vscode.l10n.t(`Runs as an ILE command`)
      },
      {
        selected: action.environment === `qsh`,
        value: `qsh`,
        description: vscode.l10n.t(`QShell`),
        text: vscode.l10n.t(`Runs the command through QShell`)
      },
      {
        selected: action.environment === `pase`,
        value: `pase`,
        description: vscode.l10n.t(`PASE`),
        text: vscode.l10n.t(`Runs the command in the PASE environment`)
      }], vscode.l10n.t(`Environment for command to be executed in.`)
    )
    .addSelect(`refresh`, vscode.l10n.t(`Refresh`), [
      {
        selected: action.refresh === `no`,
        value: `no`,
        description: vscode.l10n.t(`No`),
        text: vscode.l10n.t(`No refresh`)
      },
      {
        selected: action.refresh === `parent`,
        value: `parent`,
        description: vscode.l10n.t(`Parent`),
        text: vscode.l10n.t(`The parent container is refreshed`)
      },
      {
        selected: action.refresh === `filter`,
        value: `filter`,
        description: vscode.l10n.t(`Filter`),
        text: vscode.l10n.t(`The parent filter is refreshed`)
      },
      {
        selected: action.refresh === `browser`,
        value: `browser`,
        description: vscode.l10n.t(`Browser`),
        text: vscode.l10n.t(`The entire browser is refreshed`)
      }], vscode.l10n.t(`The browser level to refresh after the action is done`)
    );

  if (location.workspace) {
    actionEditor.addCheckbox(`deployFirst`, vscode.l10n.t(`Deploy before running`), vscode.l10n.t("When enabled, the local workspace will be deployed before the action is run."), action.deployFirst);
    actionEditor.addInput(`postDownload`, vscode.l10n.t(`Post execution downloads`), vscode.l10n.t("A comma separated list of remote files/folders to download when the Action is complete. Supports variables. Using <code>.evfevent</code> in combination with a build tool will populate the Problems view."), { default: action.postDownload?.join(', ') });
  }

  actionEditor
    .addCheckbox("runOnProtected", vscode.l10n.t(`Run on protected/read only`), vscode.l10n.t(`Allows the execution of this Action on protected or read only targets`), action.runOnProtected)
    .addInput(`outputToFile`, vscode.l10n.t(`Copy output to file`), vscode.l10n.t(`Copy the action output to a file. Variables can be used to define the file's path; use <code>&i</code> to compute file index.<br/>Example: <code>~/outputs/&CURLIB_&OPENMBR&i.txt</code>.`), { default: action.outputToFile })
}

/**
 * Replaces the action and the form with what is on the server now; the editor stays dirty so the action can be saved again right away.
 * @throws an Error if the action no longer exists on the server
 */
async function reloadFromServer(actionEditor: CustomEditor<ActionData>, targetAction: Action, location: ActionLocation) {
  await vscode.commands.executeCommand("code-for-ibmi.environment.refresh");

  const latest = (await ActionTools.getServerActions()).find(action => action.name === targetAction.name && action.type === targetAction.type);
  if (!latest) {
    throw new Error(l10n.t("Server action {0} no longer exists on the server. Save again and choose to overwrite to create it again, or close this editor.", targetAction.name));
  }

  for (const key of Object.keys(targetAction)) {
    if (!(key in latest)) {
      delete (targetAction as any)[key];
    }
  }
  Object.assign(targetAction, latest);
  actionEditor.rebuild(editor => buildForm(editor, targetAction, location), getFormData(targetAction, location), true);
}

async function save(actionEditor: CustomEditor<ActionData>, targetAction: Action, actionData: ActionData, location: ActionLocation) {
  const oldType = targetAction.type;
  const postDownload = actionData.postDownload?.split(',').map(path => path.trim()).filter(Boolean);
  const extensions = actionData.extensions?.split(`,`).map(item => item.trim().toUpperCase()).filter(Boolean);

  // The target action is only changed once saved: if saving fails, it still matches what is stored
  const action: Action = Object.assign({}, targetAction, actionData,
    //Fields that needs to be tranformed before saving
    {
      name: targetAction.name,
      command: actionData.command.replace(new RegExp(`\\\r`, `g`), ``), // We don't want \r (Windows line endings)
      extensions: extensions?.length ? extensions : undefined,
      outputToFile: actionData.outputToFile || undefined,
      postDownload: postDownload?.length ? postDownload : undefined
    });
  const typeChanged = (oldType !== action.type);
  if (typeChanged && (await Actions.getActions(location)).some(a => a.name === action.name && a.type === action.type)) {
    throw new Error(l10n.t("The action '{0}' already exists for the '{1}' type", action.name, action.type!))
  }

  let reloaded = false;
  const saved = await Actions.save(action, location, { oldType }, {
    onReload: async () => {
      await reloadFromServer(actionEditor, targetAction, location);
      reloaded = true;
    }
  });

  // Throwing keeps the editor open and dirty, so it can be saved again
  if (reloaded) {
    throw new Error(l10n.t("Action {0} was reloaded from the server: review it and save it again.", targetAction.name));
  }
  else if (!saved) {
    throw new Error(l10n.t("Action {0} was not saved.", targetAction.name));
  }

  editedActions.delete(getEditedKey(targetAction, location));
  Object.assign(targetAction, action);
  editedActions.add(getEditedKey(targetAction, location));
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