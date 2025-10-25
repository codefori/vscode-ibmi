
import vscode, { l10n } from 'vscode';
import { getActions, saveAction } from '../../api/actions';
import { GetNewLibl } from '../../api/components/getNewLibl';
import IBMi from '../../api/IBMi';
import { editAction } from '../../editors/actionEditor';
import { instance } from '../../instantiate';
import { Action, ActionEnvironment, ActionType, BrowserItem, ConnectionProfile, CustomVariable, FocusOptions, Profile } from '../../typings';
import { uriToActionTarget } from '../actions';

function validateActionName(name: string, names: string[]) {
  name = sanitizeVariableName(name);
  if (!name) {
    return l10n.t('Name cannot be empty');
  }
  else if (names.includes(name.toLocaleUpperCase())) {
    return l10n.t("This name is already used by another action");
  }
}

function getCustomVariables() {
  return instance.getConnection()?.getConfig().customVariables || [];
}

function sanitizeVariableName(name: string) {
  return name.replace(/ /g, '_').replace(/&/g, '').toUpperCase();
}

function validateVariableName(name: string, names: string[]) {
  name = sanitizeVariableName(name);
  if (!name) {
    return l10n.t('Name cannot be empty');
  }
  else if (names.includes(name.toLocaleUpperCase())) {
    return l10n.t("Custom variable {0} already exists", name);
  }
}

async function updateCustomVariable(targetVariable: CustomVariable, options?: { newName?: string, delete?: boolean }) {
  const config = instance.getConnection()?.getConfig();
  if (config) {
    targetVariable.name = sanitizeVariableName(targetVariable.name);
    const variables = config.customVariables;
    const index = variables.findIndex(v => v.name === targetVariable.name);

    if (options?.delete) {
      if (index < 0) {
        throw new Error(l10n.t("Custom variable {0} not found for deletion.", targetVariable.name));
      }
      variables.splice(index, 1);
    }
    else {
      const variable = { name: sanitizeVariableName(options?.newName || targetVariable.name), value: targetVariable.value };
      variables[index < 0 ? variables.length : index] = variable;
    }

    await IBMi.connectionManager.update(config);
  }
}

export function initializeContextView(context: vscode.ExtensionContext) {
  const contextView = new ContextView();
  const contextTreeViewer = vscode.window.createTreeView(
    `contextView`, {
    treeDataProvider: contextView,
    showCollapseAll: true
  });

  context.subscriptions.push(
    contextTreeViewer,
    vscode.window.onDidChangeActiveTextEditor(async editor => {
      let editorCanRunAction = false;
      let editorCanRunLocalAction = false;
      if (editor) {
        const connection = instance.getConnection();
        if (connection) {
          const uri = editor.document.uri;
          if (uri) {
            editorCanRunAction = ['streamfile', 'member', 'object'].includes(uri.scheme);
            editorCanRunLocalAction = uri.scheme === 'file';
          }
        }
      }
      vscode.commands.executeCommand(`setContext`, "code-for-ibmi:editorCanRunRemoteAction", editorCanRunAction);
      vscode.commands.executeCommand(`setContext`, "code-for-ibmi:editorCanRunLocalAction", editorCanRunLocalAction);
    }),
    vscode.window.registerFileDecorationProvider({
      provideFileDecoration(uri: vscode.Uri, token: vscode.CancellationToken): vscode.ProviderResult<vscode.FileDecoration> {
        if (uri.scheme === ProfileItem.contextValue && uri.query === "active") {
          return { color: new vscode.ThemeColor(ProfileItem.activeColor) };
        }
        else if (uri.scheme === ActionItem.contextValue && uri.query === "matched") {
          return { color: new vscode.ThemeColor(ActionItem.matchedColor) };
        }
      }
    }),
    vscode.commands.registerCommand("code-for-ibmi.context.refresh", () => contextView.refresh()),
    vscode.commands.registerCommand("code-for-ibmi.context.refresh.item", (item: BrowserItem) => contextView.refresh(item)),
    vscode.commands.registerCommand("code-for-ibmi.context.reveal", (item: BrowserItem, options?: FocusOptions) => contextTreeViewer.reveal(item, options)),

    vscode.commands.registerCommand(`code-for-ibmi.newConnectionProfile`, () => {
      // Call it with no profile parameter
      vscode.commands.executeCommand(`code-for-ibmi.saveConnectionProfile`);
    }),

    vscode.commands.registerCommand("code-for-ibmi.context.action.search", (node: ActionsNode) => node.searchActions()),
    vscode.commands.registerCommand("code-for-ibmi.context.action.search.next", (node: ActionsNode) => node.goToNextSearchMatch()),
    vscode.commands.registerCommand("code-for-ibmi.context.action.search.clear", (node: ActionsNode) => node.clearSearch()),
    vscode.commands.registerCommand("code-for-ibmi.context.action.create", async (node: ActionsNode | ActionTypeNode) => {
      const typeNode = "type" in node ? node : (await vscode.window.showQuickPick(node.getChildren().map(typeNode => ({ label: typeNode.label as string, description: typeNode.description ? typeNode.description as string : undefined, typeNode })), { title: l10n.t("Select an action type") }))?.typeNode;
      if (typeNode) {
        const existingNames = (await getActions(typeNode.workspace)).map(act => act.name);

        const name = await vscode.window.showInputBox({
          title: l10n.t("Enter new action name"),
          placeHolder: l10n.t("action name..."),
          validateInput: name => validateActionName(name, existingNames)
        });

        if (name) {
          const action = {
            name,
            type: typeNode.type,
            environment: "ile" as ActionEnvironment,
            command: ''
          };
          await saveAction(action, typeNode.workspace);
          contextView.refresh(typeNode.parent);
          vscode.commands.executeCommand("code-for-ibmi.context.action.edit", { action, workspace: typeNode.workspace });
        }
      }
    }),
    vscode.commands.registerCommand("code-for-ibmi.context.action.rename", async (node: ActionItem) => {
      const action = node.action;
      const existingNames = (await getActions(node.workspace)).filter(act => act.name === action.name).map(act => act.name);

      const newName = await vscode.window.showInputBox({
        title: l10n.t("Rename action"),
        value: action.name,
        validateInput: newName => validateActionName(newName, existingNames)
      });

      if (newName) {
        await saveAction(action, node.workspace, { newName });
        contextView.refresh(node.parent?.parent);
      }
    }),
    vscode.commands.registerCommand("code-for-ibmi.context.action.edit", (node: ActionItem) => {
      editAction(node.action, async () => contextView.refresh(), node.workspace);
    }),
    vscode.commands.registerCommand("code-for-ibmi.context.action.copy", async (node: ActionItem) => {
      const action = node.action;
      const existingNames = (await getActions(node.workspace)).map(act => act.name);

      const copyName = await vscode.window.showInputBox({
        title: l10n.t("Copy action '{0}'", action.name),
        placeHolder: l10n.t("new action name..."),
        validateInput: (newName) => existingNames.includes(newName) ? l10n.t("This name is already used by another action") : undefined
      });

      if (copyName) {
        const newCopyAction = { ...action, name: copyName } as Action;
        await saveAction(newCopyAction, node.workspace);
        contextView.refresh(node.parent?.parent);
      }
    }),
    vscode.commands.registerCommand("code-for-ibmi.context.action.delete", async (node: ActionItem) => {
      if (await vscode.window.showInformationMessage(l10n.t("Do you really want to delete action '{0}' ?", node.action.name), { modal: true }, l10n.t("Yes"))) {
        await saveAction(node.action, node.workspace, { delete: true });
        contextView.refresh(node.parent?.parent);
      }
    }),
    vscode.commands.registerCommand("code-for-ibmi.context.action.runOnEditor", (node: ActionItem) => {
      const uri = vscode.window.activeTextEditor?.document.uri;
      if (uri) {
        const editAction = () => vscode.commands.executeCommand("code-for-ibmi.context.action.edit", node);
        const editActionLabel = l10n.t("Edit action");
        const action = node.action;
        if (action.type !== uri.scheme) {
          vscode.window.showErrorMessage(l10n.t("This action cannot run on a {0}.", uri.scheme), editActionLabel).then(edit => edit ? editAction() : '');
          return;
        }

        const workspace = vscode.workspace.getWorkspaceFolder(uri);
        if (workspace && node.workspace && node.workspace !== workspace) {
          vscode.window.showErrorMessage(l10n.t("This action belongs to workspace {0} and cannot be run on a file from workspace {1}", node.workspace.name, workspace.name))
          return;
        }

        const actionTarget = uriToActionTarget(uri);
        if (action.extensions && !action.extensions.includes('GLOBAL') && !action.extensions.includes(actionTarget.extension) && !action.extensions.includes(actionTarget.fragment)) {
          vscode.window.showErrorMessage(l10n.t("This action cannot run on a file with the {0} extension.", actionTarget.extension), editActionLabel).then(edit => edit ? editAction() : '');
          return;
        }

        vscode.commands.executeCommand(`code-for-ibmi.runAction`, uri, undefined, action, undefined, workspace);
      }
    }),

    vscode.commands.registerCommand("code-for-ibmi.context.variable.declare", async (variablesNode: CustomVariablesNode, value?: string) => {
      const existingNames = getCustomVariables().map(v => v.name);
      const name = (await vscode.window.showInputBox({
        title: l10n.t('Enter new Custom Variable name'),
        prompt: l10n.t("The name will automatically be uppercased"),
        placeHolder: l10n.t('new custom variable name...'),
        validateInput: name => validateVariableName(name, existingNames)
      }));

      if (name) {
        const variable = { name, value } as CustomVariable;
        await updateCustomVariable(variable);
        contextView.refresh(variablesNode);
        if (!value) {
          vscode.commands.executeCommand("code-for-ibmi.context.variable.edit", variable, variablesNode);
        }
      }
    }),
    vscode.commands.registerCommand("code-for-ibmi.context.variable.edit", async (variable: CustomVariable, variablesNode?: CustomVariablesNode) => {
      const value = await vscode.window.showInputBox({ title: l10n.t('Enter {0} value', variable.name), value: variable.value });
      if (value !== undefined) {
        variable.value = value;
        await updateCustomVariable(variable);
        contextView.refresh(variablesNode);
      }
    }),
    vscode.commands.registerCommand("code-for-ibmi.context.variable.rename", async (variableItem: CustomVariableItem) => {
      const variable = variableItem.customVariable;
      const existingNames = getCustomVariables().map(v => v.name).filter(name => name !== variable.name);
      const newName = (await vscode.window.showInputBox({
        title: l10n.t('Enter Custom Variable {0} new name', variable.name),
        prompt: l10n.t("The name will automatically be uppercased"),
        validateInput: name => validateVariableName(name, existingNames)
      }));

      if (newName) {
        await updateCustomVariable(variable, { newName });
        contextView.refresh(variableItem.parent);
      }
    }),
    vscode.commands.registerCommand("code-for-ibmi.context.variable.copy", async (variableItem: CustomVariableItem) => {
      vscode.commands.executeCommand("code-for-ibmi.context.variable.declare", variableItem.parent, variableItem.customVariable.value);
    }),
    vscode.commands.registerCommand("code-for-ibmi.context.variable.delete", async (variableItem: CustomVariableItem) => {
      const variable = variableItem.customVariable;
      if (await vscode.window.showInformationMessage(l10n.t("Do you really want to delete Custom Variable '{0}' ?", variable.name), { modal: true }, l10n.t("Yes"))) {
        await updateCustomVariable(variable, { delete: true });
        contextView.refresh(variableItem.parent);
      }
    }),

    vscode.commands.registerCommand(`code-for-ibmi.saveConnectionProfile`, async (profileNode?: Profile) => {
      const connection = instance.getConnection();
      const storage = instance.getStorage();
      if (connection && storage) {
        const config = connection.getConfig();
        const currentProfile = storage.getLastProfile() || '';
        let currentProfiles = config.connectionProfiles;

        const savedProfileName = profileNode?.profile || await vscode.window.showInputBox({
          value: currentProfile,
          prompt: l10n.t(`Name of profile`)
        });

        if (savedProfileName) {
          let savedProfile = currentProfiles.find(profile => profile.name.toUpperCase() === savedProfileName.toUpperCase());
          if (savedProfile) {
            assignProfile(config, savedProfile);
          } else {
            savedProfile = cloneProfile(config, savedProfileName);
            currentProfiles.push(savedProfile);
          }

          await Promise.all([
            IBMi.connectionManager.update(config),
            storage.setLastProfile(savedProfileName)
          ]);
          contextView.refresh();

          vscode.window.showInformationMessage(l10n.t(`Saved current settings to profile "{0}".`, savedProfileName));
        }
      }
    }),

    vscode.commands.registerCommand(`code-for-ibmi.deleteConnectionProfile`, async (profileNode?: Profile) => {
      const connection = instance.getConnection();
      if (connection) {
        const config = connection.getConfig();
        const currentProfiles = config.connectionProfiles;
        const chosenProfile = await getOrPickAvailableProfile(currentProfiles, profileNode);
        if (chosenProfile) {
          vscode.window.showWarningMessage(l10n.t(`Are you sure you want to delete the "{0}" profile?`, chosenProfile.name), l10n.t("Yes")).then(async result => {
            if (result === l10n.t(`Yes`)) {
              currentProfiles.splice(currentProfiles.findIndex(profile => profile === chosenProfile), 1);
              config.connectionProfiles = currentProfiles;
              await IBMi.connectionManager.update(config)
              contextView.refresh();
              // TODO: Add message about deleted profile!
            }
          })
        }
      }
    }),

    vscode.commands.registerCommand(`code-for-ibmi.loadConnectionProfile`, async (profileNode?: Profile) => {
      const connection = instance.getConnection();
      const storage = instance.getStorage();
      if (connection && storage) {
        const config = connection.getConfig();
        const chosenProfile = await getOrPickAvailableProfile(config.connectionProfiles, profileNode);
        if (chosenProfile) {
          assignProfile(chosenProfile, config);
          await IBMi.connectionManager.update(config);

          await Promise.all([
            vscode.commands.executeCommand(`code-for-ibmi.refreshLibraryListView`),
            vscode.commands.executeCommand(`code-for-ibmi.refreshIFSBrowser`),
            vscode.commands.executeCommand(`code-for-ibmi.refreshObjectBrowser`),
            storage.setLastProfile(chosenProfile.name)
          ]);

          vscode.window.showInformationMessage(l10n.t(`Switched to profile "{0}".`, chosenProfile.name));
          contextView.refresh();
        }
      }
    }),

    vscode.commands.registerCommand(`code-for-ibmi.loadCommandProfile`, async (commandProfile?: any) => {
      //TODO
      const connection = instance.getConnection();
      const storage = instance.getStorage();
      if (commandProfile && connection && storage) {
        const config = connection.getConfig();
        const storedProfile = config.connectionProfiles.find(profile => profile.name === commandProfile.profile);

        if (storedProfile && storedProfile.setLibraryListCommand) {
          try {
            const component = connection?.getComponent<GetNewLibl>(GetNewLibl.ID)
            const newSettings = await component?.getLibraryListFromCommand(connection, storedProfile.setLibraryListCommand);

            if (newSettings) {
              config.libraryList = newSettings.libraryList;
              config.currentLibrary = newSettings.currentLibrary;
              await IBMi.connectionManager.update(config);

              await Promise.all([
                storage.setLastProfile(storedProfile.name),
                vscode.commands.executeCommand(`code-for-ibmi.refreshLibraryListView`),
              ]);

              vscode.window.showInformationMessage(l10n.t(`Switched to profile "{0}".`, storedProfile.name));
              contextView.refresh();
            } else {
              vscode.window.showWarningMessage(l10n.t(`Failed to get library list from command. Feature not installed.`));
            }

          } catch (e: any) {
            vscode.window.showErrorMessage(l10n.t(`Failed to get library list from command: {0}`, e.message));
          }
        }
      }
    }),

    vscode.commands.registerCommand(`code-for-ibmi.setToDefault`, () => {
      const connection = instance.getConnection();
      const storage = instance.getStorage();

      if (connection && storage) {
        const config = connection.getConfig();
        vscode.window.showInformationMessage(l10n.t(`Reset to default`), {
          detail: l10n.t(`This will reset the User Library List, working directory and Custom Variables back to the defaults.`),
          modal: true
        }, l10n.t(`Continue`)).then(async result => {
          if (result === l10n.t(`Continue`)) {
            const defaultName = `Default`;

            assignProfile({
              name: defaultName,
              libraryList: connection?.defaultUserLibraries || [],
              currentLibrary: config.currentLibrary,
              customVariables: [],
              homeDirectory: config.homeDirectory,
              ifsShortcuts: config.ifsShortcuts,
              objectFilters: config.objectFilters,
            }, config);

            await IBMi.connectionManager.update(config);

            await Promise.all([
              vscode.commands.executeCommand(`code-for-ibmi.refreshLibraryListView`),
              vscode.commands.executeCommand(`code-for-ibmi.refreshIFSBrowser`),
              vscode.commands.executeCommand(`code-for-ibmi.refreshObjectBrowser`),
              storage.setLastProfile(defaultName)
            ]);
          }
        })
      }
    })

  )
}

class ContextIem extends BrowserItem {
  async refresh() {
    await vscode.commands.executeCommand("code-for-ibmi.context.refresh.item", this);
  }

  reveal(options?: FocusOptions) {
    return vscode.commands.executeCommand<void>(`code-for-ibmi.context.reveal`, this, options);
  }
}

class ContextView implements vscode.TreeDataProvider<BrowserItem> {
  private readonly emitter = new vscode.EventEmitter<BrowserItem | BrowserItem[] | undefined | null | void>();
  readonly onDidChangeTreeData = this.emitter.event;

  refresh(target?: BrowserItem) {
    this.emitter.fire(target);
  }

  getTreeItem(element: BrowserItem): vscode.TreeItem {
    return element;
  }

  getParent(element: BrowserItem) {
    return element?.parent;
  }

  async getChildren(item?: BrowserItem) {
    if (item) {
      return item.getChildren?.();
    }
    else {
      const sortActions = (a1: Action, a2: Action) => a1.name.localeCompare(a2.name);

      const actions = (await getActions()).sort(sortActions);
      const localActions = new Map<vscode.WorkspaceFolder, Action[]>();
      for (const workspace of vscode.workspace.workspaceFolders || []) {
        localActions.set(workspace, (await getActions(workspace)).sort(sortActions));
      }

      return [
        new ActionsNode(actions, localActions),
        new CustomVariablesNode(),
        new ProfilesNode()
      ];
    }
  }
}

class ActionsNode extends ContextIem {
  private readonly foundActions: ActionItem[] = [];
  private revealIndex = -1;

  private readonly children;

  constructor(actions: Action[], localActions: Map<vscode.WorkspaceFolder, Action[]>) {
    super(l10n.t("Actions"), { state: vscode.TreeItemCollapsibleState.Collapsed });
    this.contextValue = "actionsNode";
    this.children = [
      new ActionTypeNode(this, l10n.t("Member"), 'member', actions),
      new ActionTypeNode(this, l10n.t("Object"), 'object', actions),
      new ActionTypeNode(this, l10n.t("Streamfile"), 'streamfile', actions),
      ...Array.from(localActions).map((([workspace, localActions]) => new ActionTypeNode(this, workspace.name, 'file', localActions, workspace)))
    ]
  }

  getChildren() {
    return this.children;
  }

  getAllActionItems() {
    return this.children.flatMap(child => child.actionItems);
  }

  async searchActions() {
    const nameOrCommand = (await vscode.window.showInputBox({ title: l10n.t("Search action"), placeHolder: l10n.t("name or command...") }))?.toLocaleLowerCase();
    if (nameOrCommand) {
      await this.clearSearch();
      const found = this.foundActions.push(...this.getAllActionItems().filter(action => [action.action.name, action.action.command].some(text => text.toLocaleLowerCase().includes(nameOrCommand)))) > 0;
      await vscode.commands.executeCommand(`setContext`, `code-for-ibmi:hasActionSearched`, found);
      if (found) {
        this.foundActions.forEach(node => node.setContext(true));
        this.refresh();
        this.goToNextSearchMatch();
      }
    }
  }

  goToNextSearchMatch() {
    this.revealIndex += (this.revealIndex + 1) < this.foundActions.length ? 1 : -this.revealIndex;
    const actionNode = this.foundActions[this.revealIndex];
    actionNode.reveal({ focus: true });
  }

  async clearSearch() {
    this.getAllActionItems().forEach(node => node.setContext(false));
    this.revealIndex = -1;
    this.foundActions.splice(0, this.foundActions.length);
    await vscode.commands.executeCommand(`setContext`, `code-for-ibmi:hasActionSearched`, false);
    await this.refresh();
  }
}

class ActionTypeNode extends ContextIem {
  readonly actionItems: ActionItem[];
  constructor(parent: BrowserItem, label: string, readonly type: ActionType, actions: Action[], readonly workspace?: vscode.WorkspaceFolder) {
    super(label, { parent, state: vscode.TreeItemCollapsibleState.Collapsed });
    this.contextValue = `actionTypeNode_${type}`;
    this.description = workspace ? l10n.t("workspace actions") : undefined;
    this.actionItems = actions.filter(action => action.type === type).map(action => new ActionItem(this, action, workspace));
  }

  getChildren() {
    return this.actionItems;
  }
}

class ActionItem extends ContextIem {
  static matchedColor = "charts.yellow";
  static contextValue = `actionItem`;

  constructor(parent: BrowserItem, readonly action: Action, readonly workspace?: vscode.WorkspaceFolder) {
    super(action.name, { parent });
    this.setContext();
    this.command = {
      title: "Edit action",
      command: "code-for-ibmi.context.action.edit",
      arguments: [this]
    }
  }

  setContext(matched?: boolean) {
    this.contextValue = `${ActionItem.contextValue}${this.workspace ? "Local" : "Remote"}${matched ? '_matched' : ''}`;
    this.iconPath = new vscode.ThemeIcon("github-action", matched ? new vscode.ThemeColor(ActionItem.matchedColor) : undefined);
    this.resourceUri = vscode.Uri.from({ scheme: ActionItem.contextValue, authority: this.action.name, query: matched ? "matched" : "" });
    this.description = matched ? l10n.t("search match") : undefined;
    this.tooltip = this.action.command;
  }
}

class ProfilesNode extends ContextIem {
  constructor() {
    super(l10n.t("Profiles"), { state: vscode.TreeItemCollapsibleState.Collapsed });
    this.contextValue = "profilesNode";
  }

  getChildren() {
    const currentProfile = instance.getStorage()?.getLastProfile();
    return instance.getConnection()?.getConfig().connectionProfiles
      .sort((p1, p2) => p1.name.localeCompare(p2.name))
      .map(profile => new ProfileItem(this, profile, profile.name === currentProfile));
  }
}

class ProfileItem extends ContextIem {
  static contextValue = `profileItem`;
  static activeColor = "charts.green";

  constructor(parent: BrowserItem, readonly profile: ConnectionProfile, active: boolean) {
    super(profile.name, { parent, icon: "person", color: active ? ProfileItem.activeColor : undefined });

    this.contextValue = `${ProfileItem.contextValue}${active ? '_active' : ''}`;
    this.description = active ? l10n.t(`Active`) : ``;
    this.resourceUri = vscode.Uri.from({ scheme: this.contextValue, authority: profile.name, query: active ? "active" : "" });
  }
}

class CustomVariablesNode extends ContextIem {
  constructor() {
    super(l10n.t("Custom Variables"), { state: vscode.TreeItemCollapsibleState.Collapsed });
    this.contextValue = `customVariablesNode`;
  }

  getChildren() {
    return getCustomVariables().map(customVariable => new CustomVariableItem(this, customVariable));
  }
}

class CustomVariableItem extends ContextIem {
  constructor(parent: BrowserItem, readonly customVariable: CustomVariable) {
    super(customVariable.name, { parent, icon: "symbol-variable" });
    this.contextValue = `customVariableItem`;
    this.description = customVariable.value;

    this.command = {
      title: "Change value",
      command: "code-for-ibmi.context.variable.edit",
      arguments: [this.customVariable]
    }
  }
}

async function getOrPickAvailableProfile(availableProfiles: ConnectionProfile[], profileNode?: Profile): Promise<ConnectionProfile | undefined> {
  if (availableProfiles.length > 0) {
    if (profileNode) {
      return availableProfiles.find(profile => profile.name === profileNode.profile);
    }
    else {
      const items = availableProfiles.map(profile => {
        return {
          label: profile.name,
          profile: profile
        }
      });
      return (await vscode.window.showQuickPick(items))?.profile;
    }
  }
  else {
    vscode.window.showInformationMessage(`No profiles exist for this system.`);
  }
}

function assignProfile(fromProfile: ConnectionProfile, toProfile: ConnectionProfile) {
  toProfile.homeDirectory = fromProfile.homeDirectory;
  toProfile.currentLibrary = fromProfile.currentLibrary;
  toProfile.libraryList = fromProfile.libraryList;
  toProfile.objectFilters = fromProfile.objectFilters;
  toProfile.ifsShortcuts = fromProfile.ifsShortcuts;
  toProfile.customVariables = fromProfile.customVariables;
}

function cloneProfile(fromProfile: ConnectionProfile, newName: string): ConnectionProfile {
  return {
    name: newName,
    homeDirectory: fromProfile.homeDirectory,
    currentLibrary: fromProfile.currentLibrary,
    libraryList: fromProfile.libraryList,
    objectFilters: fromProfile.objectFilters,
    ifsShortcuts: fromProfile.ifsShortcuts,
    customVariables: fromProfile.customVariables
  }
}



class ResetProfileItem extends BrowserItem implements Profile {
  readonly profile;
  constructor() {
    super(`Reset to Default`);

    this.contextValue = `resetProfile`;
    this.iconPath = new vscode.ThemeIcon(`debug-restart`);
    this.tooltip = ``;

    this.profile = `Default`;
  }
}



/* saved for later
.addParagraph(`Command Profiles can be used to set your library list based on the result of a command like <code>CHGLIBL</code>, or your own command that sets the library list. Commands should be as explicit as possible. When refering to commands and objects, both should be qualified with a library.`)
    .addInput(`name`, `Name`, `Name of the Command Profile`, {default: currentSettings.name})
    .addInput(`setLibraryListCommand`, `Library list command`, `Command to be executed that will set the library list`, {default: currentSettings.command})
  */