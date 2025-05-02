import vscode from "vscode";

import { CustomUI, Tab } from "../CustomUI";

import IBMi from "../../api/IBMi";
import { Tools } from "../../api/Tools";
import { instance } from "../../instantiate";
import { Action, ActionEnvironment, ActionRefresh, ActionType } from "../../typings";
import { getVariablesInfo } from "./varinfo";

type MainMenuPage = {
  buttons?: 'newAction' | 'duplicateAction'
  value: string
}

type ActionPage = {
  name: string
  command: string
  extensions: string
  type: ActionType
  environment: ActionEnvironment
  refresh: ActionRefresh
  runOnProtected: boolean
  outputToFile: string
  buttons: "saveAction" | "deleteAction" | "cancelAction"
}

export namespace ActionsUI {

  export function initialize(context: vscode.ExtensionContext) {
    context.subscriptions.push(
      vscode.commands.registerCommand(`code-for-ibmi.showActionsMaintenance`, showMainMenu)
    )
  }

  async function showMainMenu() {
    const allActions = loadActions().map((action, index) => ({
      ...action,
      index,
    }));

    const icons = {
      branch: `folder`,
      leaf: `file`,
      open: `folder-opened`,
    };
    const ui = new CustomUI()
      .addTree(`actions`, vscode.l10n.t(`Work with Actions`),
        Array.from(new Set(allActions.map(action => action.type)))
          .map(type => ({
            icons,
            open: true,
            label: `📦 ${Tools.capitalize(type || '?')}`,
            type,
            subItems: allActions.filter(action => action.type === type)
              .map(action => ({
                icons,
                label: `🔨 ${action.name} (${action.extensions?.map(ext => ext.toLowerCase()).join(`, `)})`,
                value: String(action.index),
              }))
          })),
        vscode.l10n.t(`Create or maintain Actions. Actions are grouped by the type of file/object they target.`))
      .addButtons(
        { id: `newAction`, label: vscode.l10n.t(`New Action`) },
        { id: `duplicateAction`, label: vscode.l10n.t(`Duplicate`) }
      );

    const page = await ui.loadPage<MainMenuPage>(vscode.l10n.t(`Work with Actions`));
    if (page && page.data) {
      page.panel.dispose();

      switch (page.data.buttons) {
        case `newAction`:
          workAction(-1);
          break;
        case `duplicateAction`:
          duplicateAction();
          break;
        default:
          workAction(Number(page.data.value));
          break;
      }
    }
  }

  /**
   * Show item picker to duplicate an existing action
   */
  async function duplicateAction() {
    const actions = loadActions();

    const action = (await vscode.window.showQuickPick(
      actions.map((action, index) => ({
        label: `${action.name} (${action.type}: ${action.extensions?.join(`, `)})`,
        value: index,
        action
      })).sort((a, b) => a.label.localeCompare(b.label)),
      {
        placeHolder: vscode.l10n.t(`Select an action to duplicate`)
      }
    ))?.action;

    if (action) {
      //Duplicate the selected action
      workAction(-1, { ...action });
    } else {
      showMainMenu();
    }
  }

  /**
   * Edit an existing action
   */
  async function workAction(id: number, actionDefault?: Action) {
    const config = instance.getConfig();
    if (config) {
      const allActions = loadActions();
      let currentAction: Action;
      let uiTitle: string;
      let stayOnPanel = true;

      if (id >= 0) {
        //Fetch existing action
        currentAction = allActions[id];
        uiTitle = vscode.l10n.t(`Edit action "{0}"`, currentAction.name);
      } else if (actionDefault) {
        currentAction = actionDefault;
        uiTitle = vscode.l10n.t(`Duplicate action "{0}"`, currentAction.name);
      } else {
        //Otherwise.. prefill with defaults
        currentAction = {
          type: `member`,
          extensions: [
            `RPGLE`,
            `RPG`
          ],
          environment: `ile`,
          name: ``,
          command: ``,
          refresh: `no`
        }
        uiTitle = vscode.l10n.t(`Create action`);
      }

      if (!currentAction.environment) {
        currentAction.environment = `ile`;
      }

      // Our custom variables as HTML
      const custom = config.customVariables.map(variable => `<li><b><code>&amp;${variable.name}</code></b>: <code>${variable.value}</code></li>`).join(``);

      const ui = new CustomUI()
        .addInput(`name`, vscode.l10n.t(`Action name`), undefined, { default: currentAction.name })
        .addHorizontalRule()
        .addInput(
          `command`,
          vscode.l10n.t(`Command(s) to run`),
          vscode.l10n.t(`Below are available variables based on the Type you have select below. You can specify different commands on each line. Each command run is stateless and run in their own job.`),
          { rows: 5, default: currentAction.command }
        )
        .addTabs(
          Object.entries(getVariablesInfo())
            .map(([type, variables]) => ({
              label: Tools.capitalize(type),
              value: `<ul>${variables.map(variable => `<li><b><code>${variable.name}</code></b>: ${variable.text}</li>`).join(``)}${custom}</ul>`
            } as Tab)), getDefaultTabIndex(currentAction.type)
        )
        .addHorizontalRule()
        .addInput(`extensions`, vscode.l10n.t(`Extensions`), vscode.l10n.t(`A comma delimited list of extensions for this action. This can be a member extension, a streamfile extension, an object type or an object attribute`), { default: currentAction.extensions?.join(`, `) })
        .addSelect(`type`, vscode.l10n.t(`Type`), [
          {
            selected: currentAction.type === `member`,
            value: `member`,
            description: vscode.l10n.t(`Member`),
            text: vscode.l10n.t(`Source members in the QSYS file system`),
          },
          {
            selected: currentAction.type === `streamfile`,
            value: `streamfile`,
            description: vscode.l10n.t(`Streamfile`),
            text: vscode.l10n.t(`Streamfiles in the IFS`)
          },
          {
            selected: currentAction.type === `object`,
            value: `object`,
            description: vscode.l10n.t(`Object`),
            text: vscode.l10n.t(`Objects in the QSYS file system`)
          },
          {
            selected: currentAction.type === `file`,
            value: `file`,
            description: vscode.l10n.t(`Local File (Workspace)`),
            text: vscode.l10n.t(`Actions for local files in the VS Code Workspace.`)
          }], vscode.l10n.t(`The types of files this action can support.`)
        )
        .addSelect(`environment`, vscode.l10n.t(`Environment`), [
          {
            selected: currentAction.environment === `ile`,
            value: `ile`,
            description: vscode.l10n.t(`ILE`),
            text: vscode.l10n.t(`Runs as an ILE command`)
          },
          {
            selected: currentAction.environment === `qsh`,
            value: `qsh`,
            description: vscode.l10n.t(`QShell`),
            text: vscode.l10n.t(`Runs the command through QShell`)
          },
          {
            selected: currentAction.environment === `pase`,
            value: `pase`,
            description: vscode.l10n.t(`PASE`),
            text: vscode.l10n.t(`Runs the command in the PASE environment`)
          }], vscode.l10n.t(`Environment for command to be executed in.`)
        )
        .addSelect(`refresh`, vscode.l10n.t(`Refresh`), [
          {
            selected: currentAction.refresh === `no`,
            value: `no`,
            description: vscode.l10n.t(`No`),
            text: vscode.l10n.t(`No refresh`)
          },
          {
            selected: currentAction.refresh === `parent`,
            value: `parent`,
            description: vscode.l10n.t(`Parent`),
            text: vscode.l10n.t(`The parent container is refreshed`)
          },
          {
            selected: currentAction.refresh === `filter`,
            value: `filter`,
            description: vscode.l10n.t(`Filter`),
            text: vscode.l10n.t(`The parent filter is refreshed`)
          },
          {
            selected: currentAction.refresh === `browser`,
            value: `browser`,
            description: vscode.l10n.t(`Browser`),
            text: vscode.l10n.t(`The entire browser is refreshed`)
          }], vscode.l10n.t(`The browser level to refresh after the action is done`)
        )
        .addCheckbox("runOnProtected", vscode.l10n.t(`Run on protected/read only`), vscode.l10n.t(`Allows the execution of this Action on protected or read-only targets`), currentAction.runOnProtected)
        .addInput(`outputToFile`, vscode.l10n.t(`Copy output to file`), vscode.l10n.t(`Copy the action output to a file. Variables can be used to define the file's path; use <code>&i</code> to compute file index.<br/>Example: <code>~/outputs/&CURLIB_&OPENMBR&i.txt</code>.`), { default: currentAction.outputToFile })
        .addHorizontalRule()
        .addButtons(
          { id: `saveAction`, label: vscode.l10n.t(`Save`) },
          id >= 0 ? { id: `deleteAction`, label: vscode.l10n.t(`Delete`) } : undefined,
          { id: `cancelAction`, label: vscode.l10n.t(`Cancel`) }
        );

      while (stayOnPanel) {
        const page = await ui.loadPage<ActionPage>(uiTitle);
        if (page && page.data) {
          const data = page.data;
          switch (data.buttons) {
            case `deleteAction`:
              const yes = vscode.l10n.t(`Yes`);
              const result = await vscode.window.showInformationMessage(vscode.l10n.t(`Are you sure you want to delete the action "{0}"?`, currentAction.name), { modal: true }, yes, vscode.l10n.t("No"))
              if (result === yes) {
                allActions.splice(id, 1);
                await saveActions(allActions);
                stayOnPanel = false;
              }
              break;

            case `cancelAction`:
              stayOnPanel = false;
              break;

            default:
              // We don't want \r (Windows line endings)
              data.command = data.command.replace(new RegExp(`\\\r`, `g`), ``);

              const newAction: Action = {
                type: data.type,
                extensions: data.extensions.split(`,`).map(item => item.trim().toUpperCase()),
                environment: data.environment,
                name: data.name,
                command: data.command,
                refresh: data.refresh,
                runOnProtected: data.runOnProtected,
                outputToFile: data.outputToFile
              };

              if (id >= 0) {
                allActions[id] = newAction;
              } else {
                allActions.push(newAction);
              }

              await saveActions(allActions);
              stayOnPanel = false;
              break;
          }

          page.panel.dispose();
        }
        else {
          stayOnPanel = false;
        }
      }
    }
    showMainMenu();
  }
}

function saveActions(actions: Action[]) {
  return IBMi.connectionManager.set(`actions`, actions);
}

function loadActions(): Action[] {
  return IBMi.connectionManager.get<Action[]>(`actions`) || [];
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