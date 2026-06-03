"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ShortcutDecorationProvider = exports.initializeIFSBrowser = void 0;
const os_1 = __importDefault(require("os"));
const path_1 = __importStar(require("path"));
const vscode_1 = __importStar(require("vscode"));
const fs_1 = require("fs");
const IBMi_1 = __importDefault(require("../../api/IBMi"));
const Search_1 = require("../../api/Search");
const Tools_1 = require("../../api/Tools");
const instantiate_1 = require("../../instantiate");
const typings_1 = require("../../typings");
const Tools_2 = require("../Tools");
const types_1 = require("../types");
const PROTECTED_DIRS = /^(\/|\/QOpenSys|\/QSYS\.LIB|\/QDLS|\/QOPT|\/QNTC|\/QFileSvr\.400|\/QIBM|\/QSR|\/QTCPTMM|\/bin|\/dev|\/home|\/tmp|\/usr|\/var)$/i;
const ALWAYS_SHOW_FILES = /^(\.gitignore|\.vscode|\.deployignore)$/i;
const getDragDropBehavior = () => IBMi_1.default.connectionManager.get(`IfsBrowser.DragAndDropDefaultBehavior`) || "ask";
function isProtected(path) {
    return PROTECTED_DIRS.test(path) || instantiate_1.instance.getConnection()?.getContent().isProtectedPath(path);
}
function alwaysShow(name) {
    return ALWAYS_SHOW_FILES.test(name);
}
class IFSBrowser {
    emitter = new vscode_1.default.EventEmitter();
    onDidChangeTreeData = this.emitter.event;
    refresh(target) {
        this.emitter.fire(target);
    }
    getTreeItem(element) {
        return element;
    }
    getChildren(element) {
        return element?.getChildren?.() || this.getShortCuts();
    }
    getShortCuts() {
        return instantiate_1.instance.getConnection()?.getConfig().ifsShortcuts.map(directory => new IFSShortcutItem(directory)) || [];
    }
    getParent(item) {
        return item.parent;
    }
    async moveShortcut(shortcut, direction) {
        const connection = instantiate_1.instance.getConnection();
        if (connection) {
            const config = connection.getConfig();
            const shortcuts = config.ifsShortcuts;
            const moveDir = shortcut?.path?.trim();
            if (moveDir) {
                try {
                    const inx = shortcuts.indexOf(moveDir);
                    if (inx >= 0 && inx < shortcuts.length) {
                        shortcuts.splice(inx, 1);
                        let newPosition;
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
                        await IBMi_1.default.connectionManager.update(config);
                        if (IBMi_1.default.connectionManager.get(`autoRefresh`)) {
                            this.refresh();
                        }
                    }
                }
                catch (e) {
                    console.log(e);
                }
            }
        }
    }
}
class IFSItem extends types_1.BrowserItem {
    file;
    sort = { order: "name", ascending: true };
    path;
    constructor(file, parameters) {
        super(file.name, parameters);
        this.file = file;
        this.path = file.path;
        this.tooltip = Tools_2.VscodeTools.ifsFileToToolTip(this.path, file);
    }
    sortBy(sort) {
        if (this.sort.order !== sort.order) {
            this.sort.order = sort.order;
            this.sort.ascending = true;
        }
        else {
            this.sort.ascending = !this.sort.ascending;
        }
        this.description = `(sort: ${sort.order} ${sort.ascending ? `🔼` : `🔽`})`;
        this.reveal({ expand: true });
        this.refresh();
    }
    async refresh() {
        vscode_1.default.commands.executeCommand(`code-for-ibmi.refreshIFSBrowserItem`, this);
    }
    reveal(options) {
        return vscode_1.default.commands.executeCommand(`code-for-ibmi.revealInIFSBrowser`, this, options);
    }
}
class IFSFileItem extends IFSItem {
    ifsParent;
    constructor(file, ifsParent) {
        super(file, { parent: ifsParent });
        this.ifsParent = ifsParent;
        this.contextValue = "streamfile";
        this.iconPath = vscode_1.default.ThemeIcon.File;
        this.resourceUri = vscode_1.default.Uri.parse(this.path).with({ scheme: `streamfile` });
        this.command = {
            command: "code-for-ibmi.openWithDefaultMode",
            title: `Open Streamfile`,
            arguments: [{ path: this.path }]
        };
    }
    sortBy(sort) {
        this.ifsParent.sortBy(sort);
    }
}
class IFSDirectoryItem extends IFSItem {
    constructor(file, parent) {
        super(file, { state: vscode_1.default.TreeItemCollapsibleState.Collapsed, parent });
        const protectedDir = isProtected(this.file.path);
        this.contextValue = `directory${protectedDir ? `_protected` : ``}`;
        this.iconPath = protectedDir ? new vscode_1.default.ThemeIcon("lock-small") : vscode_1.default.ThemeIcon.Folder;
    }
    async getChildren() {
        const connection = instantiate_1.instance.getConnection();
        if (connection) {
            ;
            const content = connection.getContent();
            const config = connection.getConfig();
            try {
                const showHidden = config.showHiddenFiles;
                const filterIFSFile = (file, type) => file.type === type && (showHidden || !file.name.startsWith(`.`) || alwaysShow(file.name));
                const objects = await content.getFileList(this.path, this.sort, handleFileListErrors);
                const directories = objects.filter(f => filterIFSFile(f, "directory"));
                const streamFiles = objects.filter(f => filterIFSFile(f, "streamfile"));
                await storeIFSList(this.path, streamFiles.map(o => o.name));
                return [...directories.map(directory => new IFSDirectoryItem(directory, this)),
                    ...streamFiles.map(file => new IFSFileItem(file, this))];
            }
            catch (e) {
                console.log(e);
                vscode_1.default.window.showErrorMessage(e.message || String(e));
                return [new ErrorItem(e)];
            }
        }
        return [];
    }
}
class IFSShortcutItem extends IFSDirectoryItem {
    shortcut;
    constructor(shortcut) {
        super({ name: shortcut, path: shortcut, type: "directory" });
        this.shortcut = shortcut;
        const protectedDir = isProtected(this.file.path);
        this.contextValue = `shortcut${protectedDir ? `_protected` : ``}`;
        this.iconPath = new vscode_1.default.ThemeIcon(protectedDir ? "lock-small" : "folder-library");
        this.tooltip = ``;
        this.resourceUri = vscode_1.Uri.parse(`shortcut:${shortcut}`);
    }
}
class ErrorItem extends types_1.BrowserItem {
    constructor(error) {
        super(vscode_1.l10n.t(`Error loading objects.`));
        this.description = error.message;
    }
}
class IFSBrowserDragAndDrop {
    dragMimeTypes = [typings_1.URI_LIST_MIMETYPE, typings_1.IFS_BROWSER_MIMETYPE];
    dropMimeTypes = [typings_1.URI_LIST_MIMETYPE, typings_1.IFS_BROWSER_MIMETYPE, typings_1.OBJECT_BROWSER_MIMETYPE];
    handleDrag(source, dataTransfer, token) {
        dataTransfer.set(typings_1.IFS_BROWSER_MIMETYPE, new vscode_1.default.DataTransferItem(source));
        dataTransfer.set(typings_1.URI_LIST_MIMETYPE, new vscode_1.default.DataTransferItem(source.filter(item => item.file.type === "streamfile")
            .map(item => item.resourceUri)
            .join(typings_1.URI_LIST_SEPARATOR)));
    }
    handleDrop(target, dataTransfer, token) {
        if (target) {
            const toDirectory = (target.file.type === "streamfile" ? target.parent : target);
            const ifsBrowserItems = dataTransfer.get(typings_1.IFS_BROWSER_MIMETYPE);
            if (ifsBrowserItems) {
                this.moveOrCopyItems(ifsBrowserItems.value, toDirectory);
            }
            else {
                const explorerItems = dataTransfer.get(typings_1.URI_LIST_MIMETYPE);
                if (explorerItems?.value) {
                    //URI_LIST_MIMETYPE Mime type is a string with `toString()`ed Uris separated by `\r\n`.
                    const uris = String(explorerItems.value).split(typings_1.URI_LIST_SEPARATOR).map(uri => vscode_1.default.Uri.parse(uri));
                    if (uris.at(0)?.scheme === "member") {
                        this.copyMembers(uris, toDirectory);
                    }
                    else {
                        vscode_1.default.commands.executeCommand(`code-for-ibmi.uploadStreamfile`, toDirectory, uris);
                    }
                }
            }
        }
    }
    async moveOrCopyItems(ifsBrowserItems, toDirectory) {
        const connection = instantiate_1.instance.getConnection();
        ifsBrowserItems = ifsBrowserItems.filter(item => item.path !== toDirectory.path && (item.parent && item.parent instanceof IFSItem && item.parent.path !== toDirectory.path));
        if (connection && ifsBrowserItems.length) {
            const dndBehavior = getDragDropBehavior();
            let action;
            if (dndBehavior === "ask") {
                const copy = vscode_1.l10n.t(`Copy`);
                const move = vscode_1.l10n.t(`Move`);
                const answer = await vscode_1.default.window.showInformationMessage(vscode_1.l10n.t(`Do you want to copy or move the selection to {0}?`, toDirectory.path), { modal: true }, copy, move);
                if (answer) {
                    action = answer === copy ? "copy" : "move";
                }
            }
            else {
                action = dndBehavior;
            }
            if (action) {
                let result;
                const froms = ifsBrowserItems.map(item => item.path);
                const to = toDirectory.path;
                switch (action) {
                    case "copy":
                        result = await connection.getContent().copy(froms, to);
                        break;
                    case "move":
                        result = await await connection.getContent().move(froms, to);
                        ifsBrowserItems.map(item => item.parent)
                            .filter(Tools_1.Tools.distinct)
                            .forEach(folder => folder?.refresh?.());
                        toDirectory.reveal({ focus: true });
                        break;
                }
                if (result.code === 0) {
                    toDirectory.refresh();
                }
                else {
                    const error = action === "copy" ? vscode_1.l10n.t("Failed to copy selection to {0}: {1}", toDirectory.path, result.stderr) :
                        vscode_1.l10n.t("Failed to move selection to {0}: {1}", toDirectory.path, result.stderr);
                    vscode_1.default.window.showErrorMessage(error);
                }
            }
        }
    }
    async copyMembers(uris, toDirectory) {
        const connection = instantiate_1.instance.getConnection();
        if (connection && uris?.length) {
            try {
                for (const uri of uris) {
                    const member = connection.parserMemberPath(uri.path);
                    const command = `CPYTOSTMF FROMMBR('${Tools_1.Tools.qualifyPath(member.library, member.file, member.name, member.asp)}') TOSTMF('${toDirectory.path}/${member.basename.toLocaleLowerCase()}') STMFCCSID(1208) ENDLINFMT(*LF)`;
                    const result = await connection.runCommand({
                        command: command,
                        noLibList: true
                    });
                    if (result.code !== 0) {
                        throw (vscode_1.l10n.t(`Error copying member(s) to {0}: {1}`, toDirectory.path, result.stderr));
                    }
                }
                ;
                vscode_1.default.window.showInformationMessage(vscode_1.l10n.t(`{0} member(s) copied to streamfile(s) in {1}.`, uris.length, toDirectory.path));
                toDirectory.refresh();
            }
            catch (e) {
                vscode_1.default.window.showErrorMessage(e || e.text);
            }
        }
    }
}
function initializeIFSBrowser(context) {
    const ifsBrowser = new IFSBrowser();
    const ifsTreeViewer = vscode_1.default.window.createTreeView(`ifsBrowser`, {
        treeDataProvider: ifsBrowser,
        showCollapseAll: true,
        canSelectMany: true,
        dragAndDropController: new IFSBrowserDragAndDrop()
    });
    const shortcutDecorationProvider = new ShortcutDecorationProvider();
    const getSelectedItems = (node) => node ? Array.isArray(node) ? node : [node] : ifsTreeViewer.selection;
    context.subscriptions.push(ifsTreeViewer, vscode_1.window.registerFileDecorationProvider(shortcutDecorationProvider), vscode_1.default.commands.registerCommand(`code-for-ibmi.refreshIFSBrowser`, () => {
        ifsBrowser.refresh();
        shortcutDecorationProvider.refresh();
    }), vscode_1.default.commands.registerCommand(`code-for-ibmi.refreshIFSBrowserItem`, (item) => ifsBrowser.refresh(item)), vscode_1.default.commands.registerCommand(`code-for-ibmi.revealInIFSBrowser`, async (item, options) => {
        ifsTreeViewer.reveal(item, options);
    }), vscode_1.default.commands.registerCommand(`code-for-ibmi.sortIFSFilesByName`, (item) => item.sortBy({ order: "name" })), vscode_1.default.commands.registerCommand(`code-for-ibmi.sortIFSFilesByDate`, (item) => item.sortBy({ order: "date" })), vscode_1.default.commands.registerCommand(`code-for-ibmi.changeWorkingDirectory`, async (node) => {
        const connection = instantiate_1.instance.getConnection();
        if (connection) {
            const config = connection.getConfig();
            const homeDirectory = config.homeDirectory;
            const newDirectory = node?.path || await vscode_1.default.window.showInputBox({
                prompt: vscode_1.l10n.t(`Changing working directory`),
                value: homeDirectory
            });
            try {
                if (newDirectory && newDirectory !== homeDirectory) {
                    config.homeDirectory = newDirectory;
                    await IBMi_1.default.connectionManager.update(config);
                    vscode_1.default.window.showInformationMessage(vscode_1.l10n.t(`Working directory changed to {0}.`, newDirectory));
                }
            }
            catch (e) {
                console.log(e);
            }
        }
    }), vscode_1.default.commands.registerCommand(`code-for-ibmi.addIFSShortcut`, async (node) => {
        const connection = instantiate_1.instance.getConnection();
        if (connection) {
            const config = connection.getConfig();
            const content = connection.getContent();
            const newDirectory = (await vscode_1.default.window.showInputBox({
                prompt: vscode_1.l10n.t(`Path to IFS directory`),
                value: node ? node.path : undefined
            }))?.trim();
            try {
                if (newDirectory) {
                    const shortcuts = config.ifsShortcuts;
                    if (await content.isDirectory(newDirectory) !== true) {
                        throw (vscode_1.l10n.t(`{0} is not a directory.`, newDirectory));
                    }
                    else if (!shortcuts.includes(newDirectory)) {
                        shortcuts.push(newDirectory);
                        config.ifsShortcuts = shortcuts;
                        await IBMi_1.default.connectionManager.update(config);
                        if (config.autoSortIFSShortcuts) {
                            vscode_1.default.commands.executeCommand(`code-for-ibmi.sortIFSShortcuts`);
                        }
                        if (IBMi_1.default.connectionManager.get(`autoRefresh`)) {
                            ifsBrowser.refresh();
                        }
                    }
                }
            }
            catch (e) {
                vscode_1.default.window.showErrorMessage(vscode_1.l10n.t(`Error creating IFS shortcut! {0}`, e));
            }
        }
    }), vscode_1.default.commands.registerCommand(`code-for-ibmi.removeIFSShortcut`, async (node, nodes) => {
        const connection = instantiate_1.instance.getConnection();
        if (connection) {
            const config = connection.getConfig();
            const shortcuts = config.ifsShortcuts;
            const toBeRemoved = (nodes || [node]).map(n => n.path);
            try {
                if (toBeRemoved.length) {
                    config.ifsShortcuts = shortcuts.filter(path => !toBeRemoved.includes(path));
                    await IBMi_1.default.connectionManager.update(config);
                    if (IBMi_1.default.connectionManager.get(`autoRefresh`)) {
                        ifsBrowser.refresh();
                    }
                }
            }
            catch (e) {
                console.log(e);
            }
        }
    }), vscode_1.default.commands.registerCommand(`code-for-ibmi.sortIFSShortcuts`, async () => {
        const config = instantiate_1.instance.getConnection()?.getConfig();
        if (config) {
            try {
                config.ifsShortcuts.sort((a, b) => a.toLocaleLowerCase().localeCompare(b.toLocaleLowerCase()));
                await IBMi_1.default.connectionManager.update(config);
                if (IBMi_1.default.connectionManager.get(`autoRefresh`)) {
                    ifsBrowser.refresh();
                }
            }
            catch (e) {
                console.log(e);
            }
        }
    }), vscode_1.default.commands.registerCommand(`code-for-ibmi.moveIFSShortcutDown`, (node) => ifsBrowser.moveShortcut(node, "down")), vscode_1.default.commands.registerCommand(`code-for-ibmi.moveIFSShortcutUp`, (node) => ifsBrowser.moveShortcut(node, "up")), vscode_1.default.commands.registerCommand(`code-for-ibmi.moveIFSShortcutToTop`, (node) => ifsBrowser.moveShortcut(node, "top")), vscode_1.default.commands.registerCommand(`code-for-ibmi.moveIFSShortcutToBottom`, (node) => ifsBrowser.moveShortcut(node, "bottom")), vscode_1.default.commands.registerCommand(`code-for-ibmi.createDirectory`, async (node) => {
        const connection = instantiate_1.instance.getConnection();
        if (connection) {
            const config = connection.getConfig();
            const value = `${node?.path || config.homeDirectory}/`;
            const selectStart = value.length + 1;
            const fullName = await vscode_1.default.window.showInputBox({
                prompt: vscode_1.l10n.t(`Path of new folder`),
                value: value,
                valueSelection: [selectStart, selectStart]
            });
            if (fullName) {
                try {
                    await connection.sendCommand({ command: `mkdir ${Tools_1.Tools.escapePath(fullName)}` });
                    if (IBMi_1.default.connectionManager.get(`autoRefresh`)) {
                        ifsBrowser.refresh(node);
                        vscode_1.default.commands.executeCommand(`code-for-ibmi.refreshIFSBrowser`);
                    }
                }
                catch (e) {
                    vscode_1.default.window.showErrorMessage(vscode_1.l10n.t(`Error creating new directory! {0}`, e));
                }
            }
        }
    }), vscode_1.default.commands.registerCommand(`code-for-ibmi.createStreamfile`, async (node) => {
        const connection = instantiate_1.instance.getConnection();
        if (connection) {
            const config = connection.getConfig();
            const content = connection.getContent();
            const value = `${node?.path || config.homeDirectory}/`;
            const selectStart = value.length + 1;
            const fullName = await vscode_1.default.window.showInputBox({
                prompt: vscode_1.l10n.t(`Name of new streamfile`),
                value: value,
                valueSelection: [selectStart, selectStart]
            });
            if (fullName) {
                if (!await content.testStreamFile(fullName, "e") || await vscode_1.default.window.showWarningMessage(vscode_1.l10n.t("Streamfile {0} already exists. Do you want to overwrite it?", fullName), { modal: true }, vscode_1.l10n.t("Overwrite"))) {
                    try {
                        await content.createStreamFile(fullName);
                        vscode_1.default.commands.executeCommand(`code-for-ibmi.openEditable`, fullName);
                        vscode_1.default.window.showInformationMessage(vscode_1.l10n.t(`Created streamfile {0}.`, fullName));
                        if (IBMi_1.default.connectionManager.get(`autoRefresh`)) {
                            ifsBrowser.refresh(node);
                        }
                    }
                    catch (e) {
                        vscode_1.default.window.showErrorMessage(vscode_1.l10n.t(`Error creating new streamfile! {0}`, e));
                    }
                }
            }
        }
    }), vscode_1.default.commands.registerCommand(`code-for-ibmi.uploadStreamfile`, async (node, files) => {
        const connection = instantiate_1.instance.getConnection();
        if (connection) {
            const config = connection.getConfig();
            const root = node?.path || config.homeDirectory;
            const chosenFiles = files || await showOpenDialog();
            const filesToUpload = [];
            const directoriesToUpload = [];
            if (chosenFiles) {
                for (const uri of chosenFiles) {
                    if ((await vscode_1.default.workspace.fs.stat(uri)).type === vscode_1.FileType.Directory) {
                        directoriesToUpload.push(uri);
                    }
                    else {
                        filesToUpload.push({
                            local: uri.fsPath,
                            remote: path_1.default.posix.join(root, path_1.default.basename(uri.fsPath))
                        });
                    }
                }
            }
            if (filesToUpload.length || directoriesToUpload.length) {
                await vscode_1.default.window.withProgress({
                    location: vscode_1.default.ProgressLocation.Notification,
                    title: vscode_1.l10n.t(`Upload`),
                    cancellable: false
                }, async (progress) => {
                    try {
                        if (filesToUpload.length) {
                            progress.report({ message: vscode_1.l10n.t(`sending {0} file(s)...`, filesToUpload.length) });
                            await connection.getContent().uploadFiles(filesToUpload, { concurrency: 5 });
                        }
                        if (directoriesToUpload.length) {
                            for (const directory of directoriesToUpload) {
                                const name = path_1.default.basename(directory.fsPath);
                                progress.report({ message: vscode_1.l10n.t(`sending {0} directory...`, name) });
                                await connection.getContent().uploadDirectory(directory, path_1.default.posix.join(root, name), { concurrency: 5 });
                            }
                        }
                        if (IBMi_1.default.connectionManager.get(`autoRefresh`)) {
                            ifsBrowser.refresh(node);
                        }
                        vscode_1.default.window.showInformationMessage(vscode_1.l10n.t(`Upload completed.`));
                    }
                    catch (err) {
                        vscode_1.default.window.showErrorMessage(vscode_1.l10n.t(`Error uploading files! {0}`, err));
                    }
                });
            }
            else {
                vscode_1.default.window.showInformationMessage(vscode_1.l10n.t(`No files or folders selected for upload.`));
            }
        }
    }), vscode_1.default.commands.registerCommand(`code-for-ibmi.deleteIFS`, async (singleItem, items) => {
        const connection = instantiate_1.instance.getConnection();
        if (connection) {
            const config = connection.getConfig();
            const shortcuts = config.ifsShortcuts;
            if (items || singleItem) {
                items = (items || [singleItem]).filter(reduceIFSPath);
            }
            else {
                items = getSelectedItems(singleItem).filter(reduceIFSPath);
            }
            if (items && items.length) {
                if (!items.find(n => isProtected(n.path))) {
                    let deletionConfirmed = false;
                    const message = items.length === 1 ? vscode_1.l10n.t(`Are you sure you want to delete {0}?`, items[0].path) : vscode_1.l10n.t("Are you sure you want to delete the {0} selected files?", items.length);
                    const detail = items.length === 1 ? undefined : items.map(i => `- ${i.path}`).join("\n");
                    if (await vscode_1.default.window.showWarningMessage(message, { modal: true, detail }, vscode_1.l10n.t(`Yes`))) {
                        const toBeDeleted = [];
                        for (const item of items) {
                            if ((IBMi_1.default.connectionManager.get(`safeDeleteMode`)) && item.file.type === `directory`) { //Check if path is directory
                                const dirName = path_1.default.basename(item.path); //Get the name of the directory to be deleted
                                const deletionPrompt = vscode_1.l10n.t(`Once you delete the directory, it cannot be restored.
Please type "{0}" to confirm deletion.`, dirName);
                                const input = await vscode_1.default.window.showInputBox({
                                    placeHolder: dirName,
                                    prompt: deletionPrompt,
                                    validateInput: text => {
                                        return (text === dirName) ? null : deletionPrompt + vscode_1.l10n.t(` (Press "Escape" to cancel)`);
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
                            const removeResult = await vscode_1.default.window.withProgress({ title: vscode_1.l10n.t(`Deleting {0} element(s)...`, toBeDeleted.length), location: vscode_1.default.ProgressLocation.Notification }, async () => {
                                return await connection.sendCommand({ command: `rm -rf ${toBeDeleted.map(path => Tools_1.Tools.escapePath(path)).join(" ")}` });
                            });
                            if (removeResult.code !== 0) {
                                throw removeResult.stderr;
                            }
                            const deletedShortcuts = shortcuts.filter(path => toBeDeleted.includes(path));
                            if (deletedShortcuts.length) {
                                const message = deletedShortcuts.length === 1 ? vscode_1.l10n.t(`Do you also want to remove the IFS shortcut to the folder {0}?`, deletedShortcuts[0]) : vscode_1.l10n.t("Do you also want to remove the IFS shortcuts to the folders {0}?", deletedShortcuts.length);
                                const detail = deletedShortcuts.length === 1 ? undefined : deletedShortcuts.map(i => `- ${i}`).join("\n");
                                if (await vscode_1.default.window.showWarningMessage(message, { modal: true, detail }, vscode_1.l10n.t(`Yes`))) {
                                    config.ifsShortcuts = shortcuts.filter(path => !deletedShortcuts.includes(path));
                                }
                            }
                            if (IBMi_1.default.connectionManager.get(`autoRefresh`)) {
                                items.map(item => item.parent)
                                    .filter(Tools_1.Tools.distinct)
                                    .forEach(async (parent) => parent?.refresh?.());
                                vscode_1.default.commands.executeCommand(`code-for-ibmi.refreshIFSBrowser`);
                            }
                        }
                        catch (e) {
                            vscode_1.default.window.showErrorMessage(vscode_1.l10n.t(`Error deleting streamfile! {0}`, e));
                        }
                    }
                    else {
                        vscode_1.default.window.showInformationMessage(vscode_1.l10n.t(`Deletion canceled.`));
                    }
                }
                else {
                    vscode_1.default.window.showErrorMessage(vscode_1.l10n.t(`Unable to delete protected directories from the IFS Browser!
{0}`, items.filter(n => isProtected(n.path)).map(n => n.path).join(`\n`)));
                }
            }
        }
    }), vscode_1.default.commands.registerCommand(`code-for-ibmi.moveIFS`, async (node) => {
        const oldFileTabs = [];
        node = getSelectedItems(node).at(0);
        if (node) {
            const typeLabel = node.file.type === "streamfile" ? vscode_1.l10n.t("streamfile") : vscode_1.l10n.t("directory");
            if (node.file.type === "streamfile") {
                // Ensure that the file has a defined uri
                if (!node.resourceUri) {
                    vscode_1.default.window.showErrorMessage(vscode_1.l10n.t(`Error renaming/moving {0}! {1}`, typeLabel, vscode_1.l10n.t("The file path could not be parsed.")));
                    return;
                }
                // Check if the streamfile is currently open in an editor tab
                oldFileTabs.push(...Tools_2.VscodeTools.findUriTabs(node.resourceUri));
                if (oldFileTabs.find(tab => tab.isDirty)) {
                    vscode_1.default.window.showErrorMessage(vscode_1.l10n.t(`Error renaming/moving {0}! {1}`, typeLabel, vscode_1.l10n.t("The file has unsaved changes.")));
                    return;
                }
            }
            else {
                // Check if there are streamfiles in the directory which are currently open in an editor tab
                oldFileTabs.push(...Tools_2.VscodeTools.findUriTabs(node.file.path));
                if (oldFileTabs.find(tab => tab.isDirty)) {
                    vscode_1.default.window.showErrorMessage(vscode_1.l10n.t(`Error renaming/moving {0}! {1}`, typeLabel, vscode_1.l10n.t("The directory has file(s) with unsaved changes.")));
                    return;
                }
            }
            const connection = instantiate_1.instance.getConnection();
            if (connection) {
                const config = connection.getConfig();
                const homeDirectory = config.homeDirectory;
                const target = await vscode_1.default.window.showInputBox({
                    prompt: vscode_1.l10n.t(`Name of new path`),
                    value: node.path,
                    valueSelection: [path_1.default.posix.dirname(node.path).length + 1, node.path.length]
                });
                if (target) {
                    const targetPath = path_1.default.posix.isAbsolute(target) ? target : path_1.default.posix.join(homeDirectory, target);
                    try {
                        const moveResult = await connection.runCommand({ command: `mv ${Tools_1.Tools.escapePath(node.path)} ${Tools_1.Tools.escapePath(targetPath)}`, environment: "qsh" });
                        if (moveResult.code !== 0) {
                            throw moveResult.stderr;
                        }
                        if (IBMi_1.default.connectionManager.get(`autoRefresh`)) {
                            ifsBrowser.refresh();
                        }
                        let label;
                        if (path_1.default.posix.dirname(node.path) === path_1.default.posix.dirname(targetPath)) {
                            label = vscode_1.l10n.t("{0} was renamed to {1}.", Tools_1.Tools.escapePath(node.path), Tools_1.Tools.escapePath(targetPath));
                        }
                        else {
                            label = vscode_1.l10n.t("{0} was moved to {1}.", Tools_1.Tools.escapePath(node.path), Tools_1.Tools.escapePath(targetPath));
                        }
                        vscode_1.default.window.showInformationMessage(label);
                        // If the file was open in any editor tabs prior to the renaming/movement,
                        // refresh those tabs to reflect the new file path/name.
                        // (Directly modifying the label or uri of an open tab is apparently not
                        // possible with the current VS Code API, so refresh the tab by closing
                        // it and then opening a new one at the new uri.)
                        oldFileTabs.forEach((tab) => {
                            vscode_1.default.window.tabGroups.close(tab).then(() => {
                                const newTargetPath = tab.input.uri.path.replace(node.file.path, targetPath);
                                vscode_1.default.commands.executeCommand(`code-for-ibmi.openEditable`, newTargetPath);
                            });
                        });
                    }
                    catch (e) {
                        vscode_1.default.window.showErrorMessage(vscode_1.l10n.t(`Error renaming/moving {0}! {1}`, typeLabel, e));
                    }
                }
            }
        }
    }), vscode_1.default.commands.registerCommand(`code-for-ibmi.copyIFS`, async (node) => {
        const connection = instantiate_1.instance.getConnection();
        const oldFile = node.file;
        const oldUri = node.resourceUri;
        const oldIfsTabs = Tools_2.VscodeTools.findUriTabs(oldUri);
        if (oldIfsTabs.find(tab => tab.isDirty)) {
            const result = await vscode_1.default.window.showWarningMessage(vscode_1.default.l10n.t(`The stream file {0} has unsaved changes. The copied stream file will not include these changes. Do you want to continue?`, oldFile.name), { modal: true }, vscode_1.default.l10n.t("Yes"), vscode_1.default.l10n.t("No"));
            if (result === vscode_1.default.l10n.t("No")) {
                return;
            }
        }
        if (connection) {
            const config = connection.getConfig();
            const homeDirectory = config.homeDirectory;
            const target = await vscode_1.default.window.showInputBox({
                prompt: vscode_1.l10n.t(`Name of new path`),
                value: node.path.endsWith(`/`) ? node.path.substring(0, node.path.length - 1) : node.path,
                valueSelection: [path_1.default.posix.dirname(node.path).length + 1, node.path.length]
            });
            if (target) {
                const targetPath = target.startsWith(`/`) ? target : homeDirectory + `/` + target;
                try {
                    const result = await connection.getContent().copy(node.path, targetPath);
                    if (result.code !== 0) {
                        throw result.stderr;
                    }
                    if (IBMi_1.default.connectionManager.get(`autoRefresh`)) {
                        ifsBrowser.refresh();
                    }
                    vscode_1.default.window.showInformationMessage(vscode_1.l10n.t(`{0} was copied to {1}.`, Tools_1.Tools.escapePath(node.path), Tools_1.Tools.escapePath(targetPath)));
                }
                catch (e) {
                    const typeLabel = node.file.type === "streamfile" ? vscode_1.l10n.t("streamfile") : vscode_1.l10n.t("directory");
                    vscode_1.default.window.showErrorMessage(vscode_1.l10n.t(`Error copying {0}! {1}`, typeLabel, e));
                }
            }
        }
    }), vscode_1.default.commands.registerCommand(`code-for-ibmi.searchIFS`, async (node, nodes) => {
        const connection = instantiate_1.instance.getConnection();
        if (connection && connection.remoteFeatures.grep) {
            const config = connection.getConfig();
            const searchPaths = [];
            if (node) {
                (nodes || [node]).forEach(n => searchPaths.push(n.path));
            }
            else {
                const path = await vscode_1.default.window.showInputBox({
                    value: config.homeDirectory,
                    prompt: vscode_1.l10n.t(`Enter IFS directory to search`),
                    title: vscode_1.l10n.t(`Search directory`)
                });
                if (path) {
                    searchPaths.push(path);
                }
            }
            if (searchPaths.length) {
                const list = IBMi_1.default.GlobalStorage.getPreviousSearchTerms();
                const items = list.map(term => ({ label: term }));
                const listHeader = [
                    { label: vscode_1.l10n.t(`Previous search terms`), kind: vscode_1.default.QuickPickItemKind.Separator }
                ];
                const clearList = vscode_1.l10n.t(`$(trash) Clear list`);
                const clearListArray = [{ label: ``, kind: vscode_1.default.QuickPickItemKind.Separator }, { label: clearList }];
                const quickPick = vscode_1.default.window.createQuickPick();
                quickPick.items = items.length ? [...items, ...clearListArray] : [];
                quickPick.placeholder = items.length ? vscode_1.l10n.t(`Enter search term or select one of the previous search terms.`) : vscode_1.l10n.t("Enter search term.");
                quickPick.title = vscode_1.l10n.t(`Search`);
                quickPick.onDidChangeValue(() => {
                    if (!quickPick.value) {
                        quickPick.items = [...listHeader, ...items, ...clearListArray];
                    }
                    else if (!list.includes(quickPick.value)) {
                        quickPick.items = [{ label: quickPick.value },
                            ...listHeader,
                            ...items];
                    }
                });
                quickPick.onDidAccept(async () => {
                    const searchTerm = quickPick.activeItems[0].label;
                    if (searchTerm) {
                        if (searchTerm === clearList) {
                            IBMi_1.default.GlobalStorage.clearPreviousSearchTerms();
                            quickPick.items = [];
                            quickPick.placeholder = vscode_1.l10n.t(`Enter search term.`);
                            vscode_1.default.window.showInformationMessage(vscode_1.l10n.t(`Cleared list.`));
                            quickPick.show();
                        }
                        else {
                            quickPick.hide();
                            IBMi_1.default.GlobalStorage.addPreviousSearchTerm(searchTerm);
                            await doSearchInStreamfiles(searchTerm, searchPaths);
                        }
                    }
                });
                quickPick.onDidHide(() => quickPick.dispose());
                quickPick.show();
            }
        }
        else {
            vscode_1.default.window.showErrorMessage(vscode_1.l10n.t(`grep must be installed on the remote system for the IFS search.`));
        }
    }), vscode_1.default.commands.registerCommand(`code-for-ibmi.ifs.find`, async (node, nodes) => {
        const connection = instantiate_1.instance.getConnection();
        if (connection && connection.remoteFeatures.find) {
            const config = connection.getConfig();
            const findPaths = [];
            if (node) {
                (nodes || [node]).forEach(n => findPaths.push(n.path));
            }
            else {
                const path = await vscode_1.default.window.showInputBox({
                    value: config.homeDirectory,
                    prompt: vscode_1.l10n.t(`Enter IFS directory to find files in`),
                    title: vscode_1.l10n.t(`Find in directory`)
                });
                if (path) {
                    findPaths.push(path);
                }
            }
            if (findPaths.length) {
                const list = IBMi_1.default.GlobalStorage.getPreviousFindTerms();
                const items = list.map(term => ({ label: term }));
                const listHeader = [
                    { label: vscode_1.l10n.t("Previous find terms"), kind: vscode_1.default.QuickPickItemKind.Separator }
                ];
                const clearList = vscode_1.l10n.t(`$(trash) Clear list`);
                const clearListArray = [{ label: ``, kind: vscode_1.default.QuickPickItemKind.Separator }, { label: clearList }];
                const quickPick = vscode_1.default.window.createQuickPick();
                quickPick.items = items.length ? [...items, ...clearListArray] : [];
                quickPick.placeholder = items.length ? vscode_1.l10n.t(`Enter find term or select one of the previous find terms.`) : vscode_1.l10n.t("Enter find term.");
                quickPick.title = vscode_1.l10n.t(`Find {0}`, findPaths);
                quickPick.onDidChangeValue(() => {
                    if (!quickPick.value) {
                        quickPick.items = [...listHeader, ...items, ...clearListArray];
                    }
                    else if (!list.includes(quickPick.value)) {
                        quickPick.items = [{ label: quickPick.value },
                            ...listHeader,
                            ...items];
                    }
                });
                quickPick.onDidAccept(async () => {
                    const findTerm = quickPick.activeItems[0].label;
                    if (findTerm) {
                        if (findTerm === clearList) {
                            IBMi_1.default.GlobalStorage.clearPreviousFindTerms();
                            quickPick.items = [];
                            quickPick.placeholder = vscode_1.l10n.t(`Enter find term.`);
                            vscode_1.default.window.showInformationMessage(vscode_1.l10n.t(`Cleared list.`));
                            quickPick.show();
                        }
                        else {
                            quickPick.hide();
                            IBMi_1.default.GlobalStorage.addPreviousFindTerm(findTerm);
                            await doFindStreamfiles(findTerm, findPaths);
                        }
                    }
                });
                quickPick.onDidHide(() => quickPick.dispose());
                quickPick.show();
            }
        }
        else {
            vscode_1.default.window.showErrorMessage(vscode_1.l10n.t(`"findutils" must be installed on the remote system.`));
        }
    }), vscode_1.default.commands.registerCommand(`code-for-ibmi.downloadStreamfile`, async (node, nodes) => {
        const ibmi = instantiate_1.instance.getConnection();
        if (ibmi) {
            const items = (nodes || [node]).filter(reduceIFSPath);
            const saveIntoDirectory = items.length > 1 || items[0].file.type === "directory";
            let downloadLocationURI;
            if (saveIntoDirectory) {
                downloadLocationURI = (await vscode_1.default.window.showOpenDialog({
                    canSelectMany: false,
                    canSelectFiles: false,
                    canSelectFolders: true,
                    defaultUri: vscode_1.default.Uri.file(ibmi.getLastDownloadLocation())
                }))?.[0];
            }
            else {
                const remoteFilepath = path_1.default.join(ibmi.getLastDownloadLocation(), path_1.default.basename(node.path));
                downloadLocationURI = (await vscode_1.default.window.showSaveDialog({
                    defaultUri: vscode_1.default.Uri.file(remoteFilepath),
                    filters: { 'Streamfile': [(0, path_1.extname)(node.path).substring(1) || '*'] }
                }));
            }
            if (downloadLocationURI) {
                const downloadLocation = downloadLocationURI.path;
                await ibmi.setLastDownloadLocation(saveIntoDirectory ? downloadLocation : (0, path_1.dirname)(downloadLocation));
                const increment = 100 / items.length;
                vscode_1.window.withProgress({ title: vscode_1.l10n.t(`Downloading`), location: vscode_1.default.ProgressLocation.Notification }, async (task) => {
                    try {
                        for (const item of items) {
                            const targetPath = item.path;
                            task.report({ message: targetPath, increment });
                            if (saveIntoDirectory) {
                                const target = path_1.default.join(Tools_1.Tools.fixWindowsPath(downloadLocation), path_1.default.basename(targetPath));
                                if (item.file.type === "directory") {
                                    let proceed = !(0, fs_1.existsSync)(target);
                                    if (!proceed) {
                                        if (await vscode_1.default.window.showWarningMessage(vscode_1.l10n.t("{0} already exists.\nDo you want to replace it?", target), { modal: true }, vscode_1.l10n.t(`Yes`))) {
                                            (0, fs_1.rmdirSync)(target, { recursive: true });
                                            proceed = true;
                                        }
                                    }
                                    if (proceed) {
                                        (0, fs_1.mkdirSync)(target, { recursive: true });
                                        await ibmi.getContent().downloadDirectory(target, targetPath, { concurrency: 5 });
                                    }
                                }
                                else {
                                    if (!(0, fs_1.existsSync)(target) || await vscode_1.default.window.showWarningMessage(vscode_1.l10n.t(`{0} already exists.
Do you want to replace it?`, target), { modal: true }, vscode_1.l10n.t(`{0} already exists.
Do you want to replace it?`, target))) {
                                        await ibmi.getContent().downloadFile(target, targetPath);
                                    }
                                }
                            }
                            else {
                                await ibmi.getContent().downloadFile(downloadLocation, targetPath);
                            }
                        }
                        vscode_1.default.window.showInformationMessage(vscode_1.l10n.t(`Download complete`), vscode_1.l10n.t(`Open`))
                            .then(open => open ? vscode_1.default.commands.executeCommand('revealFileInOS', saveIntoDirectory ? vscode_1.default.Uri.joinPath(downloadLocationURI, path_1.default.basename(items[0].path)) : downloadLocationURI) : undefined);
                    }
                    catch (e) {
                        vscode_1.default.window.showErrorMessage(vscode_1.l10n.t(`Error downloading file(s): {0}`, String(e)));
                    }
                });
            }
        }
    }), vscode_1.default.commands.registerCommand(`code-for-ibmi.ifs.copyPath`, async (node) => {
        await vscode_1.default.env.clipboard.writeText(node.path);
    }), vscode_1.default.commands.registerCommand(`code-for-ibmi.searchIFSBrowser`, async () => {
        vscode_1.default.commands.executeCommand('ifsBrowser.focus');
        vscode_1.default.commands.executeCommand('list.find');
    }), vscode_1.default.commands.registerCommand(`code-for-ibmi.ifsBrowser.selection`, getSelectedItems));
}
exports.initializeIFSBrowser = initializeIFSBrowser;
vscode_1.default.commands.registerCommand(`code-for-ibmi.ifs.toggleShowHiddenFiles`, async function () {
    const config = instantiate_1.instance.getConnection()?.getConfig();
    if (config) {
        config.showHiddenFiles = !config.showHiddenFiles;
        await IBMi_1.default.connectionManager.update(config);
        vscode_1.default.commands.executeCommand("code-for-ibmi.refreshIFSBrowser");
    }
});
function handleFileListErrors(errors) {
    errors.forEach(error => vscode_1.default.window.showErrorMessage(error));
    vscode_1.default.window.showErrorMessage(vscode_1.l10n.t(`{0} {1} occurred while listing files.`, errors.length, errors.length > 1 ? vscode_1.l10n.t(`errors`) : vscode_1.l10n.t(`error`)));
}
function storeIFSList(path, list) {
    const storage = instantiate_1.instance.getStorage();
    if (storage) {
        const existingDirs = storage.getSourceList();
        existingDirs[path] = list;
        return storage.setSourceList(existingDirs);
    }
}
async function doSearchInStreamfiles(searchTerm, searchPaths) {
    try {
        const total = await vscode_1.default.window.withProgress({
            location: vscode_1.default.ProgressLocation.Notification,
            title: vscode_1.l10n.t(`Searching "{0}" in `, searchTerm),
        }, async (progress, cancel) => {
            const increment = 100 / searchPaths.length;
            let total = 0;
            let append = false;
            for (const searchPath of searchPaths) {
                if (cancel.isCancellationRequested) {
                    return total;
                }
                progress.report({
                    message: searchPath,
                    increment
                });
                const results = await Search_1.Search.searchIFS(instantiate_1.instance.getConnection(), searchPath, searchTerm);
                if (results) {
                    total += results.hits.length;
                    openIFSSearchResults(searchPath, results, append);
                    append = true;
                }
            }
            return total;
        });
        if (!total) {
            vscode_1.default.window.showInformationMessage(vscode_1.l10n.t(`No results found searching for "{0}".`, searchTerm));
        }
    }
    catch (e) {
        vscode_1.default.window.showErrorMessage(vscode_1.l10n.t(`Error searching streamfiles.`));
    }
}
async function doFindStreamfiles(findTerm, findPaths) {
    try {
        const total = await vscode_1.default.window.withProgress({
            location: vscode_1.default.ProgressLocation.Notification,
            title: vscode_1.l10n.t(`Finding filenames with "{0}" in`, findTerm),
        }, async (progress, cancel) => {
            const increment = 100 / findPaths.length;
            let total = 0;
            let append = false;
            for (const findPath of findPaths) {
                if (cancel.isCancellationRequested) {
                    return total;
                }
                progress.report({
                    message: findPath,
                    increment
                });
                const results = (await Search_1.Search.findIFS(instantiate_1.instance.getConnection(), findPath, findTerm));
                if (results) {
                    total += results.hits.length;
                    openIFSSearchResults(findPath, results, append);
                    append = true;
                }
            }
            return total;
        });
        if (!total) {
            vscode_1.default.window.showInformationMessage(vscode_1.l10n.t(`No results found finding filenames with "{0}".`, findTerm));
        }
    }
    catch (e) {
        vscode_1.default.window.showErrorMessage(vscode_1.l10n.t(`Error finding filenames.`));
    }
}
function openIFSSearchResults(searchPath, searchResults, appendResults) {
    searchResults.hits =
        searchResults.hits.map(a => ({ ...a, label: path_1.default.posix.relative(searchPath, a.path) }))
            .sort((a, b) => a.path.localeCompare(b.path));
    vscode_1.default.commands.executeCommand(`code-for-ibmi.setSearchResults`, searchResults, appendResults);
}
async function showOpenDialog() {
    const openType = (await vscode_1.default.window.showQuickPick([vscode_1.l10n.t(`Folders`), vscode_1.l10n.t(`Files`)], { title: vscode_1.l10n.t(`What do you want to upload?`) }));
    if (openType) {
        return vscode_1.default.window.showOpenDialog({
            defaultUri: vscode_1.default.Uri.file(os_1.default.homedir()),
            canSelectMany: true,
            ...openType === vscode_1.l10n.t(`Folders`) ? {
                canSelectFolders: true,
                canSelectFiles: false
            } : {
                canSelectFolders: false,
                canSelectFiles: true
            }
        });
    }
}
/**
 * Filters the content of an IFSItem array to keep only items whose parent are not in the array
 */
function reduceIFSPath(item, index, array) {
    return !array.filter(i => i.file.type === "directory" && i !== item).some(folder => item.file.path.startsWith(`${folder.file.path}/`));
}
class ShortcutDecorationProvider {
    _onDidChangeFileDecorations = new vscode_1.default.EventEmitter();
    onDidChangeFileDecorations = this._onDidChangeFileDecorations.event;
    provideFileDecoration(uri, token) {
        if (uri.scheme === 'shortcut') {
            return instantiate_1.instance.getConnection()?.getContent().isDirectory(uri.path).then(isFound => {
                if (!isFound) {
                    return {
                        badge: '⚠',
                        color: new vscode_1.ThemeColor('errorForeground'),
                        tooltip: vscode_1.l10n.t(`Directory does not exist.`)
                    };
                }
                return undefined;
            });
        }
    }
    refresh(uri) {
        this._onDidChangeFileDecorations.fire(uri);
    }
}
exports.ShortcutDecorationProvider = ShortcutDecorationProvider;
//# sourceMappingURL=ifsBrowser.js.map