
import vscode, { l10n } from 'vscode';
import { getActions, updateAction } from '../../../api/actions';
import { GetNewLibl } from '../../../api/components/getNewLibl';
import { assignProfile, cloneProfile, getConnectionProfile, getConnectionProfiles, getDefaultProfile, updateConnectionProfile } from '../../../api/connectionProfiles';
import IBMi from '../../../api/IBMi';
import { editAction } from '../../../editors/actionEditor';
import { editConnectionProfile } from '../../../editors/connectionProfileEditor';
import { instance } from '../../../instantiate';
import { Action, ActionEnvironment, BrowserItem, ConnectionProfile, CustomVariable, FocusOptions } from '../../../typings';
import { uriToActionTarget } from '../../actions';
import { ActionItem, Actions, ActionsNode, ActionTypeNode } from './actions';
import { ConnectionProfiles, ProfileItem, ProfilesNode } from './connectionProfiles';
import { CustomVariableItem, CustomVariables, CustomVariablesNode } from './customVariables';

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
    vscode.commands.registerCommand("code-for-ibmi.context.actions.focus", () => contextView.actionsNode?.reveal({ focus: true, expand: true })),

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

class ContextView implements vscode.TreeDataProvider<BrowserItem> {
  private readonly emitter = new vscode.EventEmitter<BrowserItem | BrowserItem[] | undefined | null | void>();
  readonly onDidChangeTreeData = this.emitter.event;
  actionsNode?: ActionsNode

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
        const workspaceActions = (await getActions(workspace));
        if (workspaceActions.length) {
          localActions.set(workspace, workspaceActions.sort(sortActions));
        }
      }

      this.actionsNode = new ActionsNode(actions, localActions);

      return [
        this.actionsNode,
        new CustomVariablesNode(),
        new ProfilesNode()
      ];
    }
  }
}