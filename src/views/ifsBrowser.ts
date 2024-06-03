import os from "os";
import path, { dirname, extname } from "path";
import vscode, { FileType, window } from "vscode";

import { existsSync, mkdirSync, rmdirSync } from "fs";
import { ConnectionConfiguration, GlobalConfiguration } from "../api/Configuration";
import { SortOptions } from "../api/IBMiContent";
import { Search } from "../api/Search";
import { GlobalStorage } from "../api/Storage";
import { Tools } from "../api/Tools";
import { instance, setSearchResults } from "../instantiate";
import { t } from "../locale";
import { BrowserItem, BrowserItemParameters, FocusOptions, IFSFile, IFS_BROWSER_MIMETYPE, OBJECT_BROWSER_MIMETYPE, WithPath } from "../typings";

const URI_LIST_MIMETYPE = "text/uri-list";
const URI_LIST_SEPARATOR = "\r\n";
const PROTECTED_DIRS = /^(\/|\/QOpenSys|\/QSYS\.LIB|\/QDLS|\/QOPT|\/QNTC|\/QFileSvr\.400|\/QIBM|\/QSR|\/QTCPTMM|\/bin|\/dev|\/home|\/tmp|\/usr|\/var)$/i;
const ALWAYS_SHOW_FILES = /^(\.gitignore|\.vscode|\.deployignore)$/i;
type DragNDropAction = "move" | "copy";
type DragNDropBehavior = DragNDropAction | "ask";
const getDragDropBehavior = () => GlobalConfiguration.get<DragNDropBehavior>(`IfsBrowser.DragAndDropDefaultBehavior`) || "ask";

function isProtected(path: string) {
  return PROTECTED_DIRS.test(path) || instance.getContent()?.isProtectedPath(path);
}

function alwaysShow(name: string) {
  return ALWAYS_SHOW_FILES.test(name);
}

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
    this.tooltip = new vscode.MarkdownString(Tools.generateTooltipHtmlTable(this.path, {
      size: file.size,
      modified: file.modified ? new Date(file.modified.getTime() - file.modified.getTimezoneOffset() * 60 * 1000).toISOString().slice(0, 19).replace(`T`, ` `) : ``,
      owner: file.owner ? file.owner.toUpperCase() : ``
    }));
    this.tooltip.supportHtml = true;
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
      command: "code-for-ibmi.openWithDefaultMode",
      title: `Open Streamfile`,
      arguments: [{path: this.path}]
    };
  }

  sortBy(sort: SortOptions): void {
    this.ifsParent.sortBy(sort);
  }
}

class IFSDirectoryItem extends IFSItem {
  constructor(file: IFSFile, parent?: IFSDirectoryItem) {
    super(file, { state: vscode.TreeItemCollapsibleState.Collapsed, parent })
    const protectedDir = isProtected(this.file.path);
    this.contextValue = `directory${protectedDir ? `_protected` : ``}`;
    this.iconPath = protectedDir ? new vscode.ThemeIcon("lock-small") : vscode.ThemeIcon.Folder;
  }

  async getChildren(): Promise<BrowserItem[]> {
    const content = instance.getContent();
    if (content) {
      try {
        const showHidden = instance.getConfig()?.showHiddenFiles;
        const filterIFSFile = (file: IFSFile, type: "directory" | "streamfile") => file.type === type && (showHidden || !file.name.startsWith(`.`) || alwaysShow(file.name));
        const objects = await content.getFileList(this.path, this.sort, handleFileListErrors);
        const directories = objects.filter(f => filterIFSFile(f, "directory"));
        const streamFiles = objects.filter(f => filterIFSFile(f, "streamfile"));
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

    const protectedDir = isProtected(this.file.path);
    this.contextValue = `shortcut${protectedDir ? `_protected` : ``}`;
    this.iconPath = new vscode.ThemeIcon(protectedDir ? "lock-small" : "folder-library");
    this.tooltip = ``;
  }
}

class ErrorItem extends BrowserItem {
  constructor(error: Error) {
    super(t("ifsBrowser.getChildren.errorMessage"))
    this.description = error.message;
  }
}

class IFSBrowserDragAndDrop implements vscode.TreeDragAndDropController<IFSItem> {
  readonly dragMimeTypes = [URI_LIST_MIMETYPE, IFS_BROWSER_MIMETYPE];
  readonly dropMimeTypes = [URI_LIST_MIMETYPE, IFS_BROWSER_MIMETYPE, OBJECT_BROWSER_MIMETYPE];

  handleDrag(source: readonly IFSItem[], dataTransfer: vscode.DataTransfer, token: vscode.CancellationToken) {
    dataTransfer.set(IFS_BROWSER_MIMETYPE, new vscode.DataTransferItem(source));
    dataTransfer.set(URI_LIST_MIMETYPE, new vscode.DataTransferItem(source.filter(item => item.file.type === "streamfile")
      .map(item => item.resourceUri)
      .join(URI_LIST_SEPARATOR)));
  }

  async handleDrop(target: IFSItem | undefined, dataTransfer: vscode.DataTransfer, token: vscode.CancellationToken) {
    if (target) {
      const toDirectory = (target.file.type === "streamfile" ? target.parent : target) as IFSDirectoryItem;
      const ifsBrowserItems = dataTransfer.get(IFS_BROWSER_MIMETYPE);
      const objectBrowserItems = dataTransfer.get(OBJECT_BROWSER_MIMETYPE);
      if (ifsBrowserItems) {
        this.moveOrCopyItems(ifsBrowserItems.value as IFSItem[], toDirectory)
      } else if (objectBrowserItems) {
        const memberUris = (await objectBrowserItems.asString()).split(URI_LIST_SEPARATOR).map(uri => vscode.Uri.parse(uri));
        this.copyMembers(memberUris, toDirectory)
      }
      else {
        const explorerItems = dataTransfer.get(URI_LIST_MIMETYPE);
        if (explorerItems && explorerItems.value) {
          //URI_LIST_MIMETYPE Mime type is a string with `toString()`ed Uris separated by `\r\n`.
          const uris = (await explorerItems.asString()).split(URI_LIST_SEPARATOR).map(uri => vscode.Uri.parse(uri));
          vscode.commands.executeCommand(`code-for-ibmi.uploadStreamfile`, toDirectory, uris);
        }
      }
    }
  }

  private async moveOrCopyItems(ifsBrowserItems: IFSItem[], toDirectory: IFSDirectoryItem) {
    const connection = instance.getConnection();
    ifsBrowserItems = ifsBrowserItems.filter(item => item.path !== toDirectory.path && (item.parent && item.parent instanceof IFSItem && item.parent.path !== toDirectory.path));
    if (connection && ifsBrowserItems.length) {
      const dndBehavior = getDragDropBehavior();
      let action: DragNDropAction | undefined;
      if (dndBehavior === "ask") {
        const copy = t('ifsBrowser.uploadStreamfile.copy');
        const move = t('ifsBrowser.uploadStreamfile.move');
        const answer = await vscode.window.showInformationMessage(t('ifsBrowser.uploadStreamfile.ask', toDirectory.path), { modal: true }, copy, move);
        if (answer) {
          action = answer === copy ? "copy" : "move";
        }
      }
      else {
        action = dndBehavior;
      }

      if (action) {
        let result;
        switch (action) {
          case "copy":
            result = await connection.sendCommand({ command: `cp -r ${ifsBrowserItems.map(item => item.path).join(" ")} ${toDirectory.path}` });
            break;

          case "move":
            result = await connection.sendCommand({ command: `mv ${ifsBrowserItems.map(item => item.path).join(" ")} ${toDirectory.path}` });
            ifsBrowserItems.map(item => item.parent)
              .filter(Tools.distinct)
              .forEach(folder => folder?.refresh?.());
            toDirectory.reveal({ focus: true })
            break;
        }

        if (result.code === 0) {
          toDirectory.refresh();
        } else {
          vscode.window.showErrorMessage(t(`ifsBrowser.uploadStreamfile.${action}.failed`, toDirectory.path, result.stderr));
        }
      }
    }
  }

  private async copyMembers(memberUris: vscode.Uri[], toDirectory: IFSDirectoryItem) {
    const connection = instance.getConnection();
    if (connection && memberUris && memberUris.length) {
      try {
        for (let uri of memberUris) {
          let result;
          const member = connection.parserMemberPath(uri.path);
          const command: string = `CPYTOSTMF FROMMBR('${Tools.qualifyPath(member.library, member.file, member.name, member.asp)}') TOSTMF('${toDirectory.path}/${member.basename.toLocaleLowerCase()}') STMFCCSID(1208) ENDLINFMT(*LF)`;
          result = await connection.runCommand({
            command: command,
            noLibList: true
          });
          if (result.code !== 0) {
            throw (t(`ifsBrowser.copyToStreamfile.failed`, toDirectory.path, result!.stderr));
          }
        };

        vscode.window.showInformationMessage(t(`ifsBrowser.copyToStreamfile.infoMessage`, memberUris.length, toDirectory.path));
        toDirectory.refresh();
      } catch (e: any) {
        vscode.window.showErrorMessage(e || e.text);
      }
    }
  }
}

export function initializeIFSBrowser(context: vscode.ExtensionContext) {
  const ifsBrowser = new IFSBrowser();
  const ifsTreeViewer = vscode.window.createTreeView(
    `ifsBrowser`, {
    treeDataProvider: ifsBrowser,
    showCollapseAll: true,
    canSelectMany: true,
    dragAndDropController: new IFSBrowserDragAndDrop()
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
        const value = `${node?.path || config.homeDirectory}/`;
        const selectStart = value.length + 1;
        const fullName = await vscode.window.showInputBox({
          prompt: t(`ifsBrowser.createDirectory.prompt`),
          value: value,
          valueSelection: [selectStart, selectStart]
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
        const value = `${node?.path || config.homeDirectory}/`;
        const selectStart = value.length + 1;
        const fullName = await vscode.window.showInputBox({
          prompt: t(`ifsBrowser.createStreamfile.prompt`),
          value: value,
          valueSelection: [selectStart, selectStart]
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

    vscode.commands.registerCommand(`code-for-ibmi.uploadStreamfile`, async (node: IFSDirectoryItem, files?: vscode.Uri[]) => {
      const connection = instance.getConnection();
      const config = instance.getConfig();

      if (config && connection) {
        const root = node?.path || config.homeDirectory;

        const chosenFiles = files || await showOpenDialog();

        const filesToUpload: { local: string; remote: string; }[] = [];
        const directoriesToUpload: vscode.Uri[] = [];
        if (chosenFiles) {
          for (const uri of chosenFiles) {
            if ((await vscode.workspace.fs.stat(uri)).type === FileType.Directory) {
              directoriesToUpload.push(uri);
            }
            else {
              filesToUpload.push({
                local: uri.fsPath,
                remote: path.posix.join(root, path.basename(uri.fsPath))
              })
            }
          }
        }

        if (filesToUpload.length || directoriesToUpload.length) {
          await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: t('ifsBrowser.uploadStreamfile.process.uploading'),
            cancellable: false
          }, async (progress) => {
            try {
              if (filesToUpload.length) {
                progress.report({ message: t('ifsBrowser.uploadStreamfile.process.uploading.files', filesToUpload.length) });
                await connection.uploadFiles(filesToUpload, { concurrency: 5 });
              }

              if (directoriesToUpload.length) {
                for (const directory of directoriesToUpload) {
                  const name = path.basename(directory.fsPath);
                  progress.report({ message: t('ifsBrowser.uploadStreamfile.process.uploading.directory', name) })
                  await connection.uploadDirectory(directory, path.posix.join(root, name), { concurrency: 5 })
                }
              }

              if (GlobalConfiguration.get(`autoRefresh`)) {
                ifsBrowser.refresh(node);
              }
              vscode.window.showInformationMessage(t(`ifsBrowser.uploadStreamfile.uploadedFiles`));
            } catch (err) {
              vscode.window.showErrorMessage(t(`ifsBrowser.uploadStreamfile.errorMessage`, err));
            }
          });
        }
        else {
          vscode.window.showInformationMessage(t(`ifsBrowser.uploadStreamfile.noFilesSelected`));
        }
      }
    }),

    vscode.commands.registerCommand(`code-for-ibmi.deleteIFS`, async (singleItem: IFSItem, items?: IFSItem[]) => {
      const connection = instance.getConnection();
      const config = instance.getConfig();
      if (connection && config) {
        if (items || singleItem) {
          items = (items || [singleItem]).filter(reduceIFSPath);
        }
        else {
          items = (ifsTreeViewer.selection.filter(selected => selected instanceof IFSItem) as IFSItem[]).filter(reduceIFSPath);
        }

        if (items && items.length) {
          if (!items.find(n => isProtected(n.path))) {
            let deletionConfirmed = false;
            const message = items.length === 1 ? t(`ifsBrowser.deleteIFS.warningMessage`, items[0].path) : t(`ifsBrowser.deleteIFS.multi.warningMessage`, items.length);
            const detail = items.length === 1 ? undefined : items.map(i => `- ${i.path}`).join("\n");
            if (await vscode.window.showWarningMessage(message, { modal: true, detail }, t(`Yes`))) {
              const toBeDeleted: string[] = [];
              for (const item of items) {
                if ((GlobalConfiguration.get(`safeDeleteMode`)) && item.file.type === `directory`) { //Check if path is directory
                  const dirName = path.basename(item.path)  //Get the name of the directory to be deleted

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
                  // Do not delete a file if one of its parent directory is going to be deleted
                  deletionConfirmed = true;
                }

                if (deletionConfirmed) {
                  toBeDeleted.push(item.path);
                }
              }

              try {
                const removeResult = await vscode.window.withProgress({ title: t('ifsBrowser.deleteIFS.progress', toBeDeleted.length), location: vscode.ProgressLocation.Notification }, async () => {
                  return await connection.sendCommand({ command: `rm -rf ${toBeDeleted.map(path => Tools.escapePath(path)).join(" ")}` });
                });
                if (removeResult.code !== 0) {
                  throw removeResult.stderr;
                }
                if (GlobalConfiguration.get(`autoRefresh`)) {
                  items.map(item => item.parent)
                    .filter(Tools.distinct)
                    .forEach(async parent => parent?.refresh?.());
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
            vscode.window.showErrorMessage(t(`ifsBrowser.deleteIFS.dirNotAllowed`, items.filter(n => isProtected(n.path)).map(n => n.path).join(`\n`)));
          }
        }
      }
    }),

    vscode.commands.registerCommand(`code-for-ibmi.moveIFS`, async (node: IFSItem) => {
      // Ensure that the file has a defined uri
      if (!node.resourceUri) {
        vscode.window.showErrorMessage(t("ifsBrowser.moveIFS.errorMessage", t(String(node.contextValue)), t("file.path.not.parsed")));
        return;
      }
      // Check if the streamfile is currently open in an editor tab
      const oldFileTabs = Tools.findUriTabs(node.resourceUri);
      if (oldFileTabs.find(tab => tab.isDirty)) {
        vscode.window.showErrorMessage(t("ifsBrowser.moveIFS.errorMessage", t(String(node.contextValue)), t("file.unsaved.changes")));
        return;
      }
      const connection = instance.getConnection();
      const config = instance.getConfig();
      if (config && connection) {
        const homeDirectory = config.homeDirectory;
        const target = await vscode.window.showInputBox({
          prompt: t(`ifsBrowser.moveIFS.prompt`),
          value: node.path,
          valueSelection: [path.posix.dirname(node.path).length + 1, node.path.length]
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
            // If the file was open in any editor tabs prior to the renaming/movement,
            // refresh those tabs to reflect the new file path/name.
            // (Directly modifying the label or uri of an open tab is apparently not
            // possible with the current VS Code API, so refresh the tab by closing
            // it and then opening a new one at the new uri.)
            oldFileTabs.forEach((tab) => {
              vscode.window.tabGroups.close(tab).then(() => {
                vscode.commands.executeCommand(`code-for-ibmi.openEditable`, targetPath);
              })
            })

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
          value: node.path.endsWith(`/`) ? node.path.substring(0, node.path.length - 1) : node.path,
          valueSelection: [path.posix.dirname(node.path).length + 1, node.path.length]
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

    vscode.commands.registerCommand(`code-for-ibmi.downloadStreamfile`, async (node: IFSItem, nodes?: IFSItem[]) => {
      const ibmi = instance.getConnection();
      if (ibmi) {
        const items = (nodes || [node]).filter(reduceIFSPath);
        const saveIntoDirectory = items.length > 1 || items[0].file.type === "directory";
        let downloadLocation: string | undefined;
        if (saveIntoDirectory) {
          downloadLocation = (await vscode.window.showOpenDialog({
            canSelectMany: false,
            canSelectFiles: false,
            canSelectFolders: true,
            defaultUri: vscode.Uri.file(ibmi.getLastDownloadLocation())
          }))?.[0]?.path;
        }
        else {
          const remoteFilepath = path.join(ibmi.getLastDownloadLocation(), path.basename(node.path));
          downloadLocation = (await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(remoteFilepath),
            filters: { 'Streamfile': [extname(node.path).substring(1) || '*'] }
          }))?.path;
        }

        if (downloadLocation) {
          await ibmi.setLastDownloadLocation(saveIntoDirectory ? downloadLocation : dirname(downloadLocation));
          const increment = 100 / items.length;
          window.withProgress({ title: t('ifsBrowser.downloadStreamfile.downloading'), location: vscode.ProgressLocation.Notification }, async (task) => {
            try {
              for (const item of items) {
                const targetPath = item.path;
                task.report({ message: targetPath, increment });
                if (saveIntoDirectory) {
                  const target = path.join(Tools.fixWindowsPath(downloadLocation!), path.basename(targetPath));
                  if (item.file.type === "directory") {
                    let proceed = !existsSync(target);
                    if (!proceed) {
                      if (await vscode.window.showWarningMessage(t('ifsBrowser.downloadStreamfile.overwrite', target), { modal: true }, t("Yes"))) {
                        rmdirSync(target, { recursive: true });
                        proceed = true;
                      }
                    }

                    if (proceed) {
                      mkdirSync(target, { recursive: true });
                      await ibmi.downloadDirectory(target, targetPath, { concurrency: 5 });
                    }
                  }
                  else {
                    if (!existsSync(target) || await vscode.window.showWarningMessage(t('ask.overwrite', target), { modal: true }, t("Yes"))) {
                      await ibmi.downloadFile(target, targetPath);
                    }
                  }
                }
                else {
                  await ibmi.downloadFile(downloadLocation!, targetPath);
                }
              }
              vscode.window.showInformationMessage(t(`ifsBrowser.downloadStreamfile.complete`));
            }
            catch (e) {
              vscode.window.showErrorMessage(t(`ifsBrowser.downloadStreamfile.errorMessage`, e));
            }
          });
        }
      }
    }),

    vscode.commands.registerCommand(`code-for-ibmi.ifs.copyPath`, async (node: IFSItem) => {
      await vscode.env.clipboard.writeText(node.path);
    }),

    vscode.commands.registerCommand(`code-for-ibmi.searchIFSBrowser`, async() => {
        vscode.commands.executeCommand('ifsBrowser.focus');
        vscode.commands.executeCommand('list.find');
    })
  )
}

vscode.commands.registerCommand(`code-for-ibmi.ifs.toggleShowHiddenFiles`, async function () {
  const config = instance.getConfig();
  if (config) {
    config.showHiddenFiles = !config.showHiddenFiles;
    await ConnectionConfiguration.update(config);
    vscode.commands.executeCommand("code-for-ibmi.refreshIFSBrowser");
  }
});

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

async function showOpenDialog() {
  const openType = (await vscode.window.showQuickPick([t("ifsBrowser.uploadStreamfile.select.type.folders"), t("ifsBrowser.uploadStreamfile.select.type.files")], { title: t("ifsBrowser.uploadStreamfile.select.type.title") }));
  if (openType) {
    return vscode.window.showOpenDialog({
      defaultUri: vscode.Uri.file(os.homedir()),
      canSelectMany: true,
      ...openType === t("ifsBrowser.uploadStreamfile.select.type.folders") ? {
        canSelectFolders: true,
        canSelectFiles: false
      } : {
        canSelectFolders: false,
        canSelectFiles: true
      }
    })
  }
}

/**
 * Filters the content of an IFSItem array to keep only items whose parent are not in the array
 */
function reduceIFSPath(item: IFSItem, index: number, array: IFSItem[]) {
  return !array.filter(i => i.file.type === "directory" && i !== item).some(folder => item.file.path.startsWith(folder.file.path));
}