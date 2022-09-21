
const vscode = require(`vscode`);

let {instance} = require(`../Instance`);
const Configuration = require(`../api/Configuration`);

module.exports = class libraryListProvider {
  /**
   * @param {vscode.ExtensionContext} context
   */
  constructor(context) {
    this.selections = undefined;
    this.emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.emitter.event;

    // used for targeted member list refreshes
    this.targetLib = `*ALL`;
    this.targetSpf = `*ALL`;
    this.refreshCache = {}; // cache entries of format 'LIB/SPF': members[]

    context.subscriptions.push(
      vscode.commands.registerCommand(`code-for-ibmi.refreshLibraryListView`, async () => {
        this.refresh();
      }),

      vscode.commands.registerCommand(`code-for-ibmi.changeCurrentLibrary`, async () => {
        const connection = instance.getConnection();
        const config = instance.getConfig();
        const currentLibrary = config.currentLibrary.toUpperCase();
        let prevCurLibs = Object.values(instance.getStorage().get(`prevCurLibs`));
        let list = [...prevCurLibs];
        const listHeader = [
          { label: `Currently active`, kind: vscode.QuickPickItemKind.Separator },
          { label: currentLibrary},
          { label: `Recently used`, kind: vscode.QuickPickItemKind.Separator }
        ];
        const clearList = `$(trash) Clear list`;
        const clearListArray = [{ label: ``, kind: vscode.QuickPickItemKind.Separator }, { label: clearList }];

        const quickPick = vscode.window.createQuickPick();
        quickPick.items = listHeader.concat(list.map(lib => ({ label: lib }))).concat(clearListArray);
        quickPick.placeholder = `Filter or new library to set as current library`;
        quickPick.title = `Change current library`;

        quickPick.onDidChangeValue(() => {
          if (quickPick.value === ``) {
            quickPick.items = listHeader.concat(list.map(lib => ({ label: lib }))).concat(clearListArray);
          } else if (!list.includes(quickPick.value.toUpperCase())) {
            quickPick.items = [{label: quickPick.value.toUpperCase()}].concat(listHeader)
              .concat(list.map(lib => ({ label : lib })))
          }
        })

        quickPick.onDidAccept( async () => {
          const newLibrary = quickPick.selectedItems[0].label;
          if (newLibrary) {
            if (newLibrary === clearList) {
              await instance.getStorage().set(`prevCurLibs`, {});
              list = [];
              quickPick.items = list.map(lib => ({ label: lib }));
              vscode.window.showInformationMessage(`Cleared list.`);
              quickPick.show();
            } else {
              if (newLibrary !== currentLibrary) {
                let newLibraryOK = true;
                try {
                  await connection.remoteCommand(`CHGCURLIB ${newLibrary}`);
                } catch (e) {
                  vscode.window.showErrorMessage(e);
                  newLibraryOK = false;
                }
                if (newLibraryOK) {
                  quickPick.hide();
                  await config.set(`currentLibrary`, newLibrary);
                  vscode.window.showInformationMessage(`Changed current library to ${newLibrary}.`);
                  prevCurLibs = prevCurLibs.filter(lib => lib !== newLibrary);
                  prevCurLibs.splice(0, 0, currentLibrary);
                  await instance.getStorage().set(`prevCurLibs`, prevCurLibs);
                  if (Configuration.get(`autoRefresh`)) this.refresh();
                }
              } else {
                quickPick.hide();
                vscode.window.showInformationMessage(`${newLibrary} is already current library.`)
              }
            }
          }
        });
        quickPick.onDidHide(() => quickPick.dispose());
        quickPick.show();
      }),

      vscode.commands.registerCommand(`code-for-ibmi.changeUserLibraryList`, async () => {
        const connection = instance.getConnection();
        const config = instance.getConfig();
        const libraryList = config.libraryList;

        const newLibraryListStr = await vscode.window.showInputBox({
          prompt: `Changing library list (can use '*reset')`,
          value: libraryList.map(lib => lib.toUpperCase()).join(`, `)
        });

        if (newLibraryListStr) {

          let newLibraryList = [];

          if (newLibraryListStr.toUpperCase() === `*RESET`) {
            newLibraryList = connection.defaultUserLibraries;
          } else {
            newLibraryList = newLibraryListStr
              .replace(/,/g, ` `)
              .split(` `)
              .map(lib => lib.toUpperCase())
              .filter((lib, idx, libl) => lib && libl.indexOf(lib) === idx);
            const badLibs = await this.validateLibraryList(newLibraryList);

            if (badLibs.length > 0) {
              newLibraryList = newLibraryList.filter(lib => !badLibs.includes(lib));
              vscode.window.showWarningMessage(`The following libraries were removed from the updated library list as they are invalid: ${badLibs.join(`, `)}`);
            }
          }

          await config.set(`libraryList`, newLibraryList);
          if (Configuration.get(`autoRefresh`)) this.refresh();
        }
      }),

      vscode.commands.registerCommand(`code-for-ibmi.addToLibraryList`, async (newLibrary = ``) => {
        const config = instance.getConfig();
        let addingLib;

        let libraryList = [...config.libraryList];

        if(newLibrary == ``){
          addingLib = await vscode.window.showInputBox({
            prompt: `Library to add`
          });
        } else {
          addingLib = newLibrary;
        }

        if (addingLib) {
          if (addingLib.length <= 10) {
            libraryList.push(addingLib.toUpperCase());
            const badLibs = await this.validateLibraryList(libraryList);

            if (badLibs.length > 0) {
              libraryList = libraryList.filter(lib => !badLibs.includes(lib));
              vscode.window.showWarningMessage(`The following libraries were removed from the updated library list as they are invalid: ${badLibs.join(`, `)}`);
            }

            await config.set(`libraryList`, libraryList);
            if (Configuration.get(`autoRefresh`)) this.refresh();
          } else {
            vscode.window.showErrorMessage(`Library is too long.`);
          }
        }
      }),

      vscode.commands.registerCommand(`code-for-ibmi.removeFromLibraryList`, async (node) => {
        if (node) {
          //Running from right click
          const config = instance.getConfig();

          let libraryList = config.libraryList;

          let index = libraryList.findIndex(file => file.toUpperCase() === node.path)
          if (index >= 0) {
            libraryList.splice(index, 1);

            await config.set(`libraryList`, libraryList);
            if (Configuration.get(`autoRefresh`)) this.refresh();
          }
        }
      }),

      vscode.commands.registerCommand(`code-for-ibmi.moveLibraryUp`, async (node) => {
        if (node) {
          //Running from right click
          const config = instance.getConfig();

          let libraryList = config.libraryList;

          let index = libraryList.findIndex(file => file.toUpperCase() === node.path);
          if (index >= 0 && (index - 1) >= 0) {
            const library = libraryList[index];
            libraryList.splice(index, 1);
            libraryList.splice(index-1, 0, library);

            await config.set(`libraryList`, libraryList);
            if (Configuration.get(`autoRefresh`)) this.refresh();
          }

        }
      }),

      vscode.commands.registerCommand(`code-for-ibmi.moveLibraryDown`, async (node) => {
        if (node) {
          //Running from right click
          const config = instance.getConfig();

          let libraryList = config.libraryList;

          let index = libraryList.findIndex(file => file.toUpperCase() === node.path);
          if (index >= 0 && (index + 1) >= 0) {
            const library = libraryList[index];
            libraryList.splice(index, 1);
            libraryList.splice(index+1, 0, library);

            await config.set(`libraryList`, libraryList);
            if (Configuration.get(`autoRefresh`)) this.refresh();
          }

        }
      }),

      vscode.commands.registerCommand(`code-for-ibmi.cleanupLibraryList`, async () => {
        const config = instance.getConfig();
        let libraryList = [...config.libraryList];
        const badLibs = await this.validateLibraryList(libraryList);

        if (badLibs.length > 0) {
          libraryList = libraryList.filter(lib => !badLibs.includes(lib));
          vscode.window.showWarningMessage(`The following libraries were removed from the updated library list as they are invalid: ${badLibs.join(`, `)}`);
          await config.set(`libraryList`, libraryList);
          if (Configuration.get(`autoRefresh`)) this.refresh();
        } else {
          vscode.window.showInformationMessage(`Library list were validated without any errors.`);
        }
      }),
    )
  }

  /**
   * Validates a list of libraries
   * @param {string[]} newLibl
   * @returns {Promise<string[]>} Bad libraries
   */
  async validateLibraryList(newLibl) {
    const connection = await instance.getConnection();

    let badLibs = [];

    newLibl = newLibl.filter(lib => {
      if (lib.match(/^\d/)) {
        badLibs.push(lib);
        return false;
      }

      if (lib.length > 10) {
        badLibs.push(lib);
        return false;
      }

      return true;
    });

    /** @type {object} */
    const result = await connection.sendQsh({
      command: [
        `liblist -d ` + connection.defaultUserLibraries.join(` `).replace(/\$/g, `\\$`),
        ...newLibl.map(lib => `liblist -a ` + lib.replace(/\$/g, `\\$`))
      ]
    });

    if (result.stderr) {
      const lines = result.stderr.split(`\n`);

      lines.forEach(line => {
        const badLib = newLibl.find(lib => line.includes(`ibrary ${lib}`));

        // If there is an error about the library, remove it
        if (badLib) badLibs.push(badLib);
      });
    }

    return badLibs;
  }

  refresh() {
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
    const content = instance.getContent();
    const config = instance.getConfig();
    const currentLibrary = config.currentLibrary.toUpperCase();
    let items = [];
    let libraries = [];

    if (connection) {
      if (config.showDescInLibList === true) {
        libraries = await content.getLibraryList([config.currentLibrary, ...config.libraryList]);
      } else {
        libraries = [config.currentLibrary, ...config.libraryList].map(lib => { return { name: lib, text: ``, attribute: `` }});
      }
      items = libraries.map((lib, index) => {
        return new Library(lib.name, lib.text, lib.attribute, (index === 0 ? `currentLibrary` : `library`));
      });
    }

    return items;
  }
}

class Library extends vscode.TreeItem {
  /**
   * @param {string} library
   * @param {string?} text
   * @param {string?} attribute
   * @param {string?} context
   */
  constructor(library, text = ``, attribute = ``, context = `library`) {
    super(library.toUpperCase(), vscode.TreeItemCollapsibleState.None);

    this.contextValue = context;
    this.path = library;
    this.description = (context === `currentLibrary` ? `(current library) ${text}` : `${text}`) + (attribute !== `` ? ` (*${attribute})` : ``);

  }
}