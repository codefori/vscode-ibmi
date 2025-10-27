
import vscode, { l10n } from 'vscode';
import { getActions, updateAction } from '../../api/actions';
import { GetNewLibl } from '../../api/components/getNewLibl';
import { assignProfile, cloneProfile, getConnectionProfile, getConnectionProfiles, getDefaultProfile, updateConnectionProfile } from '../../api/connectionProfiles';
import IBMi from '../../api/IBMi';
import { editAction } from '../../editors/actionEditor';
import { editConnectionProfile } from '../../editors/connectionProfileEditor';
import { instance } from '../../instantiate';
import { Action, ActionEnvironment, ActionType, BrowserItem, ConnectionProfile, CustomVariable, FocusOptions } from '../../typings';
import { uriToActionTarget } from '../actions';
import { VscodeTools } from '../Tools';

namespace Actions {
  export function validateName(name: string, names: string[]) {
    if (!name) {
      return l10n.t('Name cannot be empty');
    }
    else if (names.includes(name.toLocaleUpperCase())) {
      return l10n.t("This name is already used by another action");
    }
  }
}

namespace ConnectionProfiles {
  export function validateName(name: string, names: string[]) {
    if (!name) {
      return l10n.t('Name cannot be empty');
    }
    else if (names.includes(name.toLocaleUpperCase())) {
      return l10n.t("Profile {0} already exists", name);
    }
  }
}

namespace CustomVariables {
  export function getAll() {
    return instance.getConnection()?.getConfig().customVariables || [];
  }

  export function validateName(name: string, names: string[]) {
    name = sanitizeVariableName(name);
    if (!name) {
      return l10n.t('Name cannot be empty');
    }
    else if (names.includes(name.toLocaleUpperCase())) {
      return l10n.t("Custom variable {0} already exists", name);
    }
  }

  function sanitizeVariableName(name: string) {
    return name.replace(/ /g, '_').replace(/&/g, '').toUpperCase();
  }

  export async function update(targetVariable: CustomVariable, options?: { newName?: string, delete?: boolean }) {
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
}

export function initializeContextView(context: vscode.ExtensionContext) {
  const contextView = new ContextView();
  const contextTreeViewer = vscode.window.createTreeView(
    `contextView`, {
    treeDataProvider: contextView,
    showCollapseAll: true
  });

  const updateUIContext = async (profileName?: string) => {
    await vscode.commands.executeCommand(`setContext`, "code-for-ibmi:activeProfile", profileName);
    contextTreeViewer.description = profileName ? l10n.t("Current profile: {0}", profileName) : l10n.t("No active profile");
  };

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
        if (uri.scheme.startsWith(ProfileItem.contextValue) && uri.query === "active") {
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

    vscode.commands.registerCommand("code-for-ibmi.context.action.search", (node: ActionsNode) => node.searchActions()),
    vscode.commands.registerCommand("code-for-ibmi.context.action.search.next", (node: ActionsNode) => node.goToNextSearchMatch()),
    vscode.commands.registerCommand("code-for-ibmi.context.action.search.clear", (node: ActionsNode) => node.clearSearch()),
    vscode.commands.registerCommand("code-for-ibmi.context.action.create", async (node: ActionsNode | ActionTypeNode, from?: ActionItem) => {
      const typeNode = "type" in node ? node : (await vscode.window.showQuickPick(node.getChildren().map(typeNode => ({ label: typeNode.label as string, description: typeNode.description ? typeNode.description as string : undefined, typeNode })), { title: l10n.t("Select an action type") }))?.typeNode;
      if (typeNode) {
        const existingNames = (await getActions(typeNode.workspace)).map(act => act.name);

        const name = await vscode.window.showInputBox({
          title: from ? l10n.t("Copy action '{0}'", from.action.name) : l10n.t("New action"),
          placeHolder: l10n.t("action name..."),
          value: from?.action.name,
          validateInput: name => Actions.validateName(name, existingNames)
        });

        if (name) {
          const action = from ? { ...from.action, name } : {
            name,
            type: typeNode.type,
            environment: "ile" as ActionEnvironment,
            command: ''
          };
          await updateAction(action, typeNode.workspace);
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
        placeHolder: l10n.t("action name..."),
        value: action.name,
        validateInput: newName => Actions.validateName(newName, existingNames)
      });

      if (newName) {
        await updateAction(action, node.workspace, { newName });
        contextView.refresh(node.parent?.parent);
      }
    }),
    vscode.commands.registerCommand("code-for-ibmi.context.action.edit", (node: ActionItem) => {
      editAction(node.action, async () => contextView.refresh(node.parent?.parent), node.workspace);
    }),
    vscode.commands.registerCommand("code-for-ibmi.context.action.copy", async (node: ActionItem) => {
      vscode.commands.executeCommand('code-for-ibmi.context.action.create', node.parent, node);
    }),
    vscode.commands.registerCommand("code-for-ibmi.context.action.delete", async (node: ActionItem) => {
      if (await vscode.window.showInformationMessage(l10n.t("Do you really want to delete action '{0}' ?", node.action.name), { modal: true }, l10n.t("Yes"))) {
        await updateAction(node.action, node.workspace, { delete: true });
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

    vscode.commands.registerCommand("code-for-ibmi.context.variable.declare", async (variablesNode: CustomVariablesNode, from?: CustomVariable) => {
      const existingNames = CustomVariables.getAll().map(v => v.name);
      const name = (await vscode.window.showInputBox({
        title: l10n.t('Enter new Custom Variable name'),
        prompt: l10n.t("The name will automatically be uppercased"),
        placeHolder: l10n.t('new custom variable name...'),
        validateInput: name => CustomVariables.validateName(name, existingNames)
      }));

      if (name) {
        const variable = { name, value: from?.value } as CustomVariable;
        await CustomVariables.update(variable);
        contextView.refresh(variablesNode);
        if (!from) {
          vscode.commands.executeCommand("code-for-ibmi.context.variable.edit", variable, variablesNode);
        }
      }
    }),
    vscode.commands.registerCommand("code-for-ibmi.context.variable.edit", async (variable: CustomVariable, variablesNode?: CustomVariablesNode) => {
      const value = await vscode.window.showInputBox({ title: l10n.t('Enter {0} value', variable.name), value: variable.value });
      if (value !== undefined) {
        variable.value = value;
        await CustomVariables.update(variable);
        contextView.refresh(variablesNode);
      }
    }),
    vscode.commands.registerCommand("code-for-ibmi.context.variable.rename", async (variableItem: CustomVariableItem) => {
      const variable = variableItem.customVariable;
      const existingNames = CustomVariables.getAll().map(v => v.name).filter(name => name !== variable.name);
      const newName = (await vscode.window.showInputBox({
        title: l10n.t('Enter Custom Variable {0} new name', variable.name),
        prompt: l10n.t("The name will automatically be uppercased"),
        validateInput: name => CustomVariables.validateName(name, existingNames)
      }));

      if (newName) {
        await CustomVariables.update(variable, { newName });
        contextView.refresh(variableItem.parent);
      }
    }),
    vscode.commands.registerCommand("code-for-ibmi.context.variable.copy", async (variableItem: CustomVariableItem) => {
      vscode.commands.executeCommand("code-for-ibmi.context.variable.declare", variableItem.parent, variableItem.customVariable);
    }),
    vscode.commands.registerCommand("code-for-ibmi.context.variable.delete", async (variableItem: CustomVariableItem) => {
      const variable = variableItem.customVariable;
      if (await vscode.window.showInformationMessage(l10n.t("Do you really want to delete Custom Variable '{0}' ?", variable.name), { modal: true }, l10n.t("Yes"))) {
        await CustomVariables.update(variable, { delete: true });
        contextView.refresh(variableItem.parent);
      }
    }),

    vscode.commands.registerCommand("code-for-ibmi.context.profile.create", async (profilesNode: ProfilesNode, from?: ConnectionProfile) => {
      const existingNames = getConnectionProfiles().map(profile => profile.name);

      const name = await vscode.window.showInputBox({
        title: l10n.t("Enter new profile name"),
        placeHolder: l10n.t("profile name..."),
        value: from?.name,
        validateInput: name => Actions.validateName(name, existingNames)
      });

      if (name) {
        const connection = instance.getConnection();
        const homeDirectory = connection?.getConfig().homeDirectory || `/home/${connection?.currentUser || 'QPGMR'}`; //QPGMR case should not happen, but better be safe here
        const profile: ConnectionProfile = from ? cloneProfile(from, name) : {
          name,
          homeDirectory,
          currentLibrary: 'QGPL',
          libraryList: ["QGPL", "QTEMP"],
          customVariables: [],
          ifsShortcuts: [homeDirectory],
          objectFilters: [],
        };
        await updateConnectionProfile(profile);
        contextView.refresh(profilesNode);
        if (!from) {
          vscode.commands.executeCommand("code-for-ibmi.context.profile.edit", profile, profilesNode);
        }
        else {
          vscode.window.showInformationMessage(l10n.t("Created connection Profile '{0}'.", profile.name), l10n.t("Activate profile {0}", profile.name))
            .then(doSwitch => {
              if (doSwitch) {
                vscode.commands.executeCommand("code-for-ibmi.context.profile.activate", profile);
              }
            })
        }
      }
    }),
    vscode.commands.registerCommand("code-for-ibmi.context.profile.fromCurrent", async (profilesNode: ProfilesNode) => {
      const config = instance.getConnection()?.getConfig();

      if (config) {
        const current = cloneProfile(config, "");
        vscode.commands.executeCommand("code-for-ibmi.context.profile.create", profilesNode, current);
      }
    }),
    vscode.commands.registerCommand("code-for-ibmi.context.profile.edit", async (profile: ConnectionProfile, parentNode?: BrowserItem) => {
      editConnectionProfile(profile, async () => contextView.refresh(parentNode))
    }),
    vscode.commands.registerCommand("code-for-ibmi.context.profile.rename", async (item: ProfileItem) => {
      const currentName = item.profile.name;
      const existingNames = getConnectionProfiles().map(profile => profile.name).filter(name => name !== currentName);
      const newName = await vscode.window.showInputBox({
        title: l10n.t('Enter Profile {0} new name', item.profile.name),
        placeHolder: l10n.t("profile name..."),
        validateInput: name => ConnectionProfiles.validateName(name, existingNames)
      });

      if (newName) {
        await updateConnectionProfile(item.profile, { newName });
        const config = instance.getConnection()?.getConfig();
        if (config?.currentProfile === currentName) {
          config.currentProfile = newName;
          await IBMi.connectionManager.update(config);
          updateUIContext(newName);
        }
        contextView.refresh(item.parent);
      }
    }),
    vscode.commands.registerCommand("code-for-ibmi.context.profile.copy", async (item: ProfileItem) => {
      vscode.commands.executeCommand("code-for-ibmi.context.profile.create", item.parent, item.profile);
    }),
    vscode.commands.registerCommand("code-for-ibmi.context.profile.delete", async (item: ProfileItem) => {
      if (await vscode.window.showInformationMessage(l10n.t("Do you really want to delete profile '{0}' ?", item.profile.name), { modal: true }, l10n.t("Yes"))) {
        await updateConnectionProfile(item.profile, { delete: true });
        contextView.refresh(item.parent);
      }
    }),
    vscode.commands.registerCommand("code-for-ibmi.context.profile.activate", async (item: ProfileItem | ConnectionProfile) => {
      const connection = instance.getConnection();
      const storage = instance.getStorage();
      if (connection && storage) {
        const profile = "profile" in item ? item.profile : item;
        const config = connection.getConfig();

        const profileToBackup = config.currentProfile ? getConnectionProfile(config.currentProfile) : getDefaultProfile();
        if (profileToBackup) {
          assignProfile(config, profileToBackup);
        }
        assignProfile(profile, config);
        config.currentProfile = profile.name || undefined;
        await IBMi.connectionManager.update(config);

        await Promise.all([
          vscode.commands.executeCommand(`code-for-ibmi.refreshLibraryListView`),
          vscode.commands.executeCommand(`code-for-ibmi.refreshIFSBrowser`),
          vscode.commands.executeCommand(`code-for-ibmi.refreshObjectBrowser`)
        ]);
        contextView.refresh();

        if (profile.name && profile.setLibraryListCommand) {
          await vscode.commands.executeCommand("code-for-ibmi.context.profile.runLiblistCommand", profile);
        }

        await updateUIContext(profile.name);
        vscode.window.showInformationMessage(config.currentProfile ? l10n.t(`Switched to profile "{0}".`, profile.name) : l10n.t("Active profile unloaded"));
      }
    }),

    vscode.commands.registerCommand("code-for-ibmi.context.profile.runLiblistCommand", async (profileItem?: ProfileItem | ConnectionProfile) => {
      const connection = instance.getConnection();
      const storage = instance.getStorage();
      if (connection && storage) {
        const config = connection.getConfig();
        const profile = profileItem && ("profile" in profileItem ? profileItem?.profile : profileItem) || getConnectionProfile(config.get);

        if (profile?.setLibraryListCommand) {
          return await vscode.window.withProgress({ title: l10n.t("Running {0} profile's Library List Command...", profile.name), location: vscode.ProgressLocation.Notification }, async () => {
            try {
              const component = connection.getComponent<GetNewLibl>(GetNewLibl.ID)
              const newSettings = await component?.getLibraryListFromCommand(connection, profile.setLibraryListCommand!);

              if (newSettings) {
                config.libraryList = newSettings.libraryList;
                config.currentLibrary = newSettings.currentLibrary;
                await IBMi.connectionManager.update(config);
                await vscode.commands.executeCommand(`code-for-ibmi.refreshLibraryListView`);
              } else {
                vscode.window.showWarningMessage(l10n.t(`Failed to get library list from command. Feature not installed; try to reload settings when connecting.`));
              }
            } catch (e: any) {
              vscode.window.showErrorMessage(l10n.t(`Failed to get library list from command: {0}`, e.message));
            }
          })
        }
      }
    }),
    vscode.commands.registerCommand("code-for-ibmi.context.profile.unload", async () => {
      vscode.commands.executeCommand("code-for-ibmi.context.profile.activate", getDefaultProfile());
    })
  );

  instance.subscribe(context, 'connected', 'Update context view description', async () => {
    const config = instance.getConnection()?.getConfig();
    const storage = instance.getStorage();
    if (config && storage) {
      //Retrieve and clear old value for last used profile
      const deprecatedLastProfile = storage.getLastProfile();
      if (deprecatedLastProfile) {
        if (deprecatedLastProfile.toLocaleLowerCase() !== 'default') {
          config.currentProfile = deprecatedLastProfile;
          await IBMi.connectionManager.update(config);
        }
        await storage.clearDeprecatedLastProfile();
      }
      updateUIContext(config.currentProfile);
    }
  });
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
    const currentProfile = instance.getConnection()?.getConfig().currentProfile;
    return getConnectionProfiles()
      .sort((p1, p2) => p1.name.localeCompare(p2.name))
      .map(profile => new ProfileItem(this, profile, profile.name === currentProfile));
  }
}

class ProfileItem extends ContextIem {
  static contextValue = `profileItem`;
  static activeColor = "charts.green";

  constructor(parent: BrowserItem, readonly profile: ConnectionProfile, active: boolean) {
    super(profile.name, { parent, icon: "person", color: active ? ProfileItem.activeColor : undefined });

    this.contextValue = `${ProfileItem.contextValue}${active ? '_active' : ''}${profile.setLibraryListCommand ? '_command' : ''}`;
    this.description = active ? l10n.t(`Active profile`) : ``;
    this.resourceUri = vscode.Uri.from({ scheme: this.contextValue, authority: profile.name, query: active ? "active" : "" });
    this.tooltip = VscodeTools.profileToToolTip(profile)

    if (!active) {
      this.command = {
        title: "Edit connection profile",
        command: "code-for-ibmi.context.profile.edit",
        arguments: [this.profile, this.parent]
      }
    }
  }
}

class CustomVariablesNode extends ContextIem {
  constructor() {
    super(l10n.t("Custom Variables"), { state: vscode.TreeItemCollapsibleState.Collapsed });
    this.contextValue = `customVariablesNode`;
  }

  getChildren() {
    return CustomVariables.getAll().map(customVariable => new CustomVariableItem(this, customVariable));
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