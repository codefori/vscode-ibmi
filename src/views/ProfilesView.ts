
import vscode from 'vscode';
import { ConnectionConfiguration } from '../api/Configuration';

import { instance } from '../instantiate';

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
            prompt: `Name of profile`
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

            vscode.window.showInformationMessage(`Saved current settings to profile ${savedProfileName}.`);
          }
        }
      }),

      vscode.commands.registerCommand(`code-for-ibmi.deleteConnectionProfile`, async (profileNode?: Profile) => {
        const config = instance.getConfig();
        if (config) {
          const currentProfiles = config.connectionProfiles;
          const chosenProfile = await getOrPickAvailableProfile(currentProfiles, profileNode);
          if (chosenProfile) {
            vscode.window.showWarningMessage(`Are you sure you want to delete the ${chosenProfile.name} profile?`, `Yes`, `No`).then(async result => {
              if (result === `Yes`) {
                currentProfiles.splice(currentProfiles.findIndex(profile => profile === chosenProfile), 1);
                config.connectionProfiles = currentProfiles;
                await ConnectionConfiguration.update(config)
                this.refresh();
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

            vscode.window.showInformationMessage(`Switched to ${chosenProfile.name}.`);
            this.refresh();
          }
        }
      })
    )
  }

  refresh() {
    const config = instance.getConfig();
    if (config) {
      vscode.commands.executeCommand(`setContext`, `code-for-ibmi:hasProfiles`, config.connectionProfiles.length > 0);
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
        return config.connectionProfiles
          .map(profile => profile.name)
          .map(name => new ProfileItem(name, name === currentProfile))
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
