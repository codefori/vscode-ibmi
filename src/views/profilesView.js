
const vscode = require(`vscode`);

const instance = require(`../Instance`);

const LAST_PROFILE_KEY = `currentProfile`;
const profileProps = [`currentLibrary`, `homeDirectory`, `libraryList`, `objectFilters`, `ifsShortcuts`, `customVariables`, `jobFilters`];

module.exports = class profilesProvider {
  /**
   * @param {vscode.ExtensionContext} context
   */
  constructor(context) {
    this.selections = undefined;
    this.emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.emitter.event;

    context.subscriptions.push(
      vscode.commands.registerCommand(`code-for-ibmi.refreshProfileView`, async () => {
        this.refresh();
      }),

      vscode.commands.registerCommand(`code-for-ibmi.saveConnectionProfile`, async (profileNode) => {
        const config = instance.getConfig();
        const storage = instance.getStorage();

		const currentProfile = storage.get(LAST_PROFILE_KEY);													 
        let currentProfiles = config.connectionProfiles;

        const profileName = profileNode ? profileNode.profile : await vscode.window.showInputBox({
		  value: currentProfile,						
          prompt: `Name of profile`
        });

        if (profileName) {
          const existingIndex = currentProfiles.findIndex(profile => profile.name.toUpperCase() === profileName.toUpperCase());

          if (existingIndex >= 0) {
            for (const prop of profileProps) {
              currentProfiles[existingIndex][prop] = config[prop];
            }
          } else {
            let newProfile = {
              name: profileName,
            };

            for (const prop of profileProps) {
              newProfile[prop] = config[prop];
            }

            //@ts-ignore - no way because newProfile is built dynamically
            currentProfiles.push(newProfile);
          }

          await Promise.all([
            config.set(`connectionProfiles`, currentProfiles),
            storage.set(LAST_PROFILE_KEY, profileName)
          ]);
          this.refresh();

          vscode.window.showInformationMessage(`Saved current settings to ${profileName}.`);
        }
      }),

      vscode.commands.registerCommand(`code-for-ibmi.deleteConnectionProfile`, async (profileNode) => {
        const config = instance.getConfig();

        const currentProfiles = config.connectionProfiles;
        const availableProfiles = currentProfiles.map(profile => profile.name);

        if (availableProfiles.length > 0) {
          const chosenProfile = profileNode ? profileNode.profile : await vscode.window.showQuickPick(availableProfiles);

          if (chosenProfile) {
            const index = currentProfiles.findIndex(profile => profile.name === chosenProfile);

            if (index => 0) {
              vscode.window.showWarningMessage(`Are you sure you want to delete the ${chosenProfile} profile?`, `Yes`, `No`).then(async result => {
                if (result === `Yes`) {
                  currentProfiles.splice(index, 1);
                  await config.set(`connectionProfiles`, currentProfiles);
                  this.refresh();
                }
              })
            }
          }

        } else {
          vscode.window.showInformationMessage(`No profiles exist for this system.`);
        }
      }),

      vscode.commands.registerCommand(`code-for-ibmi.loadConnectionProfile`, async (profileNode) => {
        const config = instance.getConfig();
        const storage = instance.getStorage();

        const currentProfiles = config.connectionProfiles;
        const availableProfiles = currentProfiles.map(profile => profile.name);

        if (availableProfiles.length > 0) {
          const chosenProfile = profileNode ? profileNode.profile : await vscode.window.showQuickPick(availableProfiles);

          if (chosenProfile) {
            let profile = currentProfiles.find(profile => profile.name === chosenProfile);

            if (profile) {
              profile = {...profile}; //We clone it.
              delete profile.name;

              await config.setMany(profile);

              await Promise.all([
                vscode.commands.executeCommand(`code-for-ibmi.refreshLibraryListView`),
                vscode.commands.executeCommand(`code-for-ibmi.refreshIFSBrowser`),
                vscode.commands.executeCommand(`code-for-ibmi.refreshObjectBrowser`),
                vscode.commands.executeCommand(`code-for-ibmi.refreshJobBrowser`),
                storage.set(LAST_PROFILE_KEY, chosenProfile),
              ]);

              vscode.window.showInformationMessage(`Switched to ${chosenProfile}.`);

              this.refresh();
            }
          }

        } else {
          vscode.window.showInformationMessage(`No profiles exist for this system.`);
        }
      })
    )
  }

  refresh() {
    const config = instance.getConfig();
    vscode.commands.executeCommand(`setContext`, `code-for-ibmi:hasProfiles`, config.connectionProfiles.length > 0);
    this.emitter.fire();
  }

  /**
   * @param {vscode.TreeItem} element
   * @returns {vscode.TreeItem};
   */
  getTreeItem(element) {
    return element;
  }

  /**
   * @returns {Promise<vscode.TreeItem[]>};
   */
  async getChildren() {
    const connection = instance.getConnection();
    let items = [];

    if (connection) {
      const config = instance.getConfig();
      const storage = instance.getStorage();

      const currentProfile = storage.get(LAST_PROFILE_KEY);
      const currentProfiles = config.connectionProfiles;
      const availableProfiles = currentProfiles.map(profile => profile.name);

      items = availableProfiles.map(name => new Profile(name, name === currentProfile))
    }

    return items;
  }
}

class Profile extends vscode.TreeItem {
  /**
   * @param {string} name
   * @param {boolean} [active]
   */
  constructor(name, active) {
    super(name, vscode.TreeItemCollapsibleState.None);

    this.contextValue = `profile`;
    this.iconPath = new vscode.ThemeIcon(active ? `layers-active` : `layers`);
    this.description = active ? `Active` : ``;

    this.profile = name;
  }
}