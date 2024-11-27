import os from "os";
import path, { dirname, extname } from "path";
import vscode, { FileType, l10n, window } from "vscode";

import { existsSync, mkdirSync, rmdirSync } from "fs";
import { ConnectionConfiguration, GlobalConfiguration } from "../api/Configuration";
import { SortOptions } from "../api/IBMiContent";
import { Search } from "../api/Search";
import { GlobalStorage } from "../api/Storage";
import { Tools } from "../api/Tools";
import { instance } from "../instantiate";
import { BrowserItem, BrowserItemParameters, FocusOptions, IFSFile, IFS_BROWSER_MIMETYPE, OBJECT_BROWSER_MIMETYPE, SearchHit, SearchResults, WithPath } from "../typings";

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
    this.tooltip = instance.getContent()?.ifsFileToToolTip(this.path, file);
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
      arguments: [{ path: this.path }]
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
    super(l10n.t(`Error loading objects.`))
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
        const copy = l10n.t(`Copy`);
        const move = l10n.t(`Move`);
        const answer = await vscode.window.showInformationMessage(l10n.t(`Do you want to copy or move the selection to {0}?`, toDirectory.path), { modal: true }, copy, move);
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
            result = await connection.sendCommand({ command: `cp -r ${ifsBrowserItems.map(item => Tools.escapePath(item.path)).join(" ")} ${Tools.escapePath(toDirectory.path)}` });
            break;

          case "move":
            result = await connection.sendCommand({ command: `mv ${ifsBrowserItems.map(item => Tools.escapePath(item.path)).join(" ")} ${Tools.escapePath(toDirectory.path)}` });
            ifsBrowserItems.map(item => item.parent)
              .filter(Tools.distinct)
              .forEach(folder => folder?.refresh?.());
            toDirectory.reveal({ focus: true })
            break;
        }

        if (result.code === 0) {
          toDirectory.refresh();
        } else {
          const error = action === "copy" ? l10n.t("Failed to copy selection to {0}: {1}", toDirectory.path, result.stderr) :
            l10n.t("Failed to move selection to {0}: {1}", toDirectory.path, result.stderr);
          vscode.window.showErrorMessage(error);
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
            throw (l10n.t(`Error copying member(s) to {0}: {1}`, toDirectory.path, result!.stderr));
          }
        };

        vscode.window.showInformationMessage(l10n.t(`{0} member(s) copied to streamfile(s) in {1}.`, memberUris.length, toDirectory.path));
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
          prompt: l10n.t(`Changing working directory`),
          value: homeDirectory
        });

        try {
          if (newDirectory && newDirectory !== homeDirectory) {
            config.homeDirectory = newDirectory;
            await ConnectionConfiguration.update(config);
            vscode.window.showInformationMessage(l10n.t(`Working directory changed to {0}.`, newDirectory));
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
          prompt: l10n.t(`Path to IFS directory`),
          value: node ? node.path : undefined
        }))?.trim();

        try {
          if (newDirectory) {
            const shortcuts = config.ifsShortcuts;
            if (await content.isDirectory(newDirectory) !== true) {
              throw (l10n.t(`{0} is not a directory.`, newDirectory));
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
        } catch (e: any) {
          vscode.window.showErrorMessage(l10n.t(`Error creating IFS shortcut! {0}`, e));
        }
      }
    }),

    vscode.commands.registerCommand(`code-for-ibmi.removeIFSShortcut`, async (node: IFSShortcutItem) => {
      const config = instance.getConfig();
      if (config) {
        const shortcuts = config.ifsShortcuts;
        const removeDir = (node.path || (await vscode.window.showQuickPick(shortcuts, {
          placeHolder: l10n.t(`Select IFS shortcut to remove`),
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
          prompt: l10n.t(`Path of new folder`),
          value: value,
          valueSelection: [selectStart, selectStart]
        });

        if (fullName) {
          try {
            await connection.sendCommand({ command: `mkdir ${Tools.escapePath(fullName)}` });

            if (GlobalConfiguration.get(`autoRefresh`)) {
              ifsBrowser.refresh(node);
            }

          } catch (e: any) {
            vscode.window.showErrorMessage(l10n.t(`Error creating new directory! {0}`, e));
          }
        }
      }
    }),

    vscode.commands.registerCommand(`code-for-ibmi.createStreamfile`, async (node?: IFSDirectoryItem) => {
      const config = instance.getConfig();
      const content = instance.getContent();
      if (config && content) {
        const value = `${node?.path || config.homeDirectory}/`;
        const selectStart = value.length + 1;
        const fullName = await vscode.window.showInputBox({
          prompt: l10n.t(`Name of new streamfile`),
          value: value,
          valueSelection: [selectStart, selectStart]
        });

        if (fullName) {
          try {
            vscode.window.showInformationMessage(l10n.t(`Creating streamfile {0}.`, fullName));
            await content.createStreamFile(fullName);
            vscode.commands.executeCommand(`code-for-ibmi.openEditable`, fullName);
            if (GlobalConfiguration.get(`autoRefresh`)) {
              ifsBrowser.refresh(node);
            }
            else {
              throw new Error("")
            }
          } catch (e: any) {
            vscode.window.showErrorMessage(l10n.t(`Error creating new streamfile! {0}`, e));
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
            title: l10n.t(`Upload`),
            cancellable: false
          }, async (progress) => {
            try {
              if (filesToUpload.length) {
                progress.report({ message: l10n.t(`sending {0} file(s)...`, filesToUpload.length) });
                await connection.getContent().uploadFiles(filesToUpload, { concurrency: 5 });
              }

              if (directoriesToUpload.length) {
                for (const directory of directoriesToUpload) {
                  const name = path.basename(directory.fsPath);
                  progress.report({ message: l10n.t(`sending {0} directory...`, name) })
                  await connection.getContent().uploadDirectory(directory, path.posix.join(root, name), { concurrency: 5 })
                }
              }

              if (GlobalConfiguration.get(`autoRefresh`)) {
                ifsBrowser.refresh(node);
              }
              vscode.window.showInformationMessage(l10n.t(`Upload completed.`));
            } catch (err: any) {
              vscode.window.showErrorMessage(l10n.t(`Error uploading files! {0}`, err));
            }
          });
        }
        else {
          vscode.window.showInformationMessage(l10n.t(`No files or folders selected for upload.`));
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
            const message = items.length === 1 ? l10n.t(`Are you sure you want to delete {0}?`, items[0].path) : l10n.t("Are you sure you want to delete the {0} selected files?", items.length);
            const detail = items.length === 1 ? undefined : items.map(i => `- ${i.path}`).join("\n");
            if (await vscode.window.showWarningMessage(message, { modal: true, detail }, l10n.t(`Yes`))) {
              const toBeDeleted: string[] = [];
              for (const item of items) {
                if ((GlobalConfiguration.get(`safeDeleteMode`)) && item.file.type === `directory`) { //Check if path is directory
                  const dirName = path.basename(item.path)  //Get the name of the directory to be deleted

                  const deletionPrompt = l10n.t(`Once you delete the directory, it cannot be restored.
Please type "{0}" to confirm deletion.`, dirName);
                  const input = await vscode.window.showInputBox({
                    placeHolder: dirName,
                    prompt: deletionPrompt,
                    validateInput: text => {
                      return (text === dirName) ? null : deletionPrompt + l10n.t(` (Press "Escape" to cancel)`);
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
                const removeResult = await vscode.window.withProgress({ title: l10n.t(`Deleting {0} element(s)...`, toBeDeleted.length), location: vscode.ProgressLocation.Notification }, async () => {
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
              } catch (e: any) {
                vscode.window.showErrorMessage(l10n.t(`Error deleting streamfile! {0}`, e));
              }
            }
            else {
              vscode.window.showInformationMessage(l10n.t(`Deletion canceled.`));
            }
          }
          else {
            vscode.window.showErrorMessage(l10n.t(`Unable to delete protected directories from the IFS Browser!
{0}`, items.filter(n => isProtected(n.path)).map(n => n.path).join(`\n`)));
          }
        }
      }
    }),

    vscode.commands.registerCommand(`code-for-ibmi.moveIFS`, async (node: IFSItem) => {
      const oldFileTabs: vscode.Tab[] = [];
      const typeLabel = node.file.type === "streamfile" ? l10n.t("streamfile") : l10n.t("directory");
      if (node.file.type === "streamfile") {
        // Ensure that the file has a defined uri
        if (!node.resourceUri) {
          vscode.window.showErrorMessage(l10n.t(`Error renaming/moving {0}! {1}`, typeLabel, l10n.t("The file path could not be parsed.")));
          return;
        }
        // Check if the streamfile is currently open in an editor tab
        oldFileTabs.push(...Tools.findUriTabs(node.resourceUri));
        if (oldFileTabs.find(tab => tab.isDirty)) {
          vscode.window.showErrorMessage(l10n.t(`Error renaming/moving {0}! {1}`, typeLabel, l10n.t("The file has unsaved changes.")));
          return;
        }
      } else {
        // Check if there are streamfiles in the directory which are currently open in an editor tab
        oldFileTabs.push(...Tools.findUriTabs(node.file.path));
        if (oldFileTabs.find(tab => tab.isDirty)) {
          vscode.window.showErrorMessage(l10n.t(`Error renaming/moving {0}! {1}`, typeLabel, l10n.t("The directory has file(s) with unsaved changes.")));
          return;
        }
      }
      const connection = instance.getConnection();
      const config = instance.getConfig();
      if (config && connection) {
        const homeDirectory = config.homeDirectory;
        const target = await vscode.window.showInputBox({
          prompt: l10n.t(`Name of new path`),
          value: node.path,
          valueSelection: [path.posix.dirname(node.path).length + 1, node.path.length]
        });

        if (target) {
          const targetPath = path.posix.isAbsolute(target) ? target : path.posix.join(homeDirectory, target);
          try {
            const moveResult = await connection.sendCommand({ command: `mv ${Tools.escapePath(node.path)} ${Tools.escapePath(targetPath)}` });
            if (moveResult.code !== 0) {
              throw moveResult.stderr;
            }

            if (GlobalConfiguration.get(`autoRefresh`)) {
              ifsBrowser.refresh();
            }
            let label;
            if (path.posix.dirname(node.path) === path.posix.dirname(targetPath)) {
              label = l10n.t("{0} was renamed to {1}.", Tools.escapePath(node.path), Tools.escapePath(targetPath));
            }
            else {
              label = l10n.t("{0} was moved to {1}.", Tools.escapePath(node.path), Tools.escapePath(targetPath));
            }

            vscode.window.showInformationMessage(label);
            // If the file was open in any editor tabs prior to the renaming/movement,
            // refresh those tabs to reflect the new file path/name.
            // (Directly modifying the label or uri of an open tab is apparently not
            // possible with the current VS Code API, so refresh the tab by closing
            // it and then opening a new one at the new uri.)
            oldFileTabs.forEach((tab) => {
              vscode.window.tabGroups.close(tab).then(() => {
                const newTargetPath = (tab.input as vscode.TabInputText).uri.path.replace(node.file.path, targetPath);
                vscode.commands.executeCommand(`code-for-ibmi.openEditable`, newTargetPath);
              })
            })

          } catch (e: any) {
            vscode.window.showErrorMessage(l10n.t(`Error renaming/moving {0}! {1}`, typeLabel, e));
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
          prompt: l10n.t(`Name of new path`),
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
            vscode.window.showInformationMessage(l10n.t(`{0} was copied to {1}.`, Tools.escapePath(node.path), Tools.escapePath(targetPath)));

          } catch (e: any) {
            const typeLabel = node.file.type === "streamfile" ? l10n.t("streamfile") : l10n.t("directory");
            vscode.window.showErrorMessage(l10n.t(`Error copying {0}! {1}`, typeLabel, e));
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
          prompt: l10n.t(`Enter IFS directory to search`),
          title: l10n.t(`Search directory`)
        });

        if (searchPath) {
          const list = GlobalStorage.get().getPreviousSearchTerms();
          const items: vscode.QuickPickItem[] = list.map(term => ({ label: term }));
          const listHeader = [
            { label: l10n.t(`Previous search terms`), kind: vscode.QuickPickItemKind.Separator }
          ];
          const clearList = l10n.t(`$(trash) Clear list`);
          const clearListArray: vscode.QuickPickItem[] = [{ label: ``, kind: vscode.QuickPickItemKind.Separator }, { label: clearList }];

          const quickPick = vscode.window.createQuickPick();
          quickPick.items = items.length ? [...items, ...clearListArray] : [];
          quickPick.placeholder = items.length ? l10n.t(`Enter search term or select one of the previous search terms.`) : l10n.t("Enter search term.");
          quickPick.title = l10n.t(`Search {0}`, searchPath);

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
                GlobalStorage.get().clearPreviousSearchTerms();
                quickPick.items = [];
                quickPick.placeholder = l10n.t(`Enter search term.`);
                vscode.window.showInformationMessage(l10n.t(`Cleared list.`));
                quickPick.show();
              } else {
                quickPick.hide();
                GlobalStorage.get().addPreviousSearchTerm(searchTerm);
                await doSearchInStreamfiles(searchTerm, searchPath);
              }
            }
          });

          quickPick.onDidHide(() => quickPick.dispose());
          quickPick.show();
        }
      } else {
        vscode.window.showErrorMessage(l10n.t(`grep must be installed on the remote system for the IFS search.`));
      }
    }),

    vscode.commands.registerCommand(`code-for-ibmi.ifs.find`, async (node?: IFSItem) => {
      const connection = instance.getConnection();
      const config = instance.getConfig();

      if (connection?.remoteFeatures.find && config) {
        const findPath = node?.path || await vscode.window.showInputBox({
          value: config.homeDirectory,
          prompt: l10n.t(`Enter IFS directory to find files in`),
          title: l10n.t(`Find in directory`)
        });

        if (findPath) {
          const list = GlobalStorage.get().getPreviousFindTerms();
          const items: vscode.QuickPickItem[] = list.map(term => ({ label: term }));
          const listHeader = [
            { label: l10n.t("Previous find terms"), kind: vscode.QuickPickItemKind.Separator }
          ];
          const clearList = l10n.t(`$(trash) Clear list`);
          const clearListArray: vscode.QuickPickItem[] = [{ label: ``, kind: vscode.QuickPickItemKind.Separator }, { label: clearList }];

          const quickPick = vscode.window.createQuickPick();
          quickPick.items = items.length ? [...items, ...clearListArray] : [];
          quickPick.placeholder = items.length ? l10n.t(`Enter find term or select one of the previous find terms.`) : l10n.t("Enter find term.");
          quickPick.title = l10n.t(`Find {0}`, findPath);

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
            const findTerm = quickPick.activeItems[0].label;
            if (findTerm) {
              if (findTerm === clearList) {
                GlobalStorage.get().clearPreviousFindTerms();
                quickPick.items = [];
                quickPick.placeholder = l10n.t(`Enter find term.`);
                vscode.window.showInformationMessage(l10n.t(`Cleared list.`));
                quickPick.show();
              } else {
                quickPick.hide();
                GlobalStorage.get().addPreviousFindTerm(findTerm);
                await doFindStreamfiles(findTerm, findPath);
              }
            }
          });

          quickPick.onDidHide(() => quickPick.dispose());
          quickPick.show();
        }
      } else {
        vscode.window.showErrorMessage(l10n.t(`"findutils" must be installed on the remote system.`));
      }
    }),

    vscode.commands.registerCommand(`code-for-ibmi.downloadStreamfile`, async (node: IFSItem, nodes?: IFSItem[]) => {
      const ibmi = instance.getConnection();
      if (ibmi) {
        const items = (nodes || [node]).filter(reduceIFSPath);
        const saveIntoDirectory = items.length > 1 || items[0].file.type === "directory";
        let downloadLocationURI: vscode.Uri | undefined;
        if (saveIntoDirectory) {
          downloadLocationURI = (await vscode.window.showOpenDialog({
            canSelectMany: false,
            canSelectFiles: false,
            canSelectFolders: true,
            defaultUri: vscode.Uri.file(ibmi.getLastDownloadLocation())
          }))?.[0];
        }
        else {
          const remoteFilepath = path.join(ibmi.getLastDownloadLocation(), path.basename(node.path));
          downloadLocationURI = (await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(remoteFilepath),
            filters: { 'Streamfile': [extname(node.path).substring(1) || '*'] }
          }));
        }

        if (downloadLocationURI) {
          const downloadLocation = downloadLocationURI.path;
          await ibmi.setLastDownloadLocation(saveIntoDirectory ? downloadLocation : dirname(downloadLocation));
          const increment = 100 / items.length;
          window.withProgress({ title: l10n.t(`Downloading`), location: vscode.ProgressLocation.Notification }, async (task) => {
            try {
              for (const item of items) {
                const targetPath = item.path;
                task.report({ message: targetPath, increment });
                if (saveIntoDirectory) {
                  const target = path.join(Tools.fixWindowsPath(downloadLocation!), path.basename(targetPath));
                  if (item.file.type === "directory") {
                    let proceed = !existsSync(target);
                    if (!proceed) {
                      if (await vscode.window.showWarningMessage(l10n.t("{0} already exists.\nDo you want to replace it?", target), { modal: true }, l10n.t(`Yes`))) {
                        rmdirSync(target, { recursive: true });
                        proceed = true;
                      }
                    }

                    if (proceed) {
                      mkdirSync(target, { recursive: true });
                      await ibmi.getContent().downloadDirectory(target, targetPath, { concurrency: 5 });
                    }
                  }
                  else {
                    if (!existsSync(target) || await vscode.window.showWarningMessage(l10n.t(`{0} already exists.
Do you want to replace it?`, target), { modal: true }, l10n.t(`{0} already exists.
Do you want to replace it?`, target))) {
                      await ibmi.getContent().downloadFile(target, targetPath);
                    }
                  }
                }
                else {
                  await ibmi.getContent().downloadFile(downloadLocation!, targetPath);
                }
              }
              vscode.window.showInformationMessage(l10n.t(`Download complete`), l10n.t(`Open`))
                .then(open => open ? vscode.commands.executeCommand('revealFileInOS', saveIntoDirectory ? vscode.Uri.joinPath(downloadLocationURI, path.basename(items[0].path)) : downloadLocationURI) : undefined);
            }
            catch (e: any) {
              vscode.window.showErrorMessage(l10n.t(`Error downloading file(s): {0}`, e));
            }
          });
        }
      }
    }),

    vscode.commands.registerCommand(`code-for-ibmi.ifs.copyPath`, async (node: IFSItem) => {
      await vscode.env.clipboard.writeText(node.path);
    }),

    vscode.commands.registerCommand(`code-for-ibmi.searchIFSBrowser`, async () => {
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
  vscode.window.showErrorMessage(l10n.t(`{0} {1} occurred while listing files.`, errors.length, errors.length > 1 ? l10n.t(`errors`) : l10n.t(`error`)));
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
      title: l10n.t(`Searching`),
    }, async progress => {
      progress.report({
        message: l10n.t(`"{0}" in {1}.`, searchTerm, searchPath)
      });
      const results = await Search.searchIFS(instance, searchPath, searchTerm);
      if (results?.hits.length) {
        openIFSSearchResults(searchPath, results);
      } else {
        vscode.window.showInformationMessage(l10n.t(`No results found searching for "{0}" in {1}.`, searchTerm, searchPath));
      }
    });

  } catch (e) {
    vscode.window.showErrorMessage(l10n.t(`Error searching streamfiles.`));
  }
}

async function doFindStreamfiles(findTerm: string, findPath: string) {
  try {
    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: l10n.t(`Finding`),
    }, async progress => {
      progress.report({
        message: l10n.t(`Finding filenames with "{0}" in {1}.`, findTerm, findPath)
      });
      const results = (await Search.findIFS(instance, findPath, findTerm));
      if (results?.hits.length) {
        openIFSSearchResults(findPath, results);
      } else {
        vscode.window.showInformationMessage(l10n.t(`No results found finding filenames with "{0}" in {1}.`, findTerm, findPath));
      }
    });

  } catch (e) {
    vscode.window.showErrorMessage(l10n.t(`Error finding filenames.`));
  }
}

function openIFSSearchResults(searchPath: string, searchResults: SearchResults) {
  searchResults.hits =
    searchResults.hits.map(a => ({ ...a, label: path.posix.relative(searchPath, a.path) }) as SearchHit)
      .sort((a, b) => a.path.localeCompare(b.path));
  vscode.commands.executeCommand(`code-for-ibmi.setSearchResults`, searchResults);
}

async function showOpenDialog() {
  const openType = (await vscode.window.showQuickPick([l10n.t(`Folders`), l10n.t(`Files`)], { title: l10n.t(`What do you want to upload?`) }));
  if (openType) {
    return vscode.window.showOpenDialog({
      defaultUri: vscode.Uri.file(os.homedir()),
      canSelectMany: true,
      ...openType === l10n.t(`Folders`) ? {
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