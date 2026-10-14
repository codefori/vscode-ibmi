
import { parse as parseQuery } from "querystring";
import vscode, { l10n, QuickPickItem, ThemeIcon, window } from 'vscode';
import { ActionTools } from '../../../api/actions';
import { assignProfile, cloneProfile, getAllConnectionProfiles, getConnectionProfile, getDefaultProfile, isActiveProfile, ProfileConflictError, updateConnectionProfile } from '../../../api/connectionProfiles';
import IBMi from '../../../api/IBMi';
import { onCodeForIBMiConfigurationChange } from "../../../config/Configuration";
import { editAction, isActionEdited } from '../../../editors/actionEditor';
import { editConnectionProfile, isProfileEdited } from '../../../editors/connectionProfileEditor';
import { instance } from '../../../instantiate';
import { Action, ActionEnvironment, AnyConnectionProfile, BrowserItem, ConnectionConfig, ConnectionProfile, CustomVariable, FocusOptions, ProfileState, ProfileType, ServerConnectionProfile } from '../../../typings';
import { uriToActionTarget } from '../../actions';
import { ActionItem, Actions, ActionsNode, ActionTypeNode } from './actions';
import { ConnectionProfiles, ProfileItem, ProfilesNode } from './connectionProfiles';
import { CustomVariableItem, CustomVariables, CustomVariablesNode } from './customVariables';
import { EnvironmentItem } from './environmentItem';
import * as path from 'path';

const SQL_JOB_DOUBLE_CLICK_WINDOW_MS = 500;
let lastSqlJobClick: { jobName: string; clickedAt: number } | undefined;

class ConnectionNode extends EnvironmentItem {
  constructor() {
    super(l10n.t("Connection"), { icon: "server-environment", state: vscode.TreeItemCollapsibleState.Collapsed });
    this.contextValue = "connectionNode";
  }

  get name() {
    return instance.getConnection()?.currentConnectionName || "";
  }

  updateFromConnection() {
    const connection = instance.getConnection();
    this.label = connection ? l10n.t("Connection: {0}", connection.currentConnectionName) : l10n.t("Connection");
  }

  getChildren() {
    const connection = instance.getConnection();
    if (!connection) {
      return [];
    }

    return [
      ...(connection.getSqlJobId() ? [new SqlJobItem(this, connection.getSqlJobId()!)] : []),
      new ConnectionInfoItem(this, l10n.t("Host"), connection.currentHost, "vm"),
      new ConnectionInfoItem(this, l10n.t("Port"), String(connection.currentPort), "plug"),
      new ConnectionInfoItem(this, l10n.t("User"), connection.currentUser, "account"),
      new DisconnectItem(this, connection.currentConnectionName)
    ];
  }
}

class ConnectionInfoItem extends EnvironmentItem {
  constructor(parent: EnvironmentItem, label: string, value: string, icon: string) {
    super(label, { parent, icon });
    this.contextValue = "connectionInfoItem";
    this.description = value;
    this.tooltip = l10n.t("{0}: {1}", label, value);
  }
}

class SqlJobItem extends EnvironmentItem {
  constructor(parent: EnvironmentItem, sqlJobId: string) {
    super(l10n.t("SQL Job"), { parent, icon: "database", state: vscode.TreeItemCollapsibleState.Collapsed });
    this.contextValue = "connectionSqlJobItem";
    this.description = sqlJobId;
    this.tooltip = l10n.t("SQL Job: {0}", sqlJobId);
    this.command = {
      title: l10n.t("Display SQL Job Log"),
      command: "code-for-ibmi.environment.connection.showJobLogOnDoubleClick",
      arguments: [sqlJobId]
    };
  }

  getChildren() {
    const jdbcOptions = instance.getConnection()?.getSqlJobJDBCOptions() || {};
    return Object.entries(jdbcOptions)
      .map(([key, value]) => ({ key, value }))
      .filter(option => option.value !== undefined && option.value !== null)
      .map(option => new ConnectionInfoItem(this, option.key, String(option.value), "symbol-property"));
  }
}

class DisconnectItem extends EnvironmentItem {
  constructor(parent: EnvironmentItem, connectionName: string) {
    super(l10n.t("Disconnect {0}", connectionName), { parent, icon: "debug-disconnect", color: "charts.red" });
    this.contextValue = "connectionDisconnectItem";
    this.description = l10n.t("Disconnect from current system");
    this.tooltip = l10n.t("Click to Disconnect from {0}", connectionName);
    this.command = {
      title: l10n.t("Disconnect from {0}", connectionName),
      command: "code-for-ibmi.environment.connection.disconnect",
      arguments: [connectionName]
    };
  }
}

export function initializeEnvironmentView(context: vscode.ExtensionContext) {
  const environmentView = new EnvironmentView();
  const environmentTreeViewer = vscode.window.createTreeView(
    `environmentView`, {
    treeDataProvider: environmentView,
    showCollapseAll: true
  });

  const updateUIContext = async (profileName?: string) => {
    environmentTreeViewer.description = profileName ? l10n.t("Current profile: {0}", profileName) : l10n.t("No active profile");
    vscode.commands.executeCommand("code-for-ibmi.updateConnectedBar");
  };

  const saveProfile = async (profile: AnyConnectionProfile, options?: SaveProfileOptions) => {
    try {
      return await saveConnectionProfile(profile, options);
    } catch (error: any) {
      vscode.window.showErrorMessage(l10n.t("Could not save profile {0}: {1}", profile.name, String(error.message || error)));
      return false;
    }
  };

  const localActionsWatcher = vscode.workspace.createFileSystemWatcher(`**/.vscode/actions.json`);
  localActionsWatcher.onDidCreate(() => environmentView.actionsNode?.forceRefresh());
  localActionsWatcher.onDidChange(() => environmentView.actionsNode?.forceRefresh());
  localActionsWatcher.onDidDelete(() => environmentView.actionsNode?.forceRefresh());

  onCodeForIBMiConfigurationChange("actions", () => environmentView.actionsNode?.forceRefresh())

  instance.subscribe(context, "connected", "Update active profile status on environment view", () => {
    const connection = instance.getConnection();
    if (connection) {
      const config = connection.getConfig();
      const currentProfile = config.currentProfile;
      updateUIContext(currentProfile);
    }
  });

  context.subscriptions.push(
    environmentTreeViewer,
    localActionsWatcher,
    vscode.window.onDidChangeActiveTextEditor(async editor => environmentView.actionsNode?.activeEditorChanged(editor)),
    vscode.window.registerFileDecorationProvider({
      provideFileDecoration(uri: vscode.Uri, token: vscode.CancellationToken): vscode.ProviderResult<vscode.FileDecoration> {
        if (uri.scheme.startsWith(ProfileItem.contextValue)) {
          const query = parseQuery(uri.query);
          const active = query.active ? true : false;
          const color = ProfileItem.getColor(active, query.type as ProfileType, query.state as ProfileState);
          if (color) {
            return { color: new vscode.ThemeColor(color) };
          }
        } else if (uri.scheme === ActionItem.contextValue) {
          const query = parseQuery(uri.query);
          if (query.matched && query.canRun) {
            return { color: new vscode.ThemeColor(ActionItem.matchedCanRunColor) };
          }
          if (query.matched) {
            return { color: new vscode.ThemeColor(ActionItem.matchedColor) };
          }
          if (query.canRun) {
            return { color: new vscode.ThemeColor(ActionItem.canRunColor) };
          }
        }
      }
    }),

    vscode.commands.registerCommand("code-for-ibmi.environment.refresh", async () => {
      await vscode.window.withProgress({ location: { viewId: `environmentView` } }, async (progress) => {
        const connection = instance.getConnection();
        if (connection) {
          await connection.loadRemoteConfigs([`profiles`]);
        }

        environmentView.refresh();
      });
    }),
    vscode.commands.registerCommand("code-for-ibmi.environment.refresh.item", (item: BrowserItem) => environmentView.refresh(item)),
    vscode.commands.registerCommand("code-for-ibmi.environment.reveal", (item: BrowserItem, options?: FocusOptions) => environmentTreeViewer.reveal(item, options)),
    vscode.commands.registerCommand("code-for-ibmi.environment.connection.showJobLog", async (jobName?: string) => {
      const sqlJobId = jobName || instance.getConnection()?.getSqlJobId();
      if (!sqlJobId) {
        vscode.window.showWarningMessage(l10n.t("No active SQL job found."));
        return;
      }

      await vscode.commands.executeCommand("code-for-ibmi.showJobLog", sqlJobId);
    }),
    vscode.commands.registerCommand("code-for-ibmi.environment.connection.showJobLogOnDoubleClick", async (jobName?: string) => {
      const sqlJobId = jobName || instance.getConnection()?.getSqlJobId();
      if (!sqlJobId) {
        return;
      }

      const now = Date.now();
      if (lastSqlJobClick && lastSqlJobClick.jobName === sqlJobId && (now - lastSqlJobClick.clickedAt) <= SQL_JOB_DOUBLE_CLICK_WINDOW_MS) {
        lastSqlJobClick = undefined;
        await vscode.commands.executeCommand("code-for-ibmi.environment.connection.showJobLog", sqlJobId);
        return;
      }

      lastSqlJobClick = { jobName: sqlJobId, clickedAt: now };
    }),
    vscode.commands.registerCommand("code-for-ibmi.environment.connection.disconnect", async (connectionName?: string) => {
      const connectedName = instance.getConnection()?.currentConnectionName;
      const name = connectionName || connectedName;
      if (!name) return;

      const yes = await vscode.window.showWarningMessage(
        l10n.t("Are you sure you want to disconnect from {0}?", name),
        { modal: true },
        l10n.t("Yes")
      );

      if (yes) {
        await vscode.commands.executeCommand("code-for-ibmi.disconnect");
      }
    }),

    vscode.commands.registerCommand("code-for-ibmi.environment.action.search", (node: ActionsNode) => node.searchActions()),
    vscode.commands.registerCommand("code-for-ibmi.environment.action.search.next", (node: ActionsNode) => node.goToNextSearchMatch()),
    vscode.commands.registerCommand("code-for-ibmi.environment.action.search.clear", (node: ActionsNode) => node.clearSearch()),
    vscode.commands.registerCommand("code-for-ibmi.environment.action.create", async (node: ActionsNode | ActionTypeNode, from?: ActionItem) => {
      const typeNode = "type" in node ? node : (await vscode.window.showQuickPick<QuickPickItem & { typeNode: ActionTypeNode }>((await node.getChildren()).map(typeNode => ({ label: typeNode.label as string, description: typeNode.description ? typeNode.description as string : undefined, typeNode })), { title: l10n.t("Select an action type") }))?.typeNode;
      if (typeNode) {
        const existingNames = (await ActionTools.getActions(typeNode.workspace)).filter(act => act.type === typeNode.type).map(act => act.name);

        const name = await vscode.window.showInputBox({
          title: from ? l10n.t("Copy action '{0}'", from.action.name) : l10n.t("New action"),
          placeHolder: l10n.t("Action name..."),
          value: from?.action.name,
          validateInput: name => Actions.validateName(name, existingNames)
        });

        if (name) {
          const action: Action = from ? { ...from.action, name } : {
            name,
            type: typeNode.type,
            environment: "ile" as ActionEnvironment,
            command: ''
          };
          await ActionTools.updateAction(action, typeNode.workspace);
          vscode.commands.executeCommand("code-for-ibmi.environment.action.edit", { action, workspace: typeNode.workspace });
        }
      }
    }),
    vscode.commands.registerCommand("code-for-ibmi.environment.action.rename", async (node: ActionItem) => {
      const action = node.action;
      if (isActionEdited(node.action)) {
        vscode.window.showWarningMessage(l10n.t("Action '{0}' is being edited. Please close its editor first.", action.name));
      }
      else {
        const existingNames = (await ActionTools.getActions(node.workspace)).filter(act => act.name !== action.name && act.type === action.type).map(act => act.name);

        const newName = await vscode.window.showInputBox({
          title: l10n.t("Rename action"),
          placeHolder: l10n.t("Action name..."),
          value: action.name,
          validateInput: newName => Actions.validateName(newName, existingNames)
        });

        if (newName) {
          await ActionTools.updateAction(action, node.workspace, { newName });
        }
      }
    }),
    vscode.commands.registerCommand("code-for-ibmi.environment.action.edit", (node: ActionItem) => {
      editAction(node.action, undefined, node.workspace);
    }),
    vscode.commands.registerCommand("code-for-ibmi.environment.action.copy", async (node: ActionItem) => {
      vscode.commands.executeCommand('code-for-ibmi.environment.action.create', node.parent, node);
    }),
    vscode.commands.registerCommand("code-for-ibmi.environment.action.delete", async (node: ActionItem) => {
      if (isActionEdited(node.action)) {
        vscode.window.showWarningMessage(l10n.t("Action '{0}' is being edited. Please close its editor first.", node.action.name));
      }
      else if (await vscode.window.showInformationMessage(l10n.t("Do you really want to delete action '{0}' ?", node.action.name), { modal: true }, l10n.t("Yes"))) {
        await ActionTools.updateAction(node.action, node.workspace, { delete: true });
      }
    }),
    vscode.commands.registerCommand("code-for-ibmi.environment.action.runOnEditor", (node: ActionItem) => {
      const uri = vscode.window.activeTextEditor?.document.uri;
      if (uri) {
        const editAction = () => vscode.commands.executeCommand("code-for-ibmi.environment.action.edit", node);
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
    vscode.commands.registerCommand("code-for-ibmi.environment.actions.focus", () => environmentView.actionsNode?.reveal({ focus: true, expand: true })),

    vscode.commands.registerCommand("code-for-ibmi.environment.variable.declare", async (variablesNode: CustomVariablesNode, from?: CustomVariable) => {
      const existingNames = CustomVariables.getAll().map(v => v.name);
      const name = (await vscode.window.showInputBox({
        title: l10n.t('Enter new Custom Variable name'),
        prompt: l10n.t("The name will automatically be uppercased"),
        placeHolder: l10n.t('New custom variable name...'),
        validateInput: name => CustomVariables.validateName(name, existingNames)
      }));

      if (name) {
        const variable = { name, value: from?.value } as CustomVariable;
        if (from) {
          await CustomVariables.update(variable);
        } else {
          vscode.commands.executeCommand("code-for-ibmi.environment.variable.edit", variable, variablesNode);
        }
      }
    }),
    vscode.commands.registerCommand("code-for-ibmi.environment.variable.edit", async (variable: CustomVariable, variablesNode?: CustomVariablesNode) => {
      const value = await vscode.window.showInputBox({ title: l10n.t('Enter {0} value', variable.name), value: variable.value });
      if (value !== undefined) {
        variable.value = value;
        await CustomVariables.update(variable);
      }
    }),
    vscode.commands.registerCommand("code-for-ibmi.environment.variable.rename", async (variableItem: CustomVariableItem) => {
      const variable = variableItem.customVariable;
      const existingNames = CustomVariables.getAll().map(v => v.name).filter(name => name !== variable.name);
      const newName = (await vscode.window.showInputBox({
        title: l10n.t('Enter Custom Variable {0} new name', variable.name),
        prompt: l10n.t("The name will automatically be uppercased"),
        validateInput: name => CustomVariables.validateName(name, existingNames)
      }));

      if (newName) {
        await CustomVariables.update(variable, { newName });
      }
    }),
    vscode.commands.registerCommand("code-for-ibmi.environment.variable.copy", async (variableItem: CustomVariableItem) => {
      vscode.commands.executeCommand("code-for-ibmi.environment.variable.declare", variableItem.parent, variableItem.customVariable);
    }),
    vscode.commands.registerCommand("code-for-ibmi.environment.variable.delete", async (variableItem: CustomVariableItem) => {
      const variable = variableItem.customVariable;
      if (await vscode.window.showInformationMessage(l10n.t("Do you really want to delete Custom Variable '{0}' ?", variable.name), { modal: true }, l10n.t("Yes"))) {
        await CustomVariables.update(variable, { delete: true });
      }
    }),

    vscode.commands.registerCommand("code-for-ibmi.environment.profile.create", async (node?: ProfilesNode, from?: ConnectionProfile) => {
      await vscode.window.withProgress({ location: { viewId: `environmentView` } }, async (progress) => {
        const existingNames = (await getAllConnectionProfiles()).map(profile => profile.name);

        const name = await vscode.window.showInputBox({
          title: l10n.t("Enter new profile name"),
          placeHolder: l10n.t("Profile name..."),
          value: from?.name,
          validateInput: name => ConnectionProfiles.validateName(name, existingNames)
        });
        if (!name) {
          return;
        }

        const connection = instance.getConnection();
        const localConfigFilePath = process.env.APPDATA ? path.join(process.env.APPDATA, 'Code', 'User', 'settings.json') : undefined;
        const profilesConfigFile = connection?.getConfigFile(`profiles`);
        const profilesConfigFilePath = profilesConfigFile?.getPaths().server;
        const locationItems = [
          { label: `Local`, description: `Stored on this PC (for your use only)`, detail: localConfigFilePath, iconPath: new ThemeIcon(`person`) },
          { label: `Server`, description: `Stored on IBM i (to be used amongst your team)`, detail: profilesConfigFilePath, iconPath: new ThemeIcon(`vm`) }
        ];
        const type = await vscode.window.showQuickPick(locationItems, {
          title: `Select what type of profile this is`,
          placeHolder: `Profile type`
        });
        if (!type) {
          return;
        }
        const isServerProfile = type.label === `Local` ? false : true;

        const homeDirectory = connection?.getConfig().homeDirectory || `/home/${connection?.currentUser || 'QPGMR'}`; //QPGMR case should not happen, but better be safe here
        let profile: AnyConnectionProfile;
        if (from) {
          // Copy existing profile
          const { homeDirectory, ...clone } = cloneProfile(from, name);
          profile = isServerProfile ? {
            ...clone,
            type: `server`,
            state: `In Sync`,
          } : {
            ...clone,
            type: `local`,
            homeDirectory,
          }
        } else {
          // Create new profile
          profile = isServerProfile ? {
            name,
            type: `server`,
            state: `In Sync`,
            libraryList: ["QGPL", "QTEMP"],
            customVariables: [],
            ifsShortcuts: [homeDirectory],
            objectFilters: [],
          } : {
            name,
            type: `local`,
            homeDirectory,
            libraryList: ["QGPL", "QTEMP"],
            customVariables: [],
            ifsShortcuts: [homeDirectory],
            objectFilters: [],
          };
        }

        if (!await saveProfile(profile)) {
          return;
        }

        // Do an explicit refresh as creation / copy of a profile doesn't impact the active profile so onCodeForIBMiConfigurationChange is not called
        environmentView.refresh(environmentView.profilesNode);

        if (!from) {
          vscode.commands.executeCommand("code-for-ibmi.environment.profile.edit", profile);
        } else {
          vscode.window.showInformationMessage(l10n.t("Created {0} profile '{1}'.", isServerProfile ? l10n.t("server") : l10n.t("local"), profile.name), l10n.t("Activate profile {0}", profile.name))
            .then(doSwitch => {
              if (doSwitch) {
                vscode.commands.executeCommand("code-for-ibmi.environment.profile.activate", profile);
              }
            })
        }
      });
    }),
    vscode.commands.registerCommand("code-for-ibmi.environment.profile.fromCurrent", async (profilesNode: ProfilesNode) => {
      const config = instance.getConnection()?.getConfig();

      if (config) {
        const current = cloneProfile(config, "");
        vscode.commands.executeCommand("code-for-ibmi.environment.profile.create", undefined, current);
      }
    }),
    vscode.commands.registerCommand("code-for-ibmi.environment.profile.edit", async (profile: AnyConnectionProfile) => {
      editConnectionProfile(profile, async () => environmentView.refresh(environmentView.profilesNode))
    }),
    vscode.commands.registerCommand("code-for-ibmi.environment.profile.rename", async (item: ProfileItem) => {
      await vscode.window.withProgress({ location: { viewId: `environmentView` } }, async (progress) => {
        if (isProfileEdited(item.profile)) {
          vscode.window.showWarningMessage(l10n.t("{0} profile {1} is being edited. Please close its editor first.", item.profile.type === `server` ? l10n.t("Server") : l10n.t("Local"), item.profile.name));
        }
        else {
          const currentName = item.profile.name;
          const currentType = item.profile.type;
          const existingNames = (await getAllConnectionProfiles()).map(profile => profile.name).filter(name => name !== currentName);
          const newName = await vscode.window.showInputBox({
            title: l10n.t('Enter {0} profile {1} new name', item.profile.type === `server` ? l10n.t("server") : l10n.t("local"), item.profile.name),
            placeHolder: l10n.t("Profile name..."),
            validateInput: name => ConnectionProfiles.validateName(name, existingNames)
          });

          if (newName) {
            const canProceed = await verifyLatestServerProfileState(item.profile);
            if (canProceed) {
              if (!await saveProfile(item.profile, { newName })) {
                return;
              }
              const config = instance.getConnection()?.getConfig();
              if (config?.currentProfile === newName && config?.currentProfileType === currentType) {
                updateUIContext(newName);
              }
              environmentView.refresh(environmentView.profilesNode);
            }
          }
        }
      });
    }),
    vscode.commands.registerCommand("code-for-ibmi.environment.profile.copy", async (item: ProfileItem) => {
      vscode.commands.executeCommand("code-for-ibmi.environment.profile.create", undefined, item.profile);
    }),
    vscode.commands.registerCommand("code-for-ibmi.environment.profile.delete", async (item: ProfileItem) => {
      await vscode.window.withProgress({ location: { viewId: `environmentView` } }, async (progress) => {
        if (isProfileEdited(item.profile)) {
          vscode.window.showWarningMessage(l10n.t("{0} profile {1} is being edited. Please close its editor first.", item.profile.type === `server` ? l10n.t("Server") : l10n.t("Local"), item.profile.name));
        }
        else if (await vscode.window.showInformationMessage(l10n.t("Do you really want to delete {0} profile '{1}' ?", item.profile.type === `server` ? l10n.t("server") : l10n.t("local"), item.profile.name), { modal: true }, l10n.t("Yes"))) {
          const canProceed = await verifyLatestServerProfileState(item.profile);
          if (canProceed) {
            if (!await saveProfile(item.profile, { delete: true })) {
              return;
            }

            // Do an explicit refresh as creation / copy of a profile doesn't impact the active profile so onCodeForIBMiConfigurationChange is not called
            environmentView.refresh(environmentView.profilesNode);
          }
        }
      });
    }),
    vscode.commands.registerCommand("code-for-ibmi.environment.profile.activate", async (item: ProfileItem | AnyConnectionProfile) => {
      await vscode.window.withProgress({ location: { viewId: `environmentView` } }, async (progress) => {
        const connection = instance.getConnection();
        const storage = instance.getStorage();
        if (connection && storage) {
          const profile = "profile" in item ? item.profile : item;
          const config = connection.getConfig();
          const profileToBackup = config.currentProfile ?
            await getConnectionProfile(config.currentProfile, config.currentProfileType || 'local') :
            getDefaultProfile(config);

          if (isProfileEdited(profile)) {
            vscode.window.showWarningMessage(l10n.t("{0} profile {1} is being edited. Please close its editor before activating it.", profile.type === `server` ? l10n.t("Server") : l10n.t("Local"), profile.name));
            return;
          } else if (profileToBackup && isProfileEdited(profileToBackup)) {
            vscode.window.showWarningMessage(l10n.t("{0} profile {1} is being edited. Please close its editor before unloading it.", profileToBackup.type === `server` ? l10n.t("Server") : l10n.t("Local"), profileToBackup.name));
            return;
          }

          // Back up previous profile
          if (profileToBackup) {
            const canProceed = await verifyLatestServerProfileState(profileToBackup, { ensureInSync: true });
            if (!canProceed) {
              return;
            }
            assignProfile(config, profileToBackup);
          }

          // Activate new profile
          assignProfile(profile, config);
          config.currentProfile = profile.name || undefined;
          config.currentProfileType = profile.type;
          config.currentProfileLastKnownHash = profile.type === 'server' ? profile.loadedHash : undefined;

          // A server profile is in sync when it gets unloaded: there is nothing to write back to the server
          if (profileToBackup?.type === 'local') {
            await updateConnectionProfile(profileToBackup, { modifiedConfig: config });
          } else {
            await IBMi.connectionManager.update(config);
          }

          await connection.setCurrentASP(profile.iasp);

          await Promise.all([
            vscode.commands.executeCommand(`code-for-ibmi.refreshLibraryListView`),
            vscode.commands.executeCommand(`code-for-ibmi.refreshIFSBrowser`),
            vscode.commands.executeCommand(`code-for-ibmi.refreshObjectBrowser`)
          ]);
          environmentView.refresh();

          if (profile.name && profile.setLibraryListCommand) {
            await vscode.commands.executeCommand("code-for-ibmi.environment.profile.runLiblistCommand", profile);
          }

          await updateUIContext(profile.name);
          vscode.window.showInformationMessage(config.currentProfile ? l10n.t(`Switched to {0} profile "{1}".`, profile.type === `server` ? l10n.t("server") : l10n.t("local"), profile.name) : l10n.t("Active profile unloaded"));
        }
      });
    }),

    vscode.commands.registerCommand("code-for-ibmi.environment.profile.runLiblistCommand", async (profileItem?: ProfileItem | AnyConnectionProfile) => {
      const connection = instance.getConnection();
      const storage = instance.getStorage();
      if (connection && storage) {
        const config = connection.getConfig();
        const profile = profileItem ?
          ("profile" in profileItem ? profileItem.profile : profileItem) :
          (config.currentProfile ? await getConnectionProfile(config.currentProfile, config.currentProfileType || 'local') : undefined);

        if (profile?.setLibraryListCommand) {
          const command = profile.setLibraryListCommand.startsWith(`?`) ?
            await vscode.window.showInputBox({ title: l10n.t(`Run Library List Command`), value: profile.setLibraryListCommand.substring(1) }) :
            profile.setLibraryListCommand;

          if (command) {
            return await vscode.window.withProgress({ title: l10n.t("Running {0} profile's Library List Command...", profile.name), location: vscode.ProgressLocation.Notification }, async () => {
              try {

                const newSettings = await connection.getContent().getLibraryListFromCommand(command);

                if (newSettings) {
                  config.libraryList = newSettings.libraryList;
                  config.currentLibrary = newSettings.currentLibrary;

                  await IBMi.connectionManager.update(config);
                  vscode.commands.executeCommand(`code-for-ibmi.refreshLibraryListView`);

                  // Server profiles are shared: only local profiles are updated with the result of the command
                  if (profile.type === `local`) {
                    profile.libraryList = newSettings.libraryList;
                    profile.currentLibrary = newSettings.currentLibrary;
                    await updateConnectionProfile(profile);
                  }
                  environmentView.refresh(environmentView.profilesNode);
                } else {
                  vscode.window.showWarningMessage(l10n.t(`Failed to get library list from command. Feature not installed; try to reload settings when connecting.`));
                }
              } catch (e: any) {
                vscode.window.showErrorMessage(l10n.t(`Failed to get library list from command: {0}`, e.message));
              }
            });
          }
        }
      }
    }),
    vscode.commands.registerCommand("code-for-ibmi.environment.profile.unload", async (item: ProfileItem) => {
      const connection = instance.getConnection();
      if (connection) {
        const canProceed = await verifyLatestServerProfileState(item.profile, { ensureInSync: true });
        if (canProceed) {
          const config = connection.getConfig();
          vscode.commands.executeCommand("code-for-ibmi.environment.profile.activate", getDefaultProfile(config));
        }
      }
    }),
    vscode.commands.registerCommand("code-for-ibmi.resolveProfile.saveChangeToServer", async (item: ProfileItem, overwrite: boolean = false) => {
      await vscode.window.withProgress({ location: { viewId: `environmentView` } }, async (progress) => {
        const connection = instance.getConnection();
        if (connection) {
          const canProceed = await verifyLatestServerProfileState(item.profile);
          if (canProceed) {
            const config = connection.getConfig();
            const profile = item.profile;
            assignProfile(config, profile);
            if (await saveProfile(profile)) {
              if (overwrite) {
                vscode.window.showInformationMessage(l10n.t("Overwrote server profile '{0}' with local changes.", item.profile.name));
              } else {
                vscode.window.showInformationMessage(l10n.t("Saved changes to server profile '{0}'.", item.profile.name));
              }
              environmentView.refresh(environmentView.profilesNode);
            }
          }
        }
      });
    }),
    vscode.commands.registerCommand("code-for-ibmi.resolveProfile.discardChangesAndSyncWithServer", async (item: ProfileItem) => {
      await vscode.window.withProgress({ location: { viewId: `environmentView` } }, async (progress) => {
        const connection = instance.getConnection();
        if (connection) {
          const canProceed = await verifyLatestServerProfileState(item.profile);
          if (canProceed) {
            // The server profiles were just reloaded: sync with what is on the server now, not with what the tree showed
            const profile = await getConnectionProfile(item.profile.name, 'server');
            if (profile?.type !== 'server' || !profile.loadedHash) {
              vscode.window.showErrorMessage(l10n.t("Server profile {0} no longer exists on the server.", item.profile.name));
              return;
            }

            const config = connection.getConfig();
            assignProfile(profile, config);
            config.currentProfileLastKnownHash = profile.loadedHash;

            await IBMi.connectionManager.update(config);

            await Promise.all([
              vscode.commands.executeCommand(`code-for-ibmi.refreshLibraryListView`),
              vscode.commands.executeCommand(`code-for-ibmi.refreshIFSBrowser`),
              vscode.commands.executeCommand(`code-for-ibmi.refreshObjectBrowser`)
            ]);

            vscode.window.showInformationMessage(l10n.t("Discarded local changes and synced with server profile '{0}'.", item.profile.name));
          }
        }
      });
    }),
    vscode.commands.registerCommand("code-for-ibmi.resolveProfile.overwriteChangesToServer", async (item: ProfileItem) => {
      vscode.commands.executeCommand("code-for-ibmi.resolveProfile.saveChangeToServer", item, true);
    }),

    onCodeForIBMiConfigurationChange("connectionSettings", async () => {
      const connection = instance.getConnection();
      if (connection) {
        environmentView.refresh();
      }
    })
  );
}

type SaveProfileOptions = Parameters<typeof updateConnectionProfile>[1];

/**
 * Saves a profile; if it was changed on the server by someone else in the meantime, the user decides whether to overwrite those changes.
 * @param onReload what to do if the user rather gets the latest changes; refreshes the server profiles by default
 * @returns `true` if the profile was saved
 * @throws any error other than a {@link ProfileConflictError}
 */
export async function saveConnectionProfile(profile: AnyConnectionProfile, options?: SaveProfileOptions, onReload?: () => Promise<void>): Promise<boolean> {
  try {
    await updateConnectionProfile(profile, options);
    return true;
  } catch (error: any) {
    if (!(error instanceof ProfileConflictError)) {
      throw error;
    }

    const overwrite = l10n.t("Overwrite");
    const reload = l10n.t("Reload");
    const choice = await window.showWarningMessage(error.message, { modal: true, detail: l10n.t("Reload the server profiles to get the latest changes, or overwrite them with yours.") }, overwrite, reload);
    if (choice === overwrite) {
      return saveConnectionProfile(profile, { ...options, force: true }, onReload);
    } else if (choice === reload) {
      if (onReload) {
        await onReload();
      } else {
        await vscode.commands.executeCommand("code-for-ibmi.environment.refresh");
      }
    }

    return false;
  }
}

export async function verifyLatestServerProfileState(profile: AnyConnectionProfile, options: { ensureInSync: boolean } = { ensureInSync: false }): Promise<boolean> {
  if (profile.type === `server`) {
    const isActive = isActiveProfile(profile);
    if (isActive) {
      // Get current profile state
      const currentState: ProfileState = profile.state;

      // Reload server profiles in case another user changed them before the last fetch
      await vscode.commands.executeCommand("code-for-ibmi.environment.refresh");

      // Get updated profile state
      let updatedState: ProfileState;
      const updatedServerProfile = await getConnectionProfile(profile.name, profile.type);
      if (updatedServerProfile) {
        updatedState = (updatedServerProfile as ServerConnectionProfile).state;
      } else {
        updatedState = "Out of Sync";
      }

      if (currentState !== updatedState) {
        window.showErrorMessage(l10n.t("Server Profile {0} state changed to \"{1}\" after fetching the latest server profiles. Please try again.", profile.name, updatedState));
        return false;
      }

      if (options.ensureInSync) {
        if (updatedState === `Modified`) {
          window.showErrorMessage(l10n.t("Server Profile {0} has been modified. Resolve this before proceeding.", profile.name, updatedState));
          return false;
        } else if (updatedState === `Out of Sync`) {
          window.showErrorMessage(l10n.t("Server Profile {0} is out of sync. Resolve this before proceeding.", profile.name, updatedState));
          return false;
        }
      }
    }
  }

  return true;
}

class EnvironmentView implements vscode.TreeDataProvider<BrowserItem> {
  private readonly emitter = new vscode.EventEmitter<BrowserItem | BrowserItem[] | undefined | null | void>();
  readonly onDidChangeTreeData = this.emitter.event;
  readonly connectionNode = new ConnectionNode();
  readonly actionsNode = new ActionsNode();
  readonly profilesNode = new ProfilesNode();

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
      this.connectionNode.updateFromConnection();
      return [
        this.connectionNode,
        this.actionsNode,
        new CustomVariablesNode(),
        this.profilesNode
      ];
    }
  }
}