import path from "path";
import vscode, { commands, l10n } from "vscode";
import IBMi from "../../api/IBMi";
import { instance } from "../../instantiate";
import { ConnectionConfig, IBMiObject, LIBRARY_LIST_MIMETYPE, URI_LIST_MIMETYPE, URI_LIST_SEPARATOR, WithLibrary } from "../../typings";
import { VscodeTools } from "../Tools";

export function initializeLibraryListView(context: vscode.ExtensionContext) {
  const libraryListView = new LibraryListView();
  const libraryListViewViewer = vscode.window.createTreeView(
    `libraryListView`, {
    treeDataProvider: libraryListView,
    showCollapseAll: false,
    canSelectMany: true,
    dragAndDropController: new LibraryListDragAndDrop()
  });

  const updateConfig = async (config: ConnectionConfig) => {
    await IBMi.connectionManager.update(config);
    if (IBMi.connectionManager.get(`autoRefresh`)) {
      libraryListView.refresh();
    }
  }

  context.subscriptions.push(
    libraryListViewViewer,
    vscode.commands.registerCommand(`code-for-ibmi.userLibraryList.enable`, () => {
      commands.executeCommand(`setContext`, `code-for-ibmi:libraryListDisabled`, false);
    }),

    vscode.commands.registerCommand(`code-for-ibmi.refreshLibraryListView`, () => libraryListView.refresh()),

    vscode.commands.registerCommand(`code-for-ibmi.changeCurrentLibrary`, () => {
      const connection = instance.getConnection();
      const storage = instance.getStorage();
      if (connection && storage) {
        const config = connection.getConfig();
        const currentLibrary = connection.upperCaseName(config.currentLibrary);
        let prevCurLibs = storage.getPreviousCurLibs();
        let list = [...prevCurLibs];
        const listHeader = [
          { label: l10n.t(`Currently active`), kind: vscode.QuickPickItemKind.Separator },
          { label: currentLibrary },
          { label: l10n.t(`Recently used`), kind: vscode.QuickPickItemKind.Separator }
        ];
        const clearList = l10n.t(`$(trash) Clear list`);
        const clearListArray = [{ label: ``, kind: vscode.QuickPickItemKind.Separator }, { label: clearList }];

        const quickPick = vscode.window.createQuickPick();
        quickPick.items = listHeader.concat(list.map(lib => ({ label: lib }))).concat(clearListArray);
        quickPick.placeholder = l10n.t(`Filter or new library to set as current library`);
        quickPick.title = l10n.t(`Change current library`);

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
              vscode.window.showInformationMessage(l10n.t(`Cleared list.`));
              quickPick.show();
            } else {
              if (newLibrary !== currentLibrary) {
                if (await changeCurrentLibrary(newLibrary)) {
                  libraryListView.refresh();
                  quickPick.hide();
                }
              } else {
                quickPick.hide();
                vscode.window.showInformationMessage(l10n.t(`{0} is already current library.`, newLibrary))
              }
            }
          }
        });
        quickPick.onDidHide(() => quickPick.dispose());
        quickPick.show();
      }
    }),

    vscode.commands.registerCommand(`code-for-ibmi.changeUserLibraryList`, async (libraries?: string[]) => {
      const connection = instance.getConnection();
      if (connection) {
        const content = connection.getContent();
        const config = connection.getConfig();
        const libraryList = config.libraryList;

        const newLibraryListStr = libraries?.join(",") || await vscode.window.showInputBox({
          prompt: l10n.t(`Changing library list (can use "*reset")`),
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
              vscode.window.showWarningMessage(l10n.t(`The following libraries were removed from the updated library list as they are invalid: {0}`, badLibs.join(', ')));
            }
          }

          config.libraryList = newLibraryList;
          await updateConfig(config);
        }
      }
    }),

    vscode.commands.registerCommand(`code-for-ibmi.addToLibraryList.prompt`, async () => {
      vscode.commands.executeCommand(`code-for-ibmi.addToLibraryList`, { library: await vscode.window.showInputBox({ prompt: l10n.t(`Library to add`) }) });
    }),

    vscode.commands.registerCommand(`code-for-ibmi.addToLibraryList`, async (newLibrary: WithLibrary) => {
      const connection = instance.getConnection();
      if (connection) {
        const content = connection.getContent();
        const config = connection.getConfig();
        const addingLib = connection.upperCaseName(newLibrary.library);

        if (addingLib.length > 10) {
          vscode.window.showErrorMessage(l10n.t(`Library is too long.`));
          return;
        }

        let libraryList = [...config.libraryList];

        if (libraryList.includes(addingLib)) {
          vscode.window.showWarningMessage(l10n.t(`Library {0} was already in the library list.`, addingLib));
          return;
        }

        let badLibs = await content.validateLibraryList([addingLib]);

        if (badLibs.length > 0) {
          libraryList = libraryList.filter(lib => !badLibs.includes(lib));
          vscode.window.showWarningMessage(l10n.t(`Library {0} does not exist.`, badLibs.join(', ')));
        } else {
          libraryList.push(addingLib);
          vscode.window.showInformationMessage(l10n.t(`Library {0} was added to the library list.`, addingLib));
        }

        badLibs = await content.validateLibraryList(libraryList);

        if (badLibs.length > 0) {
          libraryList = libraryList.filter(lib => !badLibs.includes(lib));
          vscode.window.showWarningMessage(l10n.t(`The following libraries were removed from the updated library list as they are invalid: {0}`, badLibs.join(', ')));
        }

        config.libraryList = libraryList;
        await updateConfig(config);
      }
    }),

    vscode.commands.registerCommand(`code-for-ibmi.removeFromLibraryList`, async (node: LibraryListNode, nodes?: LibraryListNode[]) => {
      if (node) {
        //Running from right click
        nodes = nodes ? nodes : [node];
        const connection = instance.getConnection();
        if (connection) {
          const config = connection.getConfig();
          const libraryList = config.libraryList;

          const removedLibs: string[] = [];
          nodes.map(n => n.library).forEach(lib => {
            const index = libraryList.findIndex(library => connection.upperCaseName(library) === lib)
            if (index >= 0) {
              removedLibs.push(libraryList[index]);
              libraryList.splice(index, 1);
            }
          });

          config.libraryList = libraryList;
          await updateConfig(config);
          if (removedLibs.length === 1) {
            vscode.window.showInformationMessage(l10n.t(`Library {0} was removed from the library list.`, removedLibs.join("")));
          }
          else {
            vscode.window.showInformationMessage(l10n.t(`Libraries {0} were removed from the library list.`, removedLibs.join(", ")));
          }
        }
      }
    }),

    vscode.commands.registerCommand(`code-for-ibmi.moveLibraryUp`, async (node: LibraryListNode) => {
      if (node) {
        //Running from right click
        const connection = instance.getConnection();
        if (connection) {
          const config = connection.getConfig();
          const libraryList = config.libraryList;

          const index = libraryList.findIndex(library => connection.upperCaseName(library) === node.library);
          if (index >= 0 && (index - 1) >= 0) {
            const library = libraryList[index];
            libraryList.splice(index, 1);
            libraryList.splice(index - 1, 0, library);

            config.libraryList = libraryList;
            await updateConfig(config);
          }
        }
      }
    }),

    vscode.commands.registerCommand(`code-for-ibmi.moveLibraryDown`, async (node: LibraryListNode) => {
      if (node) {
        //Running from right click
        const connection = instance.getConnection();
        if (connection) {
          const config = connection.getConfig();
          const libraryList = config.libraryList;
          const index = libraryList.findIndex(library => connection.upperCaseName(library) === node.library);
          if (index >= 0 && (index + 1) >= 0) {
            const library = libraryList[index];
            libraryList.splice(index, 1);
            libraryList.splice(index + 1, 0, library);

            config.libraryList = libraryList;
            await updateConfig(config);
          }
        }
      }
    }),

    vscode.commands.registerCommand(`code-for-ibmi.cleanupLibraryList`, async () => {
      const connection = instance.getConnection();
      if (connection) {
        const content = connection.getContent();
        const config = connection.getConfig();
        let libraryList = [...config.libraryList];
        const badLibs = await content.validateLibraryList(libraryList);

        if (badLibs.length > 0) {
          libraryList = libraryList.filter(lib => !badLibs.includes(lib));
          vscode.window.showWarningMessage(l10n.t(`The following libraries were removed from the updated library list as they are invalid: {0}`, badLibs.join(', ')));
          config.libraryList = libraryList;
          await updateConfig(config);
        } else {
          vscode.window.showInformationMessage(l10n.t(`Library list were validated without any errors.`));
        }
      }
    }),

    vscode.commands.registerCommand(`code-for-ibmi.setCurrentLibrary`, async (node: WithLibrary) => {
      const library = node.library;
      if (library) {
        const connection = instance.getConnection()
        const storage = instance.getStorage();

        if (connection && storage) {
          const content = connection.getContent();
          if (await content.checkObject({ library: "QSYS", name: library, type: "*LIB" })) {
            await changeCurrentLibrary(library);
            libraryListView.refresh();
          }
        }
      }
    })
  );
}

class LibraryListDragAndDrop implements vscode.TreeDragAndDropController<LibraryListNode> {
  readonly dragMimeTypes = [];
  readonly dropMimeTypes = [URI_LIST_MIMETYPE];

  handleDrag(source: readonly LibraryListNode[], dataTransfer: vscode.DataTransfer, token: vscode.CancellationToken) {
    dataTransfer.set(LIBRARY_LIST_MIMETYPE, new vscode.DataTransferItem(source));
  }

  handleDrop(target: LibraryListNode | undefined, dataTransfer: vscode.DataTransfer, token: vscode.CancellationToken) {
    const libraries = this.getLibraries(dataTransfer)?.map(library => library.toUpperCase());
    const config = instance.getConnection()?.getConfig();
    if (config && libraries?.length) {
      if (target?.contextValue === 'currentLibrary') {
        //Dropped on current library: change current library
        vscode.commands.executeCommand(`code-for-ibmi.setCurrentLibrary`, { library: libraries[0] } as WithLibrary);
      }
      else {
        const libraryList = config.libraryList;

        libraries.forEach(library => {
          const index = libraryList.findIndex(lib => lib === library);
          if (index > -1) {
            libraryList.splice(index, 1);
          }
        });

        if (target) {
          //Dropped on a library: push it down and move to its position
          const index = libraryList.findIndex(lib => lib === target.library);
          const moved = libraryList.splice(index, libraryList.length - index, ...libraries);
          libraryList.push(...moved);
        }
        else {
          //Dropped at the bottom of the list, after the last item: move to the last position
          libraryList.push(...libraries);
        }
        vscode.commands.executeCommand(`code-for-ibmi.changeUserLibraryList`, libraryList);
      }
    }
  }

  getLibraries(dataTransfer: vscode.DataTransfer) {
    const libraryListData = dataTransfer.get(LIBRARY_LIST_MIMETYPE);
    const urisData = dataTransfer.get(URI_LIST_MIMETYPE);
    if (libraryListData) {
      return (libraryListData.value as LibraryListNode[]).map(node => node.library);
    }
    else if (urisData && urisData.value) {
      return String(urisData.value).split(URI_LIST_SEPARATOR)
        .map(uri => vscode.Uri.parse(uri))
        .filter(uri => uri.scheme === "object")
        .map(uri => path.parse(uri.path))
        .filter(path => path.ext?.toUpperCase() === ".LIB")
        .map(path => path.name);
    }
  }
}

class LibraryListView implements vscode.TreeDataProvider<LibraryListNode> {
  private readonly _emitter: vscode.EventEmitter<LibraryListNode | undefined | null | void> = new vscode.EventEmitter();
  readonly onDidChangeTreeData: vscode.Event<LibraryListNode | undefined | null | void> = this._emitter.event;;

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
      const content = connection.getContent();
      const config = connection.getConfig();
      const currentLibrary = connection.upperCaseName(config.currentLibrary);

      const libraries = await content.getLibraryList([currentLibrary, ...config.libraryList]);

      items.push(...libraries.map((lib, index) => {
        return new LibraryListNode(connection.upperCaseName(lib.name), lib, (index === 0 ? `currentLibrary` : `library`), config.showDescInLibList);
      }));
    }
    return items;
  }
}

class LibraryListNode extends vscode.TreeItem implements WithLibrary {
  constructor(readonly library: string, readonly object: IBMiObject, context: 'currentLibrary' | 'library' = `library`, showDescInLibList: boolean) {
    super(library, vscode.TreeItemCollapsibleState.None);

    this.contextValue = context;
    this.description =
      ((context === `currentLibrary` ? `${l10n.t(`(current library)`)}` : ``)
        + (object.text !== `` && showDescInLibList ? ` ${object.text}` : ``)
        + (object.attribute !== `` ? ` (*${object.attribute})` : ``)).trim();
    this.tooltip = VscodeTools.objectToToolTip([object.library, object.name].join(`/`), object);
  }
}

async function changeCurrentLibrary(library: string) {
  const connection = instance.getConnection();
  const storage = instance.getStorage();
  if (connection && storage) {
    const config = connection.getConfig();
    const commandResult = await connection.runCommand({ command: `CHGCURLIB ${library}`, noLibList: true });
    if (commandResult.code === 0) {
      const currentLibrary = connection.upperCaseName(config.currentLibrary);
      config.currentLibrary = library;
      vscode.window.showInformationMessage(l10n.t(`Changed current library to {0}.`, library));
      storage.getPreviousCurLibs();
      const previousCurLibs = storage.getPreviousCurLibs().filter(lib => lib !== library);
      previousCurLibs.splice(0, 0, currentLibrary);
      await storage.setPreviousCurLibs(previousCurLibs);
      await IBMi.connectionManager.update(config);
      return true;
    } else {
      vscode.window.showErrorMessage(l10n.t(`Failed to set {0} as current library: {1}`, library, commandResult.stderr));
      return false;
    }
  }
}