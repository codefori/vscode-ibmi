
import vscode, { window } from 'vscode';
import { Profile } from '../typings';
import { ConnectionConfiguration } from '../api/Configuration';

import { instance } from '../instantiate';
import { CommandProfile } from '../webviews/commandProfile';
import { t } from "../locale";

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
            prompt: t(`ProfilesView.saveConnectionProfile.prompt`)
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

            vscode.window.showInformationMessage(t(`ProfilesView.saveConnectionProfile.infoMessage`, savedProfileName));
          }
        }
      }),

      vscode.commands.registerCommand(`code-for-ibmi.deleteConnectionProfile`, async (profileNode?: Profile) => {
        const config = instance.getConfig();
        if (config) {
          const currentProfiles = config.connectionProfiles;
          const chosenProfile = await getOrPickAvailableProfile(currentProfiles, profileNode);
          if (chosenProfile) {
            vscode.window.showWarningMessage(t(`ProfilesView.deleteConnectionProfile.warningMessage`, chosenProfile.name), t(`Yes`), t(`No`)).then(async result => {
              if (result === t(`Yes`)) {
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

            vscode.window.showInformationMessage(t(`ProfilesView.loadConnectionProfile.infoMessage`, chosenProfile.name));
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
        const content = instance.getContent();
        const config = instance.getConfig();
        const storage = instance.getStorage();
        if (commandProfile && config && storage) {
          const storedProfile = config.commandProfiles.find(profile => profile.name === commandProfile.profile);
          
          if (storedProfile) {
            try {
              const newSettings = await content?.getLibraryListFromCommand(storedProfile.command);

              if (newSettings) {
                config.libraryList = newSettings.libraryList;
                config.currentLibrary = newSettings.currentLibrary;
                await ConnectionConfiguration.update(config);

                await Promise.all([
                  storage.setLastProfile(storedProfile.name),
                  vscode.commands.executeCommand(`code-for-ibmi.refreshLibraryListView`),
                ]);

                vscode.window.showInformationMessage(t(`ProfilesView.loadCommandProfile.infoMessage`, storedProfile.name));
                this.refresh();
              } else {
                window.showWarningMessage(t(`ProfilesView.loadCommandProfile.warningMessage`));
              }

            } catch (e: any) {
              window.showErrorMessage(t(`ProfilesView.loadCommandProfile.errorMessage`, e.message));
            }
          }
        }
      }),

      vscode.commands.registerCommand(`code-for-ibmi.setToDefault`, () => {
        const connection = instance.getConnection();
        const config = instance.getConfig();
        const storage = instance.getStorage();

        if (config && storage) {
          window.showInformationMessage(t(`ProfilesView.setToDefault.infoMessage`), {
            detail: t(`ProfilesView.setToDefault.detail`),
            modal: true
          }, t(`Continue`)).then(async result => {
            if (result === t(`Continue`)) {
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

    this.profile = name;
  }
}

class ResetProfileItem extends vscode.TreeItem implements Profile {
  readonly profile;
  constructor() {
    super(`Reset to Default`, vscode.TreeItemCollapsibleState.None);

    this.contextValue = `resetProfile`;
    this.iconPath = new vscode.ThemeIcon(`debug-restart`);

    this.profile = `Default`;
  }
}
