import path from "path";
import vscode, { CancellationToken, commands, Event, FileDecoration, FileDecorationProvider, l10n, ProviderResult, ThemeColor, ThemeIcon, Uri, window } from "vscode";
import IBMi from "../../api/IBMi";
import { activateLibraryListPreset, createLibraryListPreset, deleteLibraryListPreset, ensureLibraryListPresets, LibraryListDefaults, persistLibraryListPresets, renameLibraryListPreset, saveActiveLibraryListPreset } from "../../api/libraryListPresets";
import { instance } from "../../instantiate";
import { ConnectionConfig, IBMiObject, LibraryListPreset, LIBRARY_LIST_MIMETYPE, URI_LIST_MIMETYPE, URI_LIST_SEPARATOR, WithLibrary } from "../../typings";
import { VscodeTools } from "../Tools";

export function initializeLibraryListView(context: vscode.ExtensionContext) {
  const libraryListView = new LibraryListView();
  const libraryListViewViewer = vscode.window.createTreeView(
    `libraryListView`, {
    treeDataProvider: libraryListView,
    showCollapseAll: true,
    canSelectMany: true,
    dragAndDropController: new LibraryListDragAndDrop()
  });
  const liblDecorationProvider = new LiblDecorationProvider();

  const updateConfig = async (config: ConnectionConfig) => {
    saveActiveLibraryListPreset(config);
    await persistLibraryListPresets(config);
    if (IBMi.connectionManager.get(`autoRefresh`)) {
      libraryListView.refresh();
    }
  }

  const refreshActivePreset = async () => {
    const activePreset = libraryListView.setActivePreset(instance.getConnection()?.getConfig().activeLibraryListPreset);
    await commands.executeCommand(`libraryListView.focus`);
    await commands.executeCommand(`workbench.actions.treeView.libraryListView.collapseAll`);
    libraryListView.refresh();
    if (activePreset) {
      await libraryListViewViewer.reveal(activePreset, { expand: true, focus: false, select: false });
    }
  }

  const getDefaults = (connection: IBMi): LibraryListDefaults => ({
    currentLibrary: connection.defaultCurrentLibrary,
    libraryList: connection.defaultUserLibraries
  });

  context.subscriptions.push(
    libraryListViewViewer,
    window.registerFileDecorationProvider(liblDecorationProvider),
    vscode.commands.registerCommand(`code-for-ibmi.userLibraryList.enable`, () => {
      commands.executeCommand(`setContext`, `code-for-ibmi:libraryListDisabled`, false);
    }),

    vscode.commands.registerCommand(`code-for-ibmi.refreshLibraryListView`, () => libraryListView.refresh()),

    vscode.commands.registerCommand(`code-for-ibmi.libraryListPreset.create`, async () => {
      const connection = instance.getConnection();
      if (connection) {
        const config = connection.getConfig();
        ensureLibraryListPresets(config, getDefaults(connection));
        const name = await vscode.window.showInputBox({
          title: l10n.t(`New Library List`),
          prompt: l10n.t(`Enter a name for the new library list`),
          validateInput: value => value.trim() && config.libraryListPresets.some(preset => preset.name.localeCompare(value.trim(), undefined, { sensitivity: `accent` }) === 0) ? l10n.t(`A library list with this name already exists.`) : undefined
        });

        if (name?.trim()) {
          createLibraryListPreset(config, name, getDefaults(connection));
          await updateConfig(config);
          await refreshActivePreset();
        }
      }
    }),

    vscode.commands.registerCommand(`code-for-ibmi.libraryListPreset.select`, async () => {
      const connection = instance.getConnection();
      if (connection) {
        const config = connection.getConfig();
        const presets = ensureLibraryListPresets(config, getDefaults(connection));
        const selection = await vscode.window.showQuickPick(presets.map(preset => ({
          label: preset.name,
          description: preset.name === config.activeLibraryListPreset ? l10n.t(`Active`) : undefined,
          preset
        })), { title: l10n.t(`Select Library List`) });

        if (selection) {
          activateLibraryListPreset(config, selection.preset.name);
          await updateConfig(config);
          await refreshActivePreset();
        }
      }
    }),

    vscode.commands.registerCommand(`code-for-ibmi.libraryListPreset.activate`, async (node: LibraryListPresetNode) => {
      const connection = instance.getConnection();
      if (connection && node) {
        const config = connection.getConfig();
        activateLibraryListPreset(config, node.preset.name);
        await updateConfig(config);
        await refreshActivePreset();
      }
    }),

    vscode.commands.registerCommand(`code-for-ibmi.libraryListPreset.rename`, async (node: LibraryListPresetNode) => {
      const connection = instance.getConnection();
      if (connection && node) {
        const config = connection.getConfig();
        const name = await vscode.window.showInputBox({
          title: l10n.t(`Rename Library List`),
          value: node.preset.name,
          validateInput: value => value.trim() && config.libraryListPresets.some(preset => preset !== node.preset && preset.name.localeCompare(value.trim(), undefined, { sensitivity: `accent` }) === 0) ? l10n.t(`A library list with this name already exists.`) : undefined
        });
        if (name?.trim()) {
          renameLibraryListPreset(config, node.preset, name);
          await updateConfig(config);
          libraryListView.refresh();
        }
      }
    }),

    vscode.commands.registerCommand(`code-for-ibmi.libraryListPreset.delete`, async (node: LibraryListPresetNode) => {
      const connection = instance.getConnection();
      if (connection && node && await vscode.window.showWarningMessage(l10n.t(`Delete library list {0}?`, node.preset.name), { modal: true }, l10n.t(`Delete`))) {
        const config = connection.getConfig();
        deleteLibraryListPreset(config, node.preset);
        await updateConfig(config);
        await refreshActivePreset();
      }
    }),

    vscode.commands.registerCommand(`code-for-ibmi.changeCurrentLibrary`, () => {
      const connection = instance.getConnection();
      const storage = instance.getStorage();
      if (connection && storage) {
        const config = connection.getConfig();
        const currentLibrary = config.currentLibrary ? connection.upperCaseName(config.currentLibrary) : undefined;
        const defaultCurrentLibrary = connection.defaultCurrentLibrary ? connection.upperCaseName(connection.defaultCurrentLibrary) : undefined;
        let prevCurLibs = storage.getPreviousCurLibs();
        let list = [...prevCurLibs];
        const listHeader: vscode.QuickPickItem[] = [];
        if (currentLibrary) {
          listHeader.push(
            { label: l10n.t(`Currently active`), kind: vscode.QuickPickItemKind.Separator },
            { label: currentLibrary }
          );
        }
        listHeader.push({ label: l10n.t(`Recently used`), kind: vscode.QuickPickItemKind.Separator });

        const clearList = l10n.t(`$(trash) Clear List`);
        const resetToDefault = l10n.t(`$(sync) Reset to Default`);
        const additionalOptions: vscode.QuickPickItem[] = [
          { label: ``, kind: vscode.QuickPickItemKind.Separator },
          { label: clearList }
        ];
        if (currentLibrary !== defaultCurrentLibrary) {
          additionalOptions.push({ label: resetToDefault });
        }

        const quickPick = vscode.window.createQuickPick();
        quickPick.items = listHeader.concat(list.map(lib => ({ label: lib }))).concat(additionalOptions);
        quickPick.placeholder = l10n.t(`Filter or new library to set as current library`);
        quickPick.title = l10n.t(`Change current library`);

        quickPick.onDidChangeValue(() => {
          if (quickPick.value === ``) {
            quickPick.items = listHeader.concat(list.map(lib => ({ label: lib }))).concat(additionalOptions);
          } else if (!list.includes(connection.upperCaseName(quickPick.value))) {
            quickPick.items = [{ label: connection.upperCaseName(quickPick.value) }].concat(listHeader)
              .concat(list.map(lib => ({ label: lib })))
          }
        })

        quickPick.onDidAccept(async () => {
          const newLibrary = quickPick.selectedItems[0].label;
          if (newLibrary !== undefined) {
            if (newLibrary === clearList) {
              await storage.setPreviousCurLibs([]);
              list = [];
              quickPick.items = list.map(lib => ({ label: lib }));
              vscode.window.showInformationMessage(l10n.t(`Cleared list.`));
              quickPick.show();
            } else if (newLibrary === resetToDefault) {
              if (await changeCurrentLibrary(defaultCurrentLibrary)) {
                libraryListView.refresh();
                quickPick.hide();
              }
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

            // Validate no library is already in the system portion
            const sysLibsFound = newLibraryList.filter(lib => connection.systemLibraries.includes(lib));
            if (sysLibsFound.length > 0) {
              newLibraryList = newLibraryList.filter(lib => !sysLibsFound.includes(lib));
              vscode.window.showWarningMessage(l10n.t(`The following libraries are already in the system portion of the library list and were removed: {0}`, sysLibsFound.join(', ')));
            }

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

        // Validate library is not in the system portion
        if (connection.systemLibraries.includes(addingLib)) {
          vscode.window.showErrorMessage(l10n.t(`Library {0} is already in the system portion of the library list.`, addingLib));
          return;
        }

        // Validate library is not already in the user portion
        let usrLibs = [...config.libraryList];
        if (usrLibs.includes(addingLib)) {
          vscode.window.showWarningMessage(l10n.t(`Library {0} was already in the library list.`, addingLib));
          return;
        }

        // Validate library exists
        const badLibs = await content.validateLibraryList([addingLib]);
        if (badLibs.length > 0) {
          vscode.window.showWarningMessage(l10n.t(`Library {0} does not exist.`, badLibs.join(', ')));
          return;
        }

        usrLibs.push(addingLib);
        vscode.window.showInformationMessage(l10n.t(`Library {0} was added to the library list.`, addingLib));

        const invalidLibs = await content.validateLibraryList(usrLibs);
        if (invalidLibs.length > 0) {
          usrLibs = usrLibs.filter(lib => !invalidLibs.includes(lib));
          vscode.window.showWarningMessage(l10n.t(`The following libraries were removed from the updated library list as they are invalid: {0}`, invalidLibs.join(', ')));
        }

        config.libraryList = usrLibs;
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
    }),
    vscode.commands.registerCommand("code-for-ibmi.removeCurrentLibrary", async () => {
      await changeCurrentLibrary();
      libraryListView.refresh();
    })
  );
}

type LibraryListTreeNode = LibraryListPresetNode | LibraryListNode | InactiveLibraryListNode;

class LibraryListDragAndDrop implements vscode.TreeDragAndDropController<LibraryListTreeNode> {
  readonly dragMimeTypes = [];
  readonly dropMimeTypes = [URI_LIST_MIMETYPE];

  handleDrag(source: readonly LibraryListTreeNode[], dataTransfer: vscode.DataTransfer, token: vscode.CancellationToken) {
    const libraries = source.filter((node): node is LibraryListNode => node instanceof LibraryListNode);
    if (libraries.length) {
      dataTransfer.set(LIBRARY_LIST_MIMETYPE, new vscode.DataTransferItem(libraries));
    }
  }

  handleDrop(target: LibraryListTreeNode | undefined, dataTransfer: vscode.DataTransfer, token: vscode.CancellationToken) {
    const libraries = this.getLibraries(dataTransfer)?.map(library => library.toUpperCase()).filter(library => library !== "*CRTDFT");
    const config = instance.getConnection()?.getConfig();
    if (config && libraries?.length) {
      if (target instanceof LibraryListNode && target.contextValue?.startsWith('currentLibrary')) {
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

        if (target instanceof LibraryListNode) {
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

class LibraryListView implements vscode.TreeDataProvider<LibraryListTreeNode> {
  private readonly _emitter: vscode.EventEmitter<LibraryListTreeNode | undefined | null | void> = new vscode.EventEmitter();
  private readonly presetNodes = new Map<string, LibraryListPresetNode>();
  readonly onDidChangeTreeData: vscode.Event<LibraryListTreeNode | undefined | null | void> = this._emitter.event;;

  refresh(element?: LibraryListTreeNode) {
    this._emitter.fire(element);
  }

  getTreeItem(element: LibraryListTreeNode): vscode.TreeItem {
    return element;
  }

  getParent(element: LibraryListTreeNode): vscode.ProviderResult<LibraryListTreeNode> {
    if (element instanceof LibraryListPresetNode) {
      return undefined;
    }

    if (element instanceof InactiveLibraryListNode) {
      return element.preset;
    }

    const activePreset = instance.getConnection()?.getConfig().activeLibraryListPreset;
    return activePreset ? this.presetNodes.get(activePreset) : undefined;
  }

  setActivePreset(activePresetName?: string) {
    let activePreset: LibraryListPresetNode | undefined;
    this.presetNodes.forEach(node => {
      const active = node.preset.name === activePresetName;
      node.update(active);
      if (active) {
        activePreset = node;
      }
    });
    return activePreset;
  }

  async getChildren(element?: LibraryListTreeNode): Promise<LibraryListTreeNode[]> {
    const connection = instance.getConnection();
    if (!connection) {
      return [];
    }

    const config = connection.getConfig();
    const defaults = { currentLibrary: connection.defaultCurrentLibrary, libraryList: connection.defaultUserLibraries };
    const needsMigration = config.libraryListPresets.length === 0;
    const presets = ensureLibraryListPresets(config, defaults);

    if (needsMigration) {
      await persistLibraryListPresets(config);
    }

    if (!element) {
      const presetNames = new Set(presets.map(preset => preset.name));
      this.presetNodes.forEach((node, name) => {
        if (!presetNames.has(name)) {
          this.presetNodes.delete(name);
        }
      });

      return presets.map(preset => {
        let node = this.presetNodes.get(preset.name);
        if (!node) {
          node = new LibraryListPresetNode(preset, preset.name === config.activeLibraryListPreset);
          this.presetNodes.set(preset.name, node);
        }
        else {
          node.update(preset.name === config.activeLibraryListPreset);
        }
        return node;
      });
    }

    if (!(element instanceof LibraryListPresetNode)) {
      return [];
    }

    if (element.preset.name !== config.activeLibraryListPreset) {
      return [
        new InactiveLibraryListNode(element, element.preset.currentLibrary, true),
        ...element.preset.libraryList.map(library => new InactiveLibraryListNode(element, library, false))
      ];
    }

    const content = connection.getContent();
    const currentLibrary = config.currentLibrary ? connection.upperCaseName(config.currentLibrary) : undefined;
    const curAndUsrLibs = await content.getLibraryList(currentLibrary ? [currentLibrary, ...config.libraryList] : config.libraryList);

    //Push manually if curlib is *CRTDFT
    if (!currentLibrary) {
      curAndUsrLibs.unshift({ library: `QSYS`, type: `*LIB`, name: '', attribute: ``, text: `` });
    }

    return curAndUsrLibs.map((lib, index) => {
      const upperCaseLibName = connection.upperCaseName(lib.name);
      const isSystemLib = connection.systemLibraries.includes(upperCaseLibName);
      return new LibraryListNode(upperCaseLibName, lib, (index === 0 ? `currentLibrary` : `library`), config.showDescInLibList, isSystemLib);
    });
  }
}

class LibraryListPresetNode extends vscode.TreeItem {
  constructor(readonly preset: LibraryListPreset, active: boolean) {
    super(preset.name, vscode.TreeItemCollapsibleState.Collapsed);
    this.update(active);
  }

  update(active: boolean) {
    this.collapsibleState = active ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed;
    this.contextValue = active ? `libraryListPreset_active` : `libraryListPreset`;
    this.description = active ? l10n.t(`Active`) : l10n.t(`{0} libraries`, this.preset.libraryList.length);
    this.iconPath = new ThemeIcon(active ? `check` : `library`);
    this.command = active ? undefined : {
      title: l10n.t(`Use Library List`),
      command: `code-for-ibmi.libraryListPreset.activate`,
      arguments: [this]
    };
  }
}

class InactiveLibraryListNode extends vscode.TreeItem {
  constructor(readonly preset: LibraryListPresetNode, library: string | undefined, isCurrentLibrary: boolean) {
    super(library || l10n.t(`No current library`), vscode.TreeItemCollapsibleState.None);
    this.contextValue = `inactiveLibrary`;
    this.iconPath = new ThemeIcon(library ? `library` : `skip`);
    this.description = isCurrentLibrary ? l10n.t(`(current library)`) : undefined;
  }
}

class LibraryListNode extends vscode.TreeItem implements WithLibrary {
  constructor(readonly library: string, readonly object: IBMiObject, context: 'currentLibrary' | 'library' = `library`, showDescInLibList: boolean, isSystemLib: boolean = false) {
    super(library || l10n.t("No current library"), vscode.TreeItemCollapsibleState.None);

    this.contextValue = `${context}${library ? "" : "_none"}`;
    this.iconPath = new ThemeIcon(library ? "library" : "skip");
    const isFound = object.text !== `*** NOT FOUND ***`;
    this.resourceUri = Uri.parse(`${context}:${library}?isFound=${isFound}&isSystemLib=${isSystemLib}`);
    if (this.library) {
      this.description =
        ((context === `currentLibrary` ? `${l10n.t(`(current library)`)}` : ``)
          + (object.text !== `` && showDescInLibList ? ` ${object.text}` : ``)
          + (object.attribute !== `` ? ` (*${object.attribute})` : ``)).trim();
      this.tooltip = VscodeTools.objectToToolTip([object.library, object.name].join(`/`), object);
    }
    else {
      this.tooltip = undefined;
    }
  }
}

async function changeCurrentLibrary(library?: string) {
  library = library?.toUpperCase() === "*CRTDFT" ? undefined : library;
  const connection = instance.getConnection();
  const storage = instance.getStorage();
  if (connection && storage) {
    const config = connection.getConfig();
    const commandResult = await connection.runCommand({ command: `QSYS/CHGCURLIB ${library || "*CRTDFT"}`, noLibList: true });
    if (commandResult.code === 0) {
      const currentLibrary = config.currentLibrary ? connection.upperCaseName(config.currentLibrary) : undefined;
      if (library) {
        config.currentLibrary = library;
        vscode.window.showInformationMessage(l10n.t(`Changed current library to {0}.`, library));
      }
      else {
        config.currentLibrary = undefined;
        vscode.window.showInformationMessage(l10n.t(`Current library removed.`));
      }

      const previousCurLibs = storage.getPreviousCurLibs().filter(lib => lib !== library && lib !== "*CRTDFT");
      if (currentLibrary) {
        previousCurLibs.splice(0, 0, currentLibrary);
      }
      await storage.setPreviousCurLibs(previousCurLibs);

      saveActiveLibraryListPreset(config);
      await persistLibraryListPresets(config);
      return true;
    } else {
      if (library) {
        vscode.window.showErrorMessage(l10n.t(`Failed to set {0} as current library: {1}`, library, commandResult.stderr));
      }
      else {
        vscode.window.showErrorMessage(l10n.t(`Failed to remove current library: {0}`, commandResult.stderr));
      }
      return false;
    }
  }
}

export class LiblDecorationProvider implements FileDecorationProvider {
  onDidChangeFileDecorations?: Event<Uri | Uri[] | undefined> | undefined;
  provideFileDecoration(uri: Uri, token: CancellationToken): ProviderResult<FileDecoration> {
    const params = new URLSearchParams(uri.query);

    if (uri.scheme === 'currentLibrary' || uri.scheme === 'library') {
      const isNotFound = params.get('isFound') === 'false';
      const isSystemLib = params.get('isSystemLib') === 'true';
      if (isNotFound || isSystemLib) {
        return {
          badge: '⚠',
          color: new ThemeColor('errorForeground')
        };
      }
    }
  }
}