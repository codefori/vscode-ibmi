
import vscode, { l10n, window } from 'vscode';
import { ConnectionConfiguration } from '../api/Configuration';
import { GetNewLibl } from '../components/getNewLibl';
import { instance } from '../instantiate';
import { Profile } from '../typings';
import { CommandProfile } from '../webviews/commandProfile';

export class ProfilesView {
  private _onDidChangeTreeData = new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(context: vscode.ExtensionContext) {
    context.subscriptions.push(
      vscode.commands.registerCommand(`code-for-ibmi.refreshProfileView`, async () => {
        this.refresh();
      }),

      vscode.commands.registerCommand(`code-for-ibmi.newConnectionProfile`, () => {
        // Call it with no profile parameter
        vscode.commands.executeCommand(`code-for-ibmi.saveConnectionProfile`);
      }),

      vscode.commands.registerCommand(`code-for-ibmi.saveConnectionProfile`, async (profileNode?: Profile) => {
        const config = instance.getConfig();
        const storage = instance.getStorage();
        if (config && storage) {
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
              ConnectionConfiguration.update(config),
              storage.setLastProfile(savedProfileName)
            ]);
            this.refresh();

            vscode.window.showInformationMessage(l10n.t(`Saved current settings to profile "{0}".`, savedProfileName));
          }
        }
      }),

      vscode.commands.registerCommand(`code-for-ibmi.deleteConnectionProfile`, async (profileNode?: Profile) => {
        const config = instance.getConfig();
        if (config) {
          const currentProfiles = config.connectionProfiles;
          const chosenProfile = await getOrPickAvailableProfile(currentProfiles, profileNode);
          if (chosenProfile) {
            vscode.window.showWarningMessage(l10n.t(`Are you sure you want to delete the "{0}" profile?`, chosenProfile.name), l10n.t("Yes")).then(async result => {
              if (result === l10n.t(`Yes`)) {
                currentProfiles.splice(currentProfiles.findIndex(profile => profile === chosenProfile), 1);
                config.connectionProfiles = currentProfiles;
                await ConnectionConfiguration.update(config)
                this.refresh();
                // TODO: Add message about deleted profile!
              }
            })
          }
        }
      }),

      vscode.commands.registerCommand(`code-for-ibmi.loadConnectionProfile`, async (profileNode?: Profile) => {
        const config = instance.getConfig();
        const storage = instance.getStorage();
        if (config && storage) {
          const chosenProfile = await getOrPickAvailableProfile(config.connectionProfiles, profileNode);
          if (chosenProfile) {
            assignProfile(chosenProfile, config);
            await ConnectionConfiguration.update(config);

            await Promise.all([
              vscode.commands.executeCommand(`code-for-ibmi.refreshLibraryListView`),
              vscode.commands.executeCommand(`code-for-ibmi.refreshIFSBrowser`),
              vscode.commands.executeCommand(`code-for-ibmi.refreshObjectBrowser`),
              storage.setLastProfile(chosenProfile.name)
            ]);

            vscode.window.showInformationMessage(l10n.t(`Switched to profile "{0}".`, chosenProfile.name));
            this.refresh();
          }
        }
      }),

      vscode.commands.registerCommand(`code-for-ibmi.manageCommandProfile`, async (commandProfile?: CommandProfileItem) => {
        CommandProfile.show(commandProfile ? commandProfile.profile : undefined);
      }),

      vscode.commands.registerCommand(`code-for-ibmi.deleteCommandProfile`, async (commandProfile?: CommandProfileItem) => {
        const config = instance.getConfig();
        if (config && commandProfile) {
          const storedProfile = config.commandProfiles.findIndex(profile => profile.name === commandProfile.profile);
          if (storedProfile !== undefined) {
            config.commandProfiles.splice(storedProfile, 1);
            await ConnectionConfiguration.update(config);
            // TODO: Add message about deleting!
            this.refresh();
          }
        }
      }),

      vscode.commands.registerCommand(`code-for-ibmi.loadCommandProfile`, async (commandProfile?: CommandProfileItem) => {
        const connection = instance.getConnection();
        const config = instance.getConfig();
        const storage = instance.getStorage();
        if (commandProfile && config && storage) {
          const storedProfile = config.commandProfiles.find(profile => profile.name === commandProfile.profile);

          if (storedProfile) {
            try {
              const component = connection?.getComponent<GetNewLibl>(GetNewLibl)
              const newSettings = await component?.getLibraryListFromCommand(storedProfile.command);

              if (newSettings) {
                config.libraryList = newSettings.libraryList;
                config.currentLibrary = newSettings.currentLibrary;
                await ConnectionConfiguration.update(config);

                await Promise.all([
                  storage.setLastProfile(storedProfile.name),
                  vscode.commands.executeCommand(`code-for-ibmi.refreshLibraryListView`),
                ]);

                vscode.window.showInformationMessage(l10n.t(`Switched to profile "{0}".`, storedProfile.name));
                this.refresh();
              } else {
                window.showWarningMessage(l10n.t(`Failed to get library list from command. Feature not installed.`));
              }

            } catch (e: any) {
              window.showErrorMessage(l10n.t(`Failed to get library list from command: {0}`, e.message));
            }
          }
        }
      }),

      vscode.commands.registerCommand(`code-for-ibmi.setToDefault`, () => {
        const connection = instance.getConnection();
        const config = instance.getConfig();
        const storage = instance.getStorage();

        if (config && storage) {
          window.showInformationMessage(l10n.t(`Reset to default`), {
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

              await ConnectionConfiguration.update(config);

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

  refresh() {
    const config = instance.getConfig();
    if (config) {
      vscode.commands.executeCommand(`setContext`, `code-for-ibmi:hasProfiles`, config.connectionProfiles.length > 0 || config.commandProfiles.length > 0);
      this._onDidChangeTreeData.fire(null);
    }
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(): Promise<vscode.TreeItem[]> {
    const connection = instance.getConnection();

    if (connection) {
      const config = instance.getConfig();
      const storage = instance.getStorage();
      if (config && storage) {
        const currentProfile = storage.getLastProfile();
        return [
          new ResetProfileItem(),
          ...config.connectionProfiles
            .map(profile => profile.name)
            .map(name => new ProfileItem(name, name === currentProfile)),
          ...config.commandProfiles
            .map(profile => profile.name)
            .map(name => new CommandProfileItem(name, name === currentProfile)),
        ]
      }
    }

    return [];
  }
}

async function getOrPickAvailableProfile(availableProfiles: ConnectionConfiguration.ConnectionProfile[], profileNode?: Profile): Promise<ConnectionConfiguration.ConnectionProfile | undefined> {
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

function assignProfile(fromProfile: ConnectionConfiguration.ConnectionProfile, toProfile: ConnectionConfiguration.ConnectionProfile) {
  toProfile.homeDirectory = fromProfile.homeDirectory;
  toProfile.currentLibrary = fromProfile.currentLibrary;
  toProfile.libraryList = fromProfile.libraryList;
  toProfile.objectFilters = fromProfile.objectFilters;
  toProfile.ifsShortcuts = fromProfile.ifsShortcuts;
  toProfile.customVariables = fromProfile.customVariables;
}

function cloneProfile(fromProfile: ConnectionConfiguration.ConnectionProfile, newName: string): ConnectionConfiguration.ConnectionProfile {
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

class ProfileItem extends vscode.TreeItem implements Profile {
  readonly profile;
  constructor(name: string, active: boolean) {
    super(name, vscode.TreeItemCollapsibleState.None);

    this.contextValue = `profile`;
    this.iconPath = new vscode.ThemeIcon(active ? `layers-active` : `layers`);
    this.description = active ? `Active` : ``;
    this.tooltip = ``;

    this.profile = name;
  }
}

class CommandProfileItem extends vscode.TreeItem implements Profile {
  readonly profile;
  constructor(name: string, active: boolean) {
    super(name, vscode.TreeItemCollapsibleState.None);

    this.contextValue = `commandProfile`;
    this.iconPath = new vscode.ThemeIcon(active ? `layers-active` : `console`);
    this.description = active ? `Active` : ``;
    this.tooltip = ``;

    this.profile = name;
  }
}

class ResetProfileItem extends vscode.TreeItem implements Profile {
  readonly profile;
  constructor() {
    super(`Reset to Default`, vscode.TreeItemCollapsibleState.None);

    this.contextValue = `resetProfile`;
    this.iconPath = new vscode.ThemeIcon(`debug-restart`);
    this.tooltip = ``;

    this.profile = `Default`;
  }
}
