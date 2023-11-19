
import os from "os";
import path from "path";
import vscode from "vscode";

import { ConnectionConfiguration, GlobalConfiguration } from "../api/Configuration";
import { SortOptions } from "../api/IBMiContent";
import { Search } from "../api/Search";
import { GlobalStorage } from "../api/Storage";
import { Tools } from "../api/Tools";
import { instance, setSearchResults } from "../instantiate";
import { t } from "../locale";
import { BrowserItem, BrowserItemParameters, FocusOptions, IFSFile, WithPath } from "../typings";

class IFSBrowser implements vscode.TreeDataProvider<BrowserItem> {
  private readonly emitter = new vscode.EventEmitter<BrowserItem | BrowserItem[] | undefined | null | void>();
  readonly onDidChangeTreeData = this.emitter.event;

  refresh(target?: BrowserItem) {
    this.emitter.fire(target);
  }

  getTreeItem(element: BrowserItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: BrowserItem): vscode.ProviderResult<BrowserItem[]> {
    return element?.getChildren?.() || this.getShortCuts();
  }

  getShortCuts() {
    return instance.getConfig()?.ifsShortcuts.map(directory => new IFSShortcutItem(directory)) || [];
  }

  getParent(item: BrowserItem) {
    return item.parent;
  }

  async moveShortcut(shortcut: IFSShortcutItem, direction: "top" | "up" | "down" | "bottom") {
    const config = instance.getConfig();
    if (config) {
      const shortcuts = config.ifsShortcuts;

      const moveDir = shortcut?.path?.trim();
      if (moveDir) {
        try {
          const inx = shortcuts.indexOf(moveDir);

          if (inx >= 0 && inx < shortcuts.length) {
            shortcuts.splice(inx, 1);
            let newPosition
            switch (direction) {
              case "up":
                newPosition = inx - 1;
                break;
              case "down":
                newPosition = inx + 1;
                break;
              case "top":
                newPosition = 0;
                break;
              case "bottom":
                newPosition = shortcuts.length;
                break;
            }
            shortcuts.splice(newPosition, 0, moveDir);
            config.ifsShortcuts = shortcuts;
            await ConnectionConfiguration.update(config);
            if (GlobalConfiguration.get(`autoRefresh`)) {
              this.refresh();
            }
          }
        } catch (e) {
          console.log(e);
        }
      }
    }
  }
}

class IFSItem extends BrowserItem implements WithPath {
  readonly sort: SortOptions = { order: "name", ascending: true };
  readonly path: string;

  constructor(readonly file: IFSFile, parameters: BrowserItemParameters) {
    super(file.name, parameters);
    this.path = file.path;
    this.tooltip = `${this.path}`
      .concat(`${file.size !== undefined ? `\n` + t(`Size`) + `:\t\t${file.size}` : ``}`)
      .concat(`${file.modified ? `\n` + t(`Modified`) + `:\t${new Date(file.modified.getTime() - file.modified.getTimezoneOffset() * 60 * 1000).toISOString().slice(0, 19).replace(`T`, ` `)}` : ``}`)
      .concat(`${file.owner ? `\n` + t(`Owner`) + `:\t${file.owner.toUpperCase()}` : ``}`);
  }

  sortBy(sort: SortOptions) {
    if (this.sort.order !== sort.order) {
      this.sort.order = sort.order;
      this.sort.ascending = true;
    }
    else {
      this.sort.ascending = !this.sort.ascending
    }
    this.description = `(sort: ${sort.order} ${sort.ascending ? `🔼` : `🔽`})`;
    this.reveal({ expand: true });
    this.refresh();
  }

  refresh(): void {
    vscode.commands.executeCommand(`code-for-ibmi.refreshIFSBrowserItem`, this);
  }

  reveal(options?: FocusOptions) {
    return vscode.commands.executeCommand<void>(`code-for-ibmi.revealInIFSBrowser`, this, options);
  }
}

class IFSFileItem extends IFSItem {
  constructor(file: IFSFile, readonly ifsParent: IFSDirectoryItem) {
    super(file, { parent: ifsParent });

    this.contextValue = "streamfile";
    this.iconPath = vscode.ThemeIcon.File;

    this.resourceUri = vscode.Uri.parse(this.path).with({ scheme: `streamfile` });
    this.command = {
      command: `code-for-ibmi.openEditable`,
      title: `Open Streamfile`,
      arguments: [this.path]
    };
  }

  sortBy(sort: SortOptions): void {
    this.ifsParent.sortBy(sort);
  }
}

class IFSDirectoryItem extends IFSItem {
  constructor(file: IFSFile, parent?: IFSDirectoryItem) {
    super(file, { state: vscode.TreeItemCollapsibleState.Collapsed, parent })

    this.contextValue = "directory";
    this.iconPath = vscode.ThemeIcon.Folder;
  }

  async getChildren(): Promise<BrowserItem[]> {
    const content = instance.getContent();
    if (content) {
      try {
        const objects = await content.getFileList(this.path, this.sort, handleFileListErrors);
        const directories = objects.filter(o => o.type === `directory`);
        const streamFiles = objects.filter(o => o.type === `streamfile`);
        await storeIFSList(this.path, streamFiles.map(o => o.name));
        return [...directories.map(directory => new IFSDirectoryItem(directory, this)),
        ...streamFiles.map(file => new IFSFileItem(file, this))];
      } catch (e: any) {
        console.log(e);
        vscode.window.showErrorMessage(e.message || String(e));
        return [new ErrorItem(e)];
      }
    }
    return [];
  }
}

class IFSShortcutItem extends IFSDirectoryItem {
  constructor(readonly shortcut: string) {
    super({ name: shortcut, path: shortcut, type: "directory" })

    this.contextValue = "shortcut";
    this.iconPath = new vscode.ThemeIcon("folder-library");
  }
}

class ErrorItem extends BrowserItem {
  constructor(error: Error) {
    super(t(`ifsBrowser.getChildren.errorMessage`))
  }
}

export function initializeIFSBrowser(context: vscode.ExtensionContext) {
  const ifsBrowser = new IFSBrowser();
  const ifsTreeViewer = vscode.window.createTreeView(
    `ifsBrowser`, {
    treeDataProvider: ifsBrowser,
    showCollapseAll: true
  });

  instance.onEvent(`connected`, () => ifsBrowser.refresh());

  context.subscriptions.push(
    ifsTreeViewer,
    vscode.commands.registerCommand(`code-for-ibmi.refreshIFSBrowser`, () => ifsBrowser.refresh()),
    vscode.commands.registerCommand(`code-for-ibmi.refreshIFSBrowserItem`, (item?: BrowserItem) => ifsBrowser.refresh(item)),

    vscode.commands.registerCommand(`code-for-ibmi.revealInIFSBrowser`, async (item: BrowserItem, options?: FocusOptions) => {
      ifsTreeViewer.reveal(item, options);
    }),

    vscode.commands.registerCommand(`code-for-ibmi.sortIFSFilesByName`, (item: IFSItem) => item.sortBy({ order: "name" })),
    vscode.commands.registerCommand(`code-for-ibmi.sortIFSFilesByDate`, (item: IFSItem) => item.sortBy({ order: "date" })),

    vscode.commands.registerCommand(`code-for-ibmi.changeWorkingDirectory`, async (node?: IFSDirectoryItem) => {
      const config = instance.getConfig();
      if (config) {
        const homeDirectory = config.homeDirectory;

        const newDirectory = node?.path || await vscode.window.showInputBox({
          prompt: t(`ifsBrowser.changeWorkingDirectory.prompt`),
          value: homeDirectory
        });

        try {
          if (newDirectory && newDirectory !== homeDirectory) {
            config.homeDirectory = newDirectory;
            await ConnectionConfiguration.update(config);
            vscode.window.showInformationMessage(t(`ifsBrowser.changeWorkingDirectory.message`, newDirectory));
          }
        } catch (e) {
          console.log(e);
        }
      }
    }),

    vscode.commands.registerCommand(`code-for-ibmi.addIFSShortcut`, async (node?: IFSDirectoryItem) => {
      const config = instance.getConfig();
      const content = instance.getContent();
      if (config && content) {
        const newDirectory = (await vscode.window.showInputBox({
          prompt: t(`ifsBrowser.addIFSShortcut.prompt`),
          value: node ? node.path : undefined
        }))?.trim();

        try {
          if (newDirectory) {
            const shortcuts = config.ifsShortcuts;
            if (await content.isDirectory(newDirectory) !== true) {
              throw (t(`ifsBrowser.addIFSShortcut.error`, newDirectory));
            } else if (!shortcuts.includes(newDirectory)) {
              shortcuts.push(newDirectory);
              config.ifsShortcuts = shortcuts;
              await ConnectionConfiguration.update(config);
              if (config.autoSortIFSShortcuts) {
                vscode.commands.executeCommand(`code-for-ibmi.sortIFSShortcuts`);
              }
              if (GlobalConfiguration.get(`autoRefresh`)) {
                ifsBrowser.refresh();
              }
            }
          }
        } catch (e) {
          vscode.window.showErrorMessage(t(`ifsBrowser.addIFSShortcut.errorMessage`, e));
        }
      }
    }),

    vscode.commands.registerCommand(`code-for-ibmi.removeIFSShortcut`, async (node: IFSShortcutItem) => {
      const config = instance.getConfig();
      if (config) {
        const shortcuts = config.ifsShortcuts;
        const removeDir = (node.path || (await vscode.window.showQuickPick(shortcuts, {
          placeHolder: t(`ifsBrowser.removeIFSShortcut.placeHolder`),
        })))?.trim();

        try {
          if (removeDir) {
            const inx = shortcuts.indexOf(removeDir);
            if (inx >= 0) {
              shortcuts.splice(inx, 1);
              config.ifsShortcuts = shortcuts;
              await ConnectionConfiguration.update(config);
              if (GlobalConfiguration.get(`autoRefresh`)) {
                ifsBrowser.refresh();
              }
            }
          }
        } catch (e) {
          console.log(e);
        }
      }
    }),

    vscode.commands.registerCommand(`code-for-ibmi.sortIFSShortcuts`, async () => {
      const config = instance.getConfig();

      if (config) {
        try {
          config.ifsShortcuts.sort((a, b) => a.toLocaleLowerCase().localeCompare(b.toLocaleLowerCase()));
          await ConnectionConfiguration.update(config);
          if (GlobalConfiguration.get(`autoRefresh`)) {
            ifsBrowser.refresh();
          }
        } catch (e) {
          console.log(e);
        }
      }
    }),

    vscode.commands.registerCommand(`code-for-ibmi.moveIFSShortcutDown`, (node: IFSShortcutItem) => ifsBrowser.moveShortcut(node, "down")),
    vscode.commands.registerCommand(`code-for-ibmi.moveIFSShortcutUp`, (node: IFSShortcutItem) => ifsBrowser.moveShortcut(node, "up")),
    vscode.commands.registerCommand(`code-for-ibmi.moveIFSShortcutToTop`, (node: IFSShortcutItem) => ifsBrowser.moveShortcut(node, "top")),
    vscode.commands.registerCommand(`code-for-ibmi.moveIFSShortcutToBottom`, (node: IFSShortcutItem) => ifsBrowser.moveShortcut(node, "bottom")),

    vscode.commands.registerCommand(`code-for-ibmi.createDirectory`, async (node?: IFSDirectoryItem) => {
      const connection = instance.getConnection();
      const config = instance.getConfig();
      if (connection && config) {
        const fullName = await vscode.window.showInputBox({
          prompt: t(`ifsBrowser.createDirectory.prompt`),
          value: node?.path || config.homeDirectory
        });

        if (fullName) {
          try {
            await connection.sendCommand({ command: `mkdir ${Tools.escapePath(fullName)}` });

            if (GlobalConfiguration.get(`autoRefresh`)) {
              ifsBrowser.refresh(node);
            }

          } catch (e) {
            vscode.window.showErrorMessage(t(`ifsBrowser.createDirectory.errorMessage`, e));
          }
        }
      }
    }),

    vscode.commands.registerCommand(`code-for-ibmi.createStreamfile`, async (node?: IFSDirectoryItem) => {
      const config = instance.getConfig();
      const connection = instance.getConnection();
      if (config && connection) {
        const fullName = await vscode.window.showInputBox({
          prompt: t(`ifsBrowser.createStreamfile.prompt`),
          value: node?.path || config.homeDirectory
        });

        if (fullName) {
          try {
            vscode.window.showInformationMessage(t(`ifsBrowser.createStreamfile.infoMessage`, fullName));

            await connection.sendCommand({ command: `echo "" > ${Tools.escapePath(fullName)}` });

            vscode.commands.executeCommand(`code-for-ibmi.openEditable`, fullName);

            if (GlobalConfiguration.get(`autoRefresh`)) {
              ifsBrowser.refresh(node);
            }

          } catch (e) {
            vscode.window.showErrorMessage(t(`ifsBrowser.createStreamfile.errorMessage`, e));
          }
        }
      }
    }),

    vscode.commands.registerCommand(`code-for-ibmi.uploadStreamfile`, async (node?: IFSDirectoryItem) => {
      const connection = instance.getConnection();
      const config = instance.getConfig();

      if (config && connection) {
        const root = node?.path || config.homeDirectory;

        const chosenFiles = await vscode.window.showOpenDialog({ defaultUri: vscode.Uri.file(os.homedir()), canSelectMany: true });

        const uploads: { local: string; remote: string; }[] = [];
        if (chosenFiles) {
          chosenFiles.forEach(uri => {
            uploads.push({
              local: uri.fsPath,
              remote: path.posix.join(root, path.basename(uri.fsPath))
            })
          });
        }

        if (uploads.length) {
          try {
            await connection.client.putFiles(uploads, { concurrency: 5 });
            if (GlobalConfiguration.get(`autoRefresh`)) {
              ifsBrowser.refresh(node);
            }
            vscode.window.showInformationMessage(t(`ifsBrowser.uploadStreamfile.uploadedFiles`));
          } catch (err) {
            vscode.window.showErrorMessage(t(`ifsBrowser.uploadStreamfile.errorMessage`, err));
          }
        } else {
          vscode.window.showInformationMessage(t(`ifsBrowser.uploadStreamfile.noFilesSelected`));
        }
      }
    }),

    vscode.commands.registerCommand(`code-for-ibmi.deleteIFS`, async (node: IFSItem) => {
      const connection = instance.getConnection();
      const config = instance.getConfig();
      if (connection && config) {
        if (node.path !== `/`) {
          let deletionConfirmed = false;
          const proceed = await vscode.window.showWarningMessage(t(`ifsBrowser.deleteIFS.warningMessage`, node.path), t(`Yes`), t(`Cancel`)) === t(`Yes`);
          if (proceed) {
            if ((GlobalConfiguration.get(`safeDeleteMode`)) && node.contextValue === `directory`) { //Check if path is directory
              const dirName = path.basename(node.path)  //Get the name of the directory to be deleted

              const deletionPrompt = t(`ifsBrowser.deleteIFS.deletionPrompt`, dirName);
              const input = await vscode.window.showInputBox({
                placeHolder: dirName,
                prompt: deletionPrompt,
                validateInput: text => {
                  return (text === dirName) ? null : deletionPrompt + t(`ifsBrowser.deleteIFS.deletionPrompt2`);
                }
              });
              deletionConfirmed = (input === dirName);
            }
            else {
              // If deleting a file rather than a directory, skip the name entry
              deletionConfirmed = true;
            }

            if (deletionConfirmed) {
              try {
                if(config.homeDirectory === node.path){
                  const echoHome = await connection.sendCommand({ command: `echo $HOME` });
                  if(echoHome.code === 0){
                    config.homeDirectory = echoHome.stdout.trim();
                    await ConnectionConfiguration.update(config);                    
                    vscode.window.showInformationMessage(t('ifsBrowser.deleteIFS.default.home.dir', node.path, config.homeDirectory));
                  }
                }
                const removeResult = await connection.sendCommand({ command: `rm -rf ${Tools.escapePath(node.path)}` })
                if(removeResult.code === 0){
                  vscode.window.showInformationMessage(t(`ifsBrowser.deleteIFS.infoMessage`, node.path));
                }
                else{
                  throw removeResult.stderr;
                }
                if (GlobalConfiguration.get(`autoRefresh`)) {
                  ifsBrowser.refresh(node.parent);
                }
              } catch (e) {
                vscode.window.showErrorMessage(t(`ifsBrowser.deleteIFS.errorMessage`, e));
              }
            }
            else {
              vscode.window.showInformationMessage(t(`ifsBrowser.deleteIFS.cancelled`));
            }
          }
          else {
            vscode.window.showErrorMessage(t(`ifsBrowser.deleteIFS.rootNotAllowed`));
          }
        }
      }
    }),

    vscode.commands.registerCommand(`code-for-ibmi.moveIFS`, async (node: IFSItem) => {
      const connection = instance.getConnection();
      const config = instance.getConfig();
      if (config && connection) {
        const homeDirectory = config.homeDirectory;
        const target = await vscode.window.showInputBox({
          prompt: t(`ifsBrowser.moveIFS.prompt`),
          value: node.path
        });

        if (target) {
          const targetPath = path.posix.isAbsolute(target) ? target : path.posix.join(homeDirectory, target);
          try {
            await connection.sendCommand({ command: `mv ${Tools.escapePath(node.path)} ${Tools.escapePath(targetPath)}` });
            if (GlobalConfiguration.get(`autoRefresh`)) {
              ifsBrowser.refresh();
            }
            vscode.window.showInformationMessage(t(path.posix.dirname(node.path) === path.posix.dirname(targetPath) ? `ifsBrowser.moveIFS.renamed` : `ifsBrowser.moveIFS.moved`,
              Tools.escapePath(node.path),
              Tools.escapePath(targetPath)
            ));

          } catch (e) {
            vscode.window.showErrorMessage(t(`ifsBrowser.moveIFS.errorMessage`, t(String(node.contextValue)), e));
          }
        }
      }
    }),
    vscode.commands.registerCommand(`code-for-ibmi.copyIFS`, async (node: IFSItem) => {
      const config = instance.getConfig();
      const connection = instance.getConnection();

      if (config && connection) {
        const homeDirectory = config.homeDirectory;
        const target = await vscode.window.showInputBox({
          prompt: t(`ifsBrowser.copyIFS.prompt`),
          value: node.path.endsWith(`/`) ? node.path.substring(0, node.path.length - 1) : node.path
        });

        if (target) {
          const targetPath = target.startsWith(`/`) ? target : homeDirectory + `/` + target;
          try {
            await connection.sendCommand({ command: `cp -r ${Tools.escapePath(node.path)} ${Tools.escapePath(targetPath)}` });
            if (GlobalConfiguration.get(`autoRefresh`)) {
              ifsBrowser.refresh();
            }
            vscode.window.showInformationMessage(t(`ifsBrowser.copyIFS.infoMessage`, Tools.escapePath(node.path), Tools.escapePath(targetPath)));

          } catch (e) {
            vscode.window.showErrorMessage(t(`ifsBrowser.copyIFS.errorMessage`, t(String(node.contextValue)), e));
          }
        }
      }
    }),

    vscode.commands.registerCommand(`code-for-ibmi.searchIFS`, async (node?: IFSItem) => {
      const connection = instance.getConnection();
      const config = instance.getConfig();

      if (connection?.remoteFeatures.grep && config) {
        const searchPath = node?.path || await vscode.window.showInputBox({
          value: config.homeDirectory,
          prompt: t(`ifsBrowser.searchIFS.prompt`),
          title: t(`ifsBrowser.searchIFS.title`)
        });

        if (searchPath) {
          const list = GlobalStorage.get().getPreviousSearchTerms();
          const items: vscode.QuickPickItem[] = list.map(term => ({ label: term }));
          const listHeader = [
            { label: t(`ifsBrowser.searchIFS.previousSearches`), kind: vscode.QuickPickItemKind.Separator }
          ];
          const clearList = t(`clearList`);
          const clearListArray: vscode.QuickPickItem[] = [{ label: ``, kind: vscode.QuickPickItemKind.Separator }, { label: clearList }];

          const quickPick = vscode.window.createQuickPick();
          quickPick.items = items.length ? [...items, ...clearListArray] : [];
          quickPick.placeholder = items.length ? t(`ifsBrowser.searchIFS.placeholder`) : t(`ifsBrowser.searchIFS.placeholder2`);
          quickPick.title = t(`ifsBrowser.searchIFS.title2`, searchPath);

          quickPick.onDidChangeValue(() => {
            if (!quickPick.value) {
              quickPick.items = [...listHeader, ...items, ...clearListArray];
            } else if (!list.includes(quickPick.value)) {
              quickPick.items = [{ label: quickPick.value },
              ...listHeader,
              ...items]
            }
          })

          quickPick.onDidAccept(async () => {
            const searchTerm = quickPick.activeItems[0].label;
            if (searchTerm) {
              if (searchTerm === clearList) {
                GlobalStorage.get().setPreviousSearchTerms([]);
                quickPick.items = [];
                quickPick.placeholder = t(`ifsBrowser.searchIFS.placeholder2`);
                vscode.window.showInformationMessage(t(`clearedList`));
                quickPick.show();
              } else {
                quickPick.hide();
                GlobalStorage.get().setPreviousSearchTerms(list.filter(term => term !== searchTerm).splice(0, 0, searchTerm));
                await doSearchInStreamfiles(searchTerm, searchPath);
              }
            }
          });

          quickPick.onDidHide(() => quickPick.dispose());
          quickPick.show();
        }
      } else {
        vscode.window.showErrorMessage(t(`ifsBrowser.searchIFS.noGrep`));
      }
    }),

    vscode.commands.registerCommand(`code-for-ibmi.downloadStreamfile`, async (node: IFSItem) => {
      const client = instance.getConnection()?.client;
      if (client) {
        //Get filename from path on server
        const remoteFilepath = path.join(os.homedir(), path.basename(node.path));

        let localPath = (await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(remoteFilepath) }))?.path;
        if (localPath) {
          if (process.platform === `win32`) {
            //Issue with getFile not working propertly on Windows
            //when there was a / at the start.
            localPath = localPath[0] === `/` ? localPath.substring(1) : localPath;
          }

          try {
            await client.getFile(localPath, node.path);
            vscode.window.showInformationMessage(t(`ifsBrowser.downloadStreamfile.infoMessage`));
          } catch (e) {
            vscode.window.showErrorMessage(t(`ifsBrowser.downloadStreamfile.errorMessage`, t(String(node.contextValue)), e));
          }
        }
      }
    }),

    vscode.commands.registerCommand(`code-for-ibmi.ifs.copyPath`, async (node: IFSItem) => {
      await vscode.env.clipboard.writeText(node.path);
    }),
  )
}

function handleFileListErrors(errors: string[]) {
  errors.forEach(error => vscode.window.showErrorMessage(error));
  vscode.window.showErrorMessage(t(`ifsBrowser.handleFileListErrors.errorMessage`, errors.length, errors.length > 1 ? t(`errors`) : t(`error`)));
}

function storeIFSList(path: string, list: string[]) {
  const storage = instance.getStorage();
  if (storage) {
    const existingDirs = storage.getSourceList();
    existingDirs[path] = list;
    return storage.setSourceList(existingDirs);
  }
}

async function doSearchInStreamfiles(searchTerm: string, searchPath: string) {
  try {
    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: t(`ifsBrowser.doSearchInStreamfiles.title`),
    }, async progress => {
      progress.report({
        message: t(`ifsBrowser.doSearchInStreamfiles.progressMessage`, searchTerm, searchPath)
      });

      let results = (await Search.searchIFS(instance, searchPath, searchTerm))
        .map(a => ({ ...a, label: path.posix.relative(searchPath, a.path) }))
        .sort((a, b) => a.path.localeCompare(b.path));

      if (results.length > 0) {
        setSearchResults(searchTerm, results);
      } else {
        vscode.window.showInformationMessage(t(`ifsBrowser.doSearchInStreamfiles.noResults`, searchTerm, searchPath));
      }
    });

  } catch (e) {
    vscode.window.showErrorMessage(t(`ifsBrowser.doSearchInStreamfiles.errorMessage`));
  }
}