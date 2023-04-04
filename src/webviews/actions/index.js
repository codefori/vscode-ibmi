const vscode = require(`vscode`);

const {CustomUI} = require(`../../api/CustomUI`);

const {GlobalConfiguration, ConnectionConfiguration} = require(`../../api/Configuration`);
const Variables = require(`./varinfo`);

module.exports = class SettingsUI {

  /**
   * Called to log in to an IBM i
   * @param {vscode.ExtensionContext} context
   */
  static init(context) {
    context.subscriptions.push(
      vscode.commands.registerCommand(`code-for-ibmi.showActionsMaintenance`, async () => {
        this.MainMenu();
      })
    )
  }

  static async MainMenu() {
    const allActions = GlobalConfiguration.get(`actions`).map((action, index) => ({
      ...action,
      index,
    }));

    const icons = {
      branch: `folder`,
      leaf: `file`,
      open: `folder-opened`,
    };
    const ui = new CustomUI()
      .addTree(`actions`, `Work with Actions`,
        Array.from(new Set(allActions.map(action => action.type)))
          .map(type => ({ 
            icons,
            open: true,
            label: `📦 ${type}`,
            type,
            subItems: allActions.filter(action => action.type === type)
              .map(action => ({
                icons,
                label: `🔨 ${action.name} (${action.extensions.map(ext => ext.toLowerCase()).join(`, `)})`,
                value: String(action.index),
              }))
          })),
        `Create or maintain Actions. Actions are grouped by the type of file/object they target.`)
      .addButtons(
        {id: `newAction`, label: `New Action` },
        { id: `duplicateAction`, label: `Duplicate`}
      );
    
    const page = await ui.loadPage(`Work with Actions`);
    if (page && page.data) {
      page.panel.dispose();

      switch (page.data.buttons) {
      case `newAction`:
        this.WorkAction(-1);
        break;
      case `duplicateAction`:
        this.DuplicateAction();
        break;
      default:
        this.WorkAction(Number(page.data.actions));
        break;
      }
    }
  }

  /**
   * Show item picker to duplicate an existing action
   */
  static async DuplicateAction() {
    let actions = GlobalConfiguration.get(`actions`);
  
    vscode.window.showQuickPick(
      actions.map((action, index) => ({
        label: `${action.name} (${action.type}: ${action.extensions.join(`, `)})`,
        value: index
      })).sort((a, b) => a.label.localeCompare(b.label)),
      {
        placeHolder: `Select an action to duplicate`
      }
    ).then(async (action) => {
      if (action) {
        //@ts-ignore
        const index = action.value;

        const newAction = {...actions[index]};
        this.WorkAction(-1, newAction);
      } else {
        this.MainMenu();
      }
  
    });
  }

  /**
   * Edit an existing action
   * @param {number} id Existing action index, or -1 for a brand new index
   * @param {object} ActionDefault Default action properties
   */
  static async WorkAction(id, ActionDefault) {
    const {instance} = require(`../../instantiate`);
    const config = instance.getConfig();
    let allActions = GlobalConfiguration.get(`actions`);
    let currentAction;
    let uiTitle;
    let stayOnPanel = true;

    if (id >= 0) {
      //Fetch existing action
      
      currentAction = allActions[id];
      uiTitle = `Edit action "${currentAction.name}"`;

    } else if (ActionDefault) {
      currentAction = ActionDefault;
      uiTitle = `Duplicate action "${currentAction.name}"`;
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
        command: ``
      }
      uiTitle = `Create action`;
    }

    if (currentAction.environment === undefined) currentAction.environment = `ile`;

    // Our custom variables as HTML
    const custom = config.customVariables.map(variable => `<li><b><code>&amp;${variable.name}</code></b>: <code>${variable.value}</code></li>`).join(``);

    const ui = new CustomUI()
      .addInput(`name`, `Action name`, undefined, {default:currentAction.name})
      .addHorizontalRule()
      .addInput(
        `command`,
        `Command to run`, 
        `Below are available variables based on the Type you have select below. You can specify different commands on each line. Each command run is stateless and run in their own job.`,
        { rows: 5, default: currentAction.command}
      )
      .addTabs([
        {
          label: `Member`,
          value: `<ul>${Variables.Member.map(variable => `<li><b><code>${variable.name}</code></b>: ${variable.text}</li>`).join(``)}${custom}</ul>`,
        },
        {
          label: `Streamfile / File`,
          value: `<ul>${Variables.Streamfile.map(variable => `<li><b><code>${variable.name}</code></b>: ${variable.text}</li>`).join(``)}${custom}</ul>`,
        },
        {
          label: `Object`,
          value: `<ul>${Variables.Object.map(variable => `<li><b><code>${variable.name}</code></b>: ${variable.text}</li>`).join(``)}${custom}</ul>`,
        }], getDefaultTabIndex(currentAction.type)
      )
      .addHorizontalRule()
      .addInput(`extensions`, `Extensions`, `A comma delimited list of extensions for this action. This can be a member extension, a streamfile extension, an object type or an object attribute`, {default: currentAction.extensions.join(`, `)})
      .addSelect(`type`, `Types`, [
        {
          selected: currentAction.type === `member`,
          value: `member`,
          description: `Member`,
          text: `Source members in the QSYS file system`,
        },
        {
          selected: currentAction.type === `streamfile`,
          value: `streamfile`,
          description: `Streamfile`,
          text: `Streamfiles in the IFS`,
        },
        {
          selected: currentAction.type === `object`,
          value: `object`,
          description: `Object`,
          text: `Objects in the QSYS file system`,
        },
        {
          selected: currentAction.type === `file`,
          value: `file`,
          description: `Local File (Workspace)`,
          text: `Actions for local files in the VS Code Workspace.`,
        }], `The types of files this action can support.`
      )
      .addSelect(`environment`, `Environment`, [
        {
          selected: currentAction.environment === `ile`,
          value: `ile`,
          description: `ILE`,
          text: `Runs as an ILE command`,
        },
        {
          selected: currentAction.environment === `qsh`,
          value: `qsh`,
          description: `QShell`,
          text: `Runs the command through QShell`,
        },
        {
          selected: currentAction.environment === `pase`,
          value: `pase`,
          description: `PASE`,
          text: `Runs the command in the PASE environment`,
        }], `Environment for command to be executed in.`
      )
      .addHorizontalRule()
      .addButtons(
        { id: `saveAction`, label: `Save` },
        id >= 0 ? {id: `deleteAction`, label: `Delete`} : undefined,
        { id: `cancelAction`, label: `Cancel` }  
      );

    while (stayOnPanel === true) {
      const page = await ui.loadPage(uiTitle);
      if (page && page.data) {        
        const data = page.data;
        switch (data.buttons) {
        case `deleteAction`:
          const result = await vscode.window.showInformationMessage(`Are you sure you want to delete this action?`, { modal:true }, `Yes`, `No`)
          if (result === `Yes`) {
            allActions.splice(id, 1);
            await GlobalConfiguration.set(`actions`, allActions);
            stayOnPanel=false;
          }
          break;

        case `cancelAction`:
          stayOnPanel=false;
          break;

        default:
          // We don't want \r (Windows line endings)
          data.command = data.command.replace(new RegExp(`\\\r`, `g`), ``);

          const newAction = {
            type: data.type,
            extensions: data.extensions.split(`,`).map(item => item.trim().toUpperCase()),
            environment: data.environment,
            name: data.name,
            command: data.command,
          };
      
          if (id >= 0) {
            allActions[id] = newAction;
          } else {
            allActions.push(newAction);
          }

          await GlobalConfiguration.set(`actions`, allActions);
          stayOnPanel=false;
          break;
        }
        
      }
      else {
        stayOnPanel=false;
      }

      page.panel.dispose();
    }

    this.MainMenu();
  }  
}

function getDefaultTabIndex(type){
  switch (type) {
  case `member`:
    return 0;
  case `file`:
  case `streamfile`:
    return 1;
  case `object`:
    return 2;
  } 
}