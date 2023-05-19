import vscode from "vscode";
import { GlobalConfiguration, ConnectionConfiguration } from "../api/Configuration";
import { instance } from "../instantiate";
import { Library } from "../typings";

export class LibraryListProvider implements vscode.TreeDataProvider<LibraryNode>{
  private readonly _emitter: vscode.EventEmitter<LibraryNode | undefined | null | void> = new vscode.EventEmitter();
  readonly onDidChangeTreeData: vscode.Event<LibraryNode | undefined | null | void> = this._emitter.event;;

  constructor(context: vscode.ExtensionContext) {
    context.subscriptions.push(
      vscode.commands.registerCommand(`code-for-ibmi.refreshLibraryListView`, async () => {
        this.refresh();
      }),

      vscode.commands.registerCommand(`code-for-ibmi.changeCurrentLibrary`, async () => {
        const connection = instance.getConnection();
        const config = instance.getConfig();
        const storage = instance.getStorage();
        if (connection && storage && config) {
          const currentLibrary = config.currentLibrary.toUpperCase();
          let prevCurLibs = storage.getPreviousCurLibs();
          let list = [...prevCurLibs];
          const listHeader = [
            { label: `Currently active`, kind: vscode.QuickPickItemKind.Separator },
            { label: currentLibrary },
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
              quickPick.items = [{ label: quickPick.value.toUpperCase() }].concat(listHeader)
                .concat(list.map(lib => ({ label: lib })))
            }
          })

          quickPick.onDidAccept(async () => {
            const newLibrary = quickPick.selectedItems[0].label;
            if (newLibrary) {
              if (newLibrary === clearList) {
                await storage.setPreviousCurLibs([]);
                list = [];
                quickPick.items = list.map(lib => ({ label: lib }));
                vscode.window.showInformationMessage(`Cleared list.`);
                quickPick.show();
              } else {
                if (newLibrary !== currentLibrary) {
                  let newLibraryOK = true;
                  try {
                    await connection.runCommand({ command: `CHGCURLIB ${newLibrary}` });
                  } catch (e) {
                    vscode.window.showErrorMessage(String(e));
                    newLibraryOK = false;
                  }
                  if (newLibraryOK) {
                    quickPick.hide();
                    config.currentLibrary = newLibrary;
                    vscode.window.showInformationMessage(`Changed current library to ${newLibrary}.`);
                    prevCurLibs = prevCurLibs.filter(lib => lib !== newLibrary);
                    prevCurLibs.splice(0, 0, currentLibrary);
                    await storage.setPreviousCurLibs(prevCurLibs);
                    await this.updateConfig(config);
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
        }
      }),

      vscode.commands.registerCommand(`code-for-ibmi.changeUserLibraryList`, async () => {
        const connection = instance.getConnection();
        const content = instance.getContent();
        const config = instance.getConfig();
        if (connection && content && config) {
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
              const badLibs = await content.validateLibraryList(newLibraryList);

              if (badLibs.length > 0) {
                newLibraryList = newLibraryList.filter(lib => !badLibs.includes(lib));
                vscode.window.showWarningMessage(`The following libraries were removed from the updated library list as they are invalid: ${badLibs.join(`, `)}`);
              }
            }

            config.libraryList = newLibraryList;
            await this.updateConfig(config);
          }
        }
      }),

      vscode.commands.registerCommand(`code-for-ibmi.addToLibraryList`, async (newLibrary = ``) => {
        const content = instance.getContent();
        const config = instance.getConfig();
        if (content && config) {
          let addingLib;
          let libraryList = [...config.libraryList];

          if (typeof newLibrary !== `string` || newLibrary == ``) {
            addingLib = await vscode.window.showInputBox({
              prompt: `Library to add`
            });
          } else {
            addingLib = newLibrary;
          }

          if (addingLib) {
            if (addingLib.length <= 10) {
              libraryList.push(addingLib.toUpperCase());
              const badLibs = await content.validateLibraryList(libraryList);

              if (badLibs.length > 0) {
                libraryList = libraryList.filter(lib => !badLibs.includes(lib));
                vscode.window.showWarningMessage(`The following libraries were removed from the updated library list as they are invalid: ${badLibs.join(`, `)}`);
              }

              config.libraryList = libraryList;
              await this.updateConfig(config);
            } else {
              vscode.window.showErrorMessage(`Library is too long.`);
            }
          }
        }
      }),

      vscode.commands.registerCommand(`code-for-ibmi.removeFromLibraryList`, async (node: LibraryNode) => {
        if (node) {
          //Running from right click
          const config = instance.getConfig();
          if (config) {
            let libraryList = config.libraryList;

            let index = libraryList.findIndex(file => file.toUpperCase() === node.path)
            if (index >= 0) {
              libraryList.splice(index, 1);

              config.libraryList = libraryList;
              await this.updateConfig(config);
            }
          }
        }
      }),

      vscode.commands.registerCommand(`code-for-ibmi.moveLibraryUp`, async (node: LibraryNode) => {
        if (node) {
          //Running from right click
          const config = instance.getConfig();
          if (config) {
            const libraryList = config.libraryList;

            const index = libraryList.findIndex(file => file.toUpperCase() === node.path);
            if (index >= 0 && (index - 1) >= 0) {
              const library = libraryList[index];
              libraryList.splice(index, 1);
              libraryList.splice(index - 1, 0, library);

              config.libraryList = libraryList;
              await this.updateConfig(config);
            }
          }
        }
      }),

      vscode.commands.registerCommand(`code-for-ibmi.moveLibraryDown`, async (node: LibraryNode) => {
        if (node) {
          //Running from right click
          const config = instance.getConfig();
          if (config) {
            const libraryList = config.libraryList;
            const index = libraryList.findIndex(file => file.toUpperCase() === node.path);
            if (index >= 0 && (index + 1) >= 0) {
              const library = libraryList[index];
              libraryList.splice(index, 1);
              libraryList.splice(index + 1, 0, library);

              config.libraryList = libraryList;
              await this.updateConfig(config);
            }
          }
        }
      }),

      vscode.commands.registerCommand(`code-for-ibmi.cleanupLibraryList`, async () => {
        const content = instance.getContent();
        const config = instance.getConfig();
        if (config && content) {
          let libraryList = [...config.libraryList];
          const badLibs = await content.validateLibraryList(libraryList);

          if (badLibs.length > 0) {
            libraryList = libraryList.filter(lib => !badLibs.includes(lib));
            vscode.window.showWarningMessage(`The following libraries were removed from the updated library list as they are invalid: ${badLibs.join(`, `)}`);
            config.libraryList = libraryList;            
            await this.updateConfig(config);
          } else {
            vscode.window.showInformationMessage(`Library list were validated without any errors.`);
          }
        }
      }),
    )
    instance.onEvent(`connected`, () => this.refresh());
  }

  private async updateConfig(config: ConnectionConfiguration.Parameters){
    await ConnectionConfiguration.update(config);
    if (GlobalConfiguration.get(`autoRefresh`)) {
      this.refresh();
    }
  }

  refresh(element?: LibraryNode) {
    this._emitter.fire(element);
  }

  getTreeItem(element: LibraryNode): vscode.TreeItem {
    return element;
  }

  async getChildren(): Promise<LibraryNode[]> {
    const items = [];
    const connection = instance.getConnection();
    if (connection) {
      const content = instance.getContent();
      const config = instance.getConfig();
      if (content && config) {
        const currentLibrary = config.currentLibrary.toUpperCase();

        const libraries = [];
        if (config.showDescInLibList === true) {
          libraries.push(...await content.getLibraryList([currentLibrary, ...config.libraryList]));
        } else {
          libraries.push(...[currentLibrary, ...config.libraryList].map(lib => { return { name: lib, text: ``, attribute: `` } }));
        }
        items.push(...libraries.map((lib, index) => {
          return new LibraryNode(lib.name.toUpperCase(), lib.text, lib.attribute, (index === 0 ? `currentLibrary` : `library`));
        }));
      }
    }
    return items;
  }
}

class LibraryNode extends vscode.TreeItem implements Library {
  constructor(readonly path: string, text: string = ``, attribute: string = ``, context: 'currentLibrary' | 'library' = `library`) {
    super(path, vscode.TreeItemCollapsibleState.None);

    this.contextValue = context;
    this.description = (context === `currentLibrary` ? `(current library) ${text}` : `${text}`) + (attribute !== `` ? ` (*${attribute})` : ``);
  }
}