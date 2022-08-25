const vscode = require(`vscode`);

const {CustomUI, Field} = require(`../../api/CustomUI`);

const instance = require(`../../Instance`);

const Configuration = require(`../../api/Configuration`);
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
    const allBaseActions = Configuration.get(`actions`);
    const allActions = allBaseActions.map((action, index) => ({
      ...action,
      index,
    }));

    let ui = new CustomUI();
    let field;

    field = new Field(`tree`, `actions`, `Work with Actions`);
    field.description = `Create or maintain Actions. Actions are grouped by the type of file/object they target.`;

    const icons = {
      branch: `folder`,
      leaf: `file`,
      open: `folder-opened`,
    };

    let types = [];
    allActions.forEach(action => { if (!types.includes(action.type)) types.push(action.type); });
    const treeRoot = [...types].map(type => ({ 
      icons,
      open: true,
      label: `📦 ${type}`,
      type,
      subItems: []
    }));

    treeRoot.forEach(env => {
      const envActions = allActions.filter(action => action.type === env.type);
      env.subItems = envActions.map(action => ({
        icons,
        label: `🔨 ${action.name} (${action.extensions.map(ext => ext.toLowerCase()).join(`, `)})`,
        value: String(action.index),
      }));
    });

    field.treeList = treeRoot;
    
    ui.addField(field);

    field = new Field(`buttons`);
    field.items = [
      {
        id: `newAction`,
        label: `New Action`,
      },
      {
        id: `duplicateAction`,
        label: `Duplicate`,
      }
    ];
    ui.addField(field);

    let {panel, data} = await ui.loadPage(`Work with Actions`);

    if (data) {
      panel.dispose();

      switch (data.buttons) {
      case `newAction`:
        this.WorkAction(-1);
        break;
      case `duplicateAction`:
        this.DuplicateAction();
        break;
      default:
        this.WorkAction(Number(data.actions));
        break;
      }
    }
  }

  /**
   * Show item picker to duplicate an existing action
   */
  static async DuplicateAction() {
    let actions = Configuration.get(`actions`);
  
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
    const config = instance.getConfig();
    let allActions = Configuration.get(`actions`);
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

    let ui = new CustomUI();
    let field;

    ui.addField(new Field(`input`, `name`, `Action name`));
    ui.fields[0].default = currentAction.name;

    ui.addField(new Field(`hr`));

    ui.addField(new Field(`input`, `command`, `Command to run`));
    ui.fields[2].multiline = true;
    ui.fields[2].description = `Below are available variables based on the Type you have select below. You can specify different commands on each line. Each command run is stateless and run in their own job.`;
    ui.fields[2].default = currentAction.command;

    ui.addField(new Field(`tabs`));
    switch (currentAction.type) {
    case `member`:
      ui.fields[3].default = `0`;
      break;
    case `file`:
    case `streamfile`:
      ui.fields[3].default = `1`;
      break;
    case `object`:
      ui.fields[3].default = `2`;
      break;
    }
    ui.fields[3].items = [
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
      }
    ];

    ui.addField(new Field(`hr`));

    ui.addField(new Field(`input`, `extensions`, `Extensions`));
    ui.fields[5].default = currentAction.extensions.join(`, `);
    ui.fields[5].description = `A comma delimited list of extensions for this action. This can be a member extension, a streamfile extension, an object type or an object attribute`;

    ui.addField(new Field(`select`, `type`, `Types`));
    ui.fields[6].description = `The types of files this action can support.`;
    ui.fields[6].items = [
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
      }
    ];

    ui.addField(new Field(`select`, `environment`, `Environment`));
    ui.fields[7].description = `Environment for command to be executed in.`;
    ui.fields[7].items = [
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
      }
    ];

    ui.addField(new Field(`hr`));

    field = new Field(`buttons`);
    field.items = [
      {
        id: `saveAction`,
        label: `Save`,
      }
    ];
    if (id >= 0) {
      field.items.push(
        {
          id: `deleteAction`,
          label: `Delete`,
        });
    };
    field.items.push(
      {
        id: `cancelAction`,
        label: `Cancel`,
      });
    ui.addField(field);

    while (stayOnPanel === true) {
      let {panel, data} = await ui.loadPage(uiTitle);

      if (data) {
        switch (data.buttons) {
        case `deleteAction`:
          const result = await vscode.window.showInformationMessage(`Are you sure you want to delete this action?`, { modal:true }, `Yes`, `No`)
          if (result === `Yes`) {
            allActions.splice(id, 1);
            await Configuration.setGlobal(`actions`, allActions);
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

          await Configuration.setGlobal(`actions`, allActions);
          stayOnPanel=false;
          break;
        }
        
      }
      else {
        stayOnPanel=false;
      }

      panel.dispose();
    }

    this.MainMenu();
  }
  
}