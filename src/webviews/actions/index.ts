import vscode from "vscode";

import { CustomUI, Tab } from "../../api/CustomUI";

import { GlobalConfiguration } from "../../api/Configuration";
import { Tools } from "../../api/Tools";
import { instance } from "../../instantiate";
import { t } from "../../locale";
import { Action, ActionEnvironment, ActionRefresh, ActionType } from "../../typings";
import { getVariablesInfo } from "./varinfo";

type MainMenuPage = {
  buttons: 'newAction' | 'duplicateAction'
  actions: number
}

type ActionPage = {
  name: string
  command: string
  extensions: string
  type: ActionType
  environment: ActionEnvironment
  refresh: ActionRefresh
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
      .addTree(`actions`, t("actions.mainMenu.workWithActions"),
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
        t(`actions.mainMenu.createOrMaintain`))
      .addButtons(
        { id: `newAction`, label: t('actions.mainMenu.newAction') },
        { id: `duplicateAction`, label: t('duplicate') }
      );

    const page = await ui.loadPage<MainMenuPage>(t("actions.mainMenu.workWithActions"));
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
          workAction(page.data.actions);
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
        placeHolder: t('actions.duplicate.select')
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
        uiTitle = t('actions.workAction.edit.title', currentAction.name);
      } else if (actionDefault) {
        currentAction = actionDefault;
        uiTitle = t('actions.workAction.duplicate.title', currentAction.name);
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
        uiTitle = t('actions.workAction.create.title');
      }

      if (!currentAction.environment) {
        currentAction.environment = `ile`;
      }

      // Our custom variables as HTML
      const custom = config.customVariables.map(variable => `<li><b><code>&amp;${variable.name}</code></b>: <code>${variable.value}</code></li>`).join(``);

      const ui = new CustomUI()
        .addInput(`name`, t('actions.workAction.name'), undefined, { default: currentAction.name })
        .addHorizontalRule()
        .addInput(
          `command`,
          t("actions.workAction.command"),
          t('actions.workAction.command.description'),
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
        .addInput(`extensions`, t('actions.workAction.extensions'), t('actions.workAction.extensions.description'), { default: currentAction.extensions?.join(`, `) })
        .addSelect(`type`, t('actions.workAction.types'), [
          {
            selected: currentAction.type === `member`,
            value: `member`,
            description: t('actions.workAction.types.member'),
            text: t('actions.workAction.types.member.description'),
          },
          {
            selected: currentAction.type === `streamfile`,
            value: `streamfile`,
            description: t('actions.workAction.types.streamfile'),
            text: t('actions.workAction.types.streamfile.description')
          },
          {
            selected: currentAction.type === `object`,
            value: `object`,
            description: t('actions.workAction.types.object'),
            text: t('actions.workAction.types.object.description')
          },
          {
            selected: currentAction.type === `file`,
            value: `file`,
            description: t('actions.workAction.types.file'),
            text: t('actions.workAction.types.file.description')
          }], t('actions.workAction.types.description')
        )
        .addSelect(`environment`, t('actions.workAction.environment'), [
          {
            selected: currentAction.environment === `ile`,
            value: `ile`,
            description: t('actions.workAction.environment.ile'),
            text: t('actions.workAction.environment.ile.description')
          },
          {
            selected: currentAction.environment === `qsh`,
            value: `qsh`,
            description: t('actions.workAction.environment.qsh'),
            text: t('actions.workAction.environment.qsh.description')
          },
          {
            selected: currentAction.environment === `pase`,
            value: `pase`,
            description: t('actions.workAction.environment.pase'),
            text: t('actions.workAction.environment.pase.description')
          }], t('actions.workAction.environment.description')
        )
        .addSelect(`refresh`, t('actions.workAction.refresh'), [
          {
            selected: currentAction.refresh === `no`,
            value: `no`,
            description: t('actions.workAction.refresh.no'),
            text: t('actions.workAction.refresh.no.description')
          },
          {
            selected: currentAction.refresh === `parent`,
            value: `parent`,
            description: t('actions.workAction.refresh.parent'),
            text: t('actions.workAction.refresh.parent.description')
          },
          {
            selected: currentAction.refresh === `filter`,
            value: `filter`,
            description: t('actions.workAction.refresh.filter'),
            text: t('actions.workAction.refresh.filter.description')
          },
          {
            selected: currentAction.refresh === `browser`,
            value: `browser`,
            description: t('actions.workAction.refresh.browser'),
            text: t('actions.workAction.refresh.browser.description')
          }], t('actions.workAction.refresh.description')
        )
        .addHorizontalRule()
        .addButtons(
          { id: `saveAction`, label: t(`save`) },
          id >= 0 ? { id: `deleteAction`, label: t(`delete`) } : undefined,
          { id: `cancelAction`, label: t(`cancel`) }
        );

      while (stayOnPanel) {
        const page = await ui.loadPage<ActionPage>(uiTitle);
        if (page && page.data) {
          const data = page.data;
          switch (data.buttons) {
            case `deleteAction`:
              const yes = t(`Yes`);
              const result = await vscode.window.showInformationMessage(t('actions.workAction.delete.confirm', currentAction.name), { modal: true }, yes, t(`No`))
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

              const newAction : Action = {
                type: data.type,
                extensions: data.extensions.split(`,`).map(item => item.trim().toUpperCase()),
                environment: data.environment,
                name: data.name,
                command: data.command,
                refresh: data.refresh
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

async function saveActions(actions: Action[]) {
  return GlobalConfiguration.set(`actions`, actions);
}

function loadActions(): Action[] {
  return GlobalConfiguration.get<Action[]>(`actions`) || [];
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