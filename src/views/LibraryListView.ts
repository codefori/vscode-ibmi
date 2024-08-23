import vscode, { commands } from "vscode";
import { ConnectionConfiguration, GlobalConfiguration } from "../api/Configuration";
import { instance } from "../instantiate";
import { t } from "../locale";
import { IBMiObject, WithLibrary } from "../typings";

export class LibraryListProvider implements vscode.TreeDataProvider<LibraryListNode> {
  private readonly _emitter: vscode.EventEmitter<LibraryListNode | undefined | null | void> = new vscode.EventEmitter();
  readonly onDidChangeTreeData: vscode.Event<LibraryListNode | undefined | null | void> = this._emitter.event;;

  constructor(context: vscode.ExtensionContext) {
    context.subscriptions.push(
      vscode.commands.registerCommand(`code-for-ibmi.userLibraryList.enable`, () => {
        commands.executeCommand(`setContext`, `code-for-ibmi:libraryListDisabled`, false);
      }),

      vscode.commands.registerCommand(`code-for-ibmi.refreshLibraryListView`, async () => {
        this.refresh();
      }),

      vscode.commands.registerCommand(`code-for-ibmi.changeCurrentLibrary`, async () => {
        const connection = instance.getConnection();
        const config = instance.getConfig();
        const storage = instance.getStorage();
        if (connection && storage && config) {
          const currentLibrary = connection.upperCaseName(config.currentLibrary);
          let prevCurLibs = storage.getPreviousCurLibs();
          let list = [...prevCurLibs];
          const listHeader = [
            { label: t(`LibraryListView.changeCurrentLibrary.currentlyActive`), kind: vscode.QuickPickItemKind.Separator },
            { label: currentLibrary },
            { label: t(`LibraryListView.changeCurrentLibrary.recentlyUsed`), kind: vscode.QuickPickItemKind.Separator }
          ];
          const clearList = t(`clearList`);
          const clearListArray = [{ label: ``, kind: vscode.QuickPickItemKind.Separator }, { label: clearList }];

          const quickPick = vscode.window.createQuickPick();
          quickPick.items = listHeader.concat(list.map(lib => ({ label: lib }))).concat(clearListArray);
          quickPick.placeholder = t(`LibraryListView.changeCurrentLibrary.placeholder`);
          quickPick.title = t(`LibraryListView.changeCurrentLibrary.title`);

          quickPick.onDidChangeValue(() => {
            if (quickPick.value === ``) {
              quickPick.items = listHeader.concat(list.map(lib => ({ label: lib }))).concat(clearListArray);
            } else if (!list.includes(connection.upperCaseName(quickPick.value))) {
              quickPick.items = [{ label: connection.upperCaseName(quickPick.value) }].concat(listHeader)
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
                vscode.window.showInformationMessage(t(`clearedList`));
                quickPick.show();
              } else {
                if (newLibrary !== currentLibrary) {
                  if (await changeCurrentLibrary(newLibrary)) {
                    this.refresh();
                    quickPick.hide();
                  }
                } else {
                  quickPick.hide();
                  vscode.window.showInformationMessage(t(`LibraryListView.changeCurrentLibrary.alreadyCurrent`, newLibrary))
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
            prompt: t(`LibraryListView.changeUserLibraryList.prompt`),
            value: libraryList.map(lib => connection.upperCaseName(lib)).join(`, `)
          });

          if (newLibraryListStr) {

            let newLibraryList = [];

            if (newLibraryListStr.toUpperCase() === `*RESET`) {
              newLibraryList = connection.defaultUserLibraries;
            } else {
              newLibraryList = newLibraryListStr
                .replace(/,/g, ` `)
                .split(` `)
                .map(lib => connection.upperCaseName(lib))
                .filter((lib, idx, libl) => lib && libl.indexOf(lib) === idx);
              const badLibs = await content.validateLibraryList(newLibraryList);

              if (badLibs.length > 0) {
                newLibraryList = newLibraryList.filter(lib => !badLibs.includes(lib));
                vscode.window.showWarningMessage(t(`LibraryListView.changeUserLibraryList.removedLibs`, badLibs.join(`, `)));
              }
            }

            config.libraryList = newLibraryList;
            await this.updateConfig(config);
          }
        }
      }),

      vscode.commands.registerCommand(`code-for-ibmi.addToLibraryList.prompt`, async () => {
        vscode.commands.executeCommand(`code-for-ibmi.addToLibraryList`, { library: await vscode.window.showInputBox({ prompt: t(`LibraryListView.addToLibraryList.prompt`) }) });
      }),

      vscode.commands.registerCommand(`code-for-ibmi.addToLibraryList`, async (newLibrary: WithLibrary) => {
        const content = instance.getContent();
        const config = instance.getConfig();
        const connection = instance.getConnection();
        if (content && config && connection) {
          const addingLib = connection.upperCaseName(newLibrary.library);

          if (addingLib.length > 10) {
            vscode.window.showErrorMessage(t(`LibraryListView.addToLibraryList.tooLong`));
            return;
          }

          let libraryList = [...config.libraryList];

          if (libraryList.includes(addingLib)) {
            vscode.window.showWarningMessage(t(`LibraryListView.addToLibraryList.alreadyInList`, addingLib));
            return;
          }

          let badLibs = await content.validateLibraryList([addingLib]);

          if (badLibs.length > 0) {
            libraryList = libraryList.filter(lib => !badLibs.includes(lib));
            vscode.window.showWarningMessage(t(`LibraryListView.addToLibraryList.invalidLib`, badLibs.join(`, `)));
          } else {
            libraryList.push(addingLib);
            vscode.window.showInformationMessage(t(`LibraryListView.addToLibraryList.addedLib`, addingLib));
          }

          badLibs = await content.validateLibraryList(libraryList);

          if (badLibs.length > 0) {
            libraryList = libraryList.filter(lib => !badLibs.includes(lib));
            vscode.window.showWarningMessage(t(`LibraryListView.addToLibraryList.removedLibs`, badLibs.join(`, `)));
          }

          config.libraryList = libraryList;
          await this.updateConfig(config);
        }
      }),

      vscode.commands.registerCommand(`code-for-ibmi.removeFromLibraryList`, async (node: LibraryListNode) => {
        if (node) {
          //Running from right click
          const connection = instance.getConnection();
          const config = instance.getConfig();
          if (connection && config) {
            let libraryList = config.libraryList;

            let index = libraryList.findIndex(library => connection.upperCaseName(library) === node.library)
            if (index >= 0) {
              const removedLib = libraryList[index];
              libraryList.splice(index, 1);

              config.libraryList = libraryList;
              await this.updateConfig(config);
              vscode.window.showInformationMessage(t(`LibraryListView.removeFromLibraryList.removedLib`, removedLib));
            }
          }
        }
      }),

      vscode.commands.registerCommand(`code-for-ibmi.moveLibraryUp`, async (node: LibraryListNode) => {
        if (node) {
          //Running from right click
          const config = instance.getConfig();
          const connection = instance.getConnection();
          if (connection && config) {
            const libraryList = config.libraryList;

            const index = libraryList.findIndex(library => connection.upperCaseName(library) === node.library);
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

      vscode.commands.registerCommand(`code-for-ibmi.moveLibraryDown`, async (node: LibraryListNode) => {
        if (node) {
          //Running from right click
          const config = instance.getConfig();
          const connection = instance.getConnection();
          if (connection && config) {
            const libraryList = config.libraryList;
            const index = libraryList.findIndex(library => connection.upperCaseName(library) === node.library);
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
            vscode.window.showWarningMessage(t(`LibraryListView.cleanupLibraryList.removedLibs`, badLibs.join(`, `)));
            config.libraryList = libraryList;
            await this.updateConfig(config);
          } else {
            vscode.window.showInformationMessage(t(`LibraryListView.cleanupLibraryList.validated`));
          }
        }
      }),

      vscode.commands.registerCommand(`code-for-ibmi.setCurrentLibrary`, async (node: WithLibrary) => {
        const library = node.library;
        if (library) {
          const connection = instance.getConnection();
          const content = instance.getContent();
          const config = instance.getConfig();
          const storage = instance.getStorage();
          if (connection && config && content && storage) {
            if (await content.checkObject({ library: "QSYS", name: library, type: "*LIB" })) {
              await changeCurrentLibrary(library);
              this.refresh();
            }
          }
        }
      })
    )
  }

  private async updateConfig(config: ConnectionConfiguration.Parameters) {
    await ConnectionConfiguration.update(config);
    if (GlobalConfiguration.get(`autoRefresh`)) {
      this.refresh();
    }
  }

  refresh(element?: LibraryListNode) {
    this._emitter.fire(element);
  }

  getTreeItem(element: LibraryListNode): vscode.TreeItem {
    return element;
  }

  async getChildren(): Promise<LibraryListNode[]> {
    const items = [];
    const connection = instance.getConnection();
    if (connection) {
      const content = instance.getContent();
      const config = instance.getConfig();
      const connection = instance.getConnection();
      if (connection && content && config) {
        const currentLibrary = connection.upperCaseName(config.currentLibrary);

        const libraries = await content.getLibraryList([currentLibrary, ...config.libraryList]);

        items.push(...libraries.map((lib, index) => {
          return new LibraryListNode(connection.upperCaseName(lib.name), lib, (index === 0 ? `currentLibrary` : `library`), config.showDescInLibList);
        }));
      }
    }
    return items;
  }
}

class LibraryListNode extends vscode.TreeItem implements WithLibrary {
  constructor(readonly library: string, readonly object: IBMiObject, context: 'currentLibrary' | 'library' = `library`, showDescInLibList: boolean) {
    super(library, vscode.TreeItemCollapsibleState.None);

    this.contextValue = context;
    this.description =
      ((context === `currentLibrary` ? `${t(`currentLibrary`)}` : ``)
        + (object.text !== `` && showDescInLibList ? ` ${object.text}` : ``)
        + (object.attribute !== `` ? ` (*${object.attribute})` : ``)).trim();
    this.tooltip = instance.getContent()?.objectToToolTip([object.library, object.name].join(`/`), object);
  }
}

async function changeCurrentLibrary(library: string) {
  const connection = instance.getConnection();
  const config = instance.getConfig();
  const storage = instance.getStorage();
  if (connection && config && storage) {
    const commandResult = await connection.runCommand({ command: `CHGCURLIB ${library}`, noLibList: true });
    if (commandResult.code === 0) {
      const currentLibrary = connection.upperCaseName(config.currentLibrary);
      config.currentLibrary = library;
      vscode.window.showInformationMessage(t(`LibraryListView.changeCurrentLibrary.changedCurrent`, library));
      storage.getPreviousCurLibs();
      const previousCurLibs = storage.getPreviousCurLibs().filter(lib => lib !== library);
      previousCurLibs.splice(0, 0, currentLibrary);
      await storage.setPreviousCurLibs(previousCurLibs);
      await ConnectionConfiguration.update(config);
      return true;
    } else {
      vscode.window.showErrorMessage(t(`LibraryListView.setCurrentLibrary.failed`, library, commandResult.stderr));
      return false;
    }
  }
}