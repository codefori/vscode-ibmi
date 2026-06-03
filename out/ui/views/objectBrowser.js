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
exports.initializeObjectBrowser = void 0;
const fs_1 = __importStar(require("fs"));
const os_1 = __importDefault(require("os"));
const path_1 = __importStar(require("path"));
const vscode_1 = __importStar(require("vscode"));
const Filter_1 = require("../../api/Filter");
const IBMi_1 = __importDefault(require("../../api/IBMi"));
const Search_1 = require("../../api/Search");
const Tools_1 = require("../../api/Tools");
const QSysFs_1 = require("../../filesystems/qsys/QSysFs");
const instantiate_1 = require("../../instantiate");
const typings_1 = require("../../typings");
const filters_1 = require("../../webviews/filters");
const Tools_2 = require("../Tools");
const types_1 = require("../types");
const objectNamesLower = () => IBMi_1.default.connectionManager.get(`ObjectBrowser.showNamesInLowercase`);
const objectSortOrder = () => IBMi_1.default.connectionManager.get(`ObjectBrowser.sortObjectsByName`) ? `name` : `type`;
const correctCase = (value) => {
    ;
    if (objectNamesLower()) {
        return value.toLocaleLowerCase();
    }
    else {
        return value;
    }
};
//https://code.visualstudio.com/api/references/icons-in-labels
const objectIcons = {
    'FILE': `database`,
    'CMD': `terminal`,
    'MODULE': `extensions`,
    'PGM': `file-binary`,
    'DTAARA': `clippy`,
    'DTAQ': `list-ordered`,
    'JOBQ': `checklist`,
    'LIB': `library`,
    'MEDDFN': `save-all`,
    'OUTQ': `symbol-enum`,
    'PNLGRP': `book`,
    'SBSD': `server-process`,
    'SRVPGM': `file-submodule`,
    'USRSPC': `chrome-maximize`,
    '': `circle-large-outline`
};
class ObjectBrowserItem extends types_1.BrowserItem {
    filter;
    constructor(filter, label, params) {
        super(label, params);
        this.filter = filter;
    }
    async refresh() {
        vscode_1.default.commands.executeCommand(`code-for-ibmi.refreshObjectBrowserItem`, this);
    }
    reveal(options) {
        return vscode_1.default.commands.executeCommand(`code-for-ibmi.revealInObjectBrowser`, this, options);
    }
}
class ObjectBrowser {
    emitter = new vscode_1.default.EventEmitter();
    onDidChangeTreeData = this.emitter.event;
    async moveFilterInList(node, filterMovement) {
        const config = getConfig();
        if (config) {
            const filterName = node.filter.name;
            const objectFilters = config.objectFilters;
            const from = objectFilters.findIndex(filter => filter.name === filterName);
            let to;
            if (from === -1)
                throw `Filter ${filterName} is not found in list`;
            if (from === 0 && [`TOP`, `UP`].includes(filterMovement))
                throw `Filter ${filterName} is at top of list`;
            if (from === objectFilters.length && [`DOWN`, `BOTTOM`].includes(filterMovement))
                throw `Filter ${filterName} is at bottom of list`;
            switch (filterMovement) {
                case `TOP`:
                    to = 0;
                    break;
                case `UP`:
                    to = from - 1;
                    break;
                case `DOWN`:
                    to = from + 1;
                    break;
                case `BOTTOM`:
                    to = objectFilters.length;
                    break;
            }
            const filter = objectFilters[from];
            objectFilters.splice(from, 1);
            objectFilters.splice(to, 0, filter);
            config.objectFilters = objectFilters;
            await IBMi_1.default.connectionManager.update(config);
            this.autoRefresh();
        }
    }
    refresh(node) {
        this.emitter.fire(node);
    }
    autoRefresh(message) {
        const autoRefresh = IBMi_1.default.connectionManager.get(`autoRefresh`);
        if (autoRefresh) {
            if (message) {
                vscode_1.default.window.showInformationMessage(message);
            }
            this.refresh();
        }
        return autoRefresh;
    }
    getTreeItem(element) {
        return element;
    }
    getChildren(element) {
        return element?.getChildren?.() || this.getFilters();
    }
    getFilters() {
        const config = getConfig();
        const filters = config.objectFilters;
        if (filters.length) {
            return filters.map(filter => new ObjectBrowserFilterItem(filter));
        }
        else {
            return [new CreateFilterItem()];
        }
    }
    getParent(element) {
        return element.parent;
    }
    async resolveTreeItem(item, element, token) {
        if (element.getToolTip) {
            element.tooltip = await element.getToolTip();
        }
        return element;
    }
}
class CreateFilterItem extends types_1.BrowserItem {
    constructor() {
        super(`${vscode_1.default.l10n.t(`Create new filter`)}...`, { icon: "add" });
        this.command = {
            command: `code-for-ibmi.maintainFilter`,
            title: `Create new filter`
        };
    }
    getChildren() {
        return [];
    }
}
class ObjectBrowserFilterItem extends ObjectBrowserItem {
    library;
    constructor(filter) {
        super(filter, filter.name, { icon: filter.protected ? `lock-small` : '', state: vscode_1.default.TreeItemCollapsibleState.Collapsed });
        this.library = (0, Filter_1.parseFilter)(filter.library, filter.filterType).noFilter ? filter.library : '';
        this.contextValue = `filter${this.library ? "_library" : ''}${this.isProtected() ? `_readonly` : ``}`;
        this.description = `${filter.library}/${filter.object}/${filter.member}.${filter.memberType || `*`} (${filter.types.join(`, `)})`;
        this.tooltip = ``;
        if (this.library) {
            this.resourceUri = vscode_1.default.Uri.from({
                scheme: `object`,
                path: `/QSYS/${this.library}.LIB`,
            });
        }
    }
    isProtected() {
        return this.filter.protected;
    }
    async getChildren() {
        const libraryFilter = (0, Filter_1.parseFilter)(this.filter.library);
        if (libraryFilter.noFilter) {
            return await listObjects(this);
        }
        else {
            return (await getContent().getLibraries(this.filter))
                .map(object => {
                return object.sourceFile ? new ObjectBrowserSourcePhysicalFileItem(this, object) : new ObjectBrowserObjectItem(this, object);
            });
        }
    }
    toString() {
        return `${this.filter.name} (filter)`;
    }
    async delete() {
        const config = getConfig();
        const filter = this.filter;
        const index = config.objectFilters.findIndex(f => f.name === filter.name);
        if (index > -1) {
            config.objectFilters.splice(index, 1);
            await IBMi_1.default.connectionManager.update(config);
        }
        return true;
    }
}
class ObjectBrowserSourcePhysicalFileItem extends ObjectBrowserItem {
    object;
    sort = { order: "name", ascending: true };
    path;
    constructor(parent, object) {
        const type = object.type.startsWith(`*`) ? object.type.substring(1) : object.type;
        super(parent.filter, correctCase(object.name), { parent, icon: `file-directory`, state: vscode_1.default.TreeItemCollapsibleState.Collapsed });
        this.object = object;
        this.contextValue = `SPF${this.isProtected() ? `_readonly` : ``}`;
        this.updateDescription();
        this.path = [object.library, object.name].join(`/`);
        this.resourceUri = vscode_1.default.Uri.from({
            scheme: `object`,
            path: `/${object.library}/${object.name}.${type}`,
        });
    }
    isProtected() {
        return this.filter.protected || getContent().isProtectedPath(this.object.library);
    }
    sortBy(sort) {
        if (this.sort.order !== sort.order) {
            this.sort.order = sort.order;
            this.sort.ascending = true;
        }
        else {
            this.sort.ascending = !this.sort.ascending;
        }
        this.updateDescription(true);
        this.description = `${this.object.text ? `${this.object.text} ` : ``}(sort: ${this.sort.order} ${this.sort.ascending ? `🔼` : `🔽`})`;
        this.reveal({ expand: true });
        this.refresh();
    }
    updateDescription(includeOrder) {
        this.description = this.object.text ? `${this.object.text} ` : ``;
        if (includeOrder)
            this.description = this.description.concat(` (sort: ${this.sort.order} ${this.sort.ascending ? `🔼` : `🔽`})`);
    }
    async getChildren() {
        const connection = getConnection();
        const content = getContent();
        const writable = await content.checkObject({
            library: this.object.library,
            name: this.object.name,
            type: `*FILE`
        }, [`*UPD`]);
        try {
            const members = await content.getMemberList({
                library: this.object.library,
                sourceFile: this.object.name,
                members: this.filter.member,
                extensions: this.filter.memberType,
                filterType: this.filter.filterType,
                sort: this.sort
            });
            await storeMemberList(this.path, members.map(member => `${member.name}.${member.extension}`));
            return members.map(member => new ObjectBrowserMemberItem(this, member, writable));
        }
        catch (e) {
            console.log(e);
            // Work around since we can't get the member list if the users CCSID is not setup.
            if (connection.enableSQL) {
                if (e && e.message && e.message.includes(`CCSID`)) {
                    vscode_1.default.window.showErrorMessage(`Error getting member list. It is recommended you disconnect and correctly set your user profile CCSID. ${e.message}`, `Reload`).then(async (value) => {
                        if (value === `Reload`) {
                            await vscode_1.default.commands.executeCommand(`workbench.action.reloadWindow`);
                        }
                    });
                }
            }
            else {
                throw e;
            }
        }
    }
    toString() {
        return `${this.path} (${this.object.type})`;
    }
    async delete() {
        return deleteObject(this.object);
    }
    getToolTip() {
        return Tools_2.VscodeTools.sourcePhysicalFileToToolTip(getConnection(), this.path, this.object);
    }
}
class ObjectBrowserObjectItem extends ObjectBrowserItem {
    object;
    path;
    library;
    constructor(parent, object) {
        const type = object.type.startsWith(`*`) ? object.type.substring(1) : object.type;
        const icon = Object.entries(objectIcons).find(([key]) => key === type.toUpperCase())?.[1] || objectIcons[``];
        const isLibrary = type === 'LIB';
        super(parent.filter, correctCase(`${object.name}.${type}`), { icon, parent, state: isLibrary ? vscode_1.default.TreeItemCollapsibleState.Collapsed : vscode_1.default.TreeItemCollapsibleState.None });
        this.object = object;
        this.library = isLibrary ? object.name : '';
        this.path = [object.library, object.name].join(`/`);
        this.updateDescription();
        this.contextValue = `object.${type.toLowerCase()}${object.attribute ? `.${object.attribute}` : ``}${isLibrary ? '_library' : ''}${this.isProtected() ? `_readonly` : ``}`;
        this.tooltip = Tools_2.VscodeTools.objectToToolTip(this.path, object);
        this.resourceUri = vscode_1.default.Uri.from({
            scheme: `object`,
            path: `/${object.library}/${object.name}.${type}`,
            fragment: object.attribute
        });
        if (!isLibrary) {
            this.command = {
                command: `vscode.open`,
                title: `Open`,
                arguments: [this.resourceUri]
            };
        }
    }
    isProtected() {
        return this.filter.protected || getContent().isProtectedPath(this.object.library);
    }
    updateDescription() {
        this.description = this.object.text.trim() + (this.object.attribute ? ` (${this.object.attribute})` : ``);
    }
    async getChildren() {
        const objectFilter = Object.assign({}, this.filter);
        objectFilter.library = this.object.name;
        return await listObjects(this, objectFilter);
    }
    toString() {
        return `${this.path} (${this.object.type})`;
    }
    async delete() {
        return deleteObject(this.object);
    }
}
class ObjectBrowserMemberItem extends ObjectBrowserItem {
    member;
    path;
    sortBy;
    readonly;
    constructor(parent, member, writable) {
        const readonly = !writable || parent.isProtected();
        super(parent.filter, correctCase(`${member.name}.${member.extension}`), { icon: readonly ? `lock-small` : "", parent });
        this.member = member;
        this.contextValue = `member${readonly ? `_readonly` : ``}`;
        this.description = member.text;
        this.resourceUri = (0, QSysFs_1.getMemberUri)(member, { readonly });
        this.path = this.resourceUri.path.substring(1);
        this.tooltip = Tools_2.VscodeTools.memberToToolTip(this.path, member);
        this.sortBy = (sort) => parent.sortBy(sort);
        this.command = {
            command: "code-for-ibmi.openWithDefaultMode",
            title: `Open Member`,
            arguments: [{ path: this.path }, (readonly ? "browse" : undefined)]
        };
        this.readonly = readonly;
    }
    isProtected() {
        return this.readonly;
    }
    toString() {
        return this.path;
    }
    async delete() {
        const connection = getConnection();
        const { library, file, name } = connection.parserMemberPath(this.path);
        const removeResult = await connection.runCommand({
            command: `RMVM FILE(${library}/${file}) MBR(${name})`,
            noLibList: true
        });
        if (removeResult.code !== 0) {
            vscode_1.default.window.showErrorMessage(vscode_1.default.l10n.t(`Error deleting member! {0}`, removeResult.stderr));
        }
        return removeResult.code === 0;
    }
}
class ObjectBrowserMemberItemDragAndDrop {
    dragMimeTypes = [];
    dropMimeTypes = [];
    handleDrag(source, dataTransfer, token) {
        //A URI list is automatically produced
        dataTransfer.set(typings_1.OBJECT_BROWSER_MIMETYPE, new vscode_1.DataTransferItem(source));
    }
}
function initializeObjectBrowser(context) {
    const objectBrowser = new ObjectBrowser();
    const objectTreeViewer = vscode_1.default.window.createTreeView(`objectBrowser`, {
        treeDataProvider: objectBrowser,
        showCollapseAll: true,
        canSelectMany: true,
        dragAndDropController: new ObjectBrowserMemberItemDragAndDrop()
    });
    const getSelectedItems = (node) => node ? Array.isArray(node) ? node : [node] : objectTreeViewer.selection;
    context.subscriptions.push(objectTreeViewer, vscode_1.default.commands.registerCommand(`code-for-ibmi.sortMembersByName`, (item) => {
        item.sortBy({ order: "name" });
    }), vscode_1.default.commands.registerCommand(`code-for-ibmi.sortMembersByDate`, (item) => {
        item.sortBy({ order: "date" });
    }), vscode_1.default.commands.registerCommand(`code-for-ibmi.createFilter`, async () => {
        await (0, filters_1.editFilter)();
        objectBrowser.refresh();
    }), vscode_1.default.commands.registerCommand(`code-for-ibmi.createQuickFilter`, async () => {
        const config = getConfig();
        const connection = getConnection();
        const objectFilters = config.objectFilters;
        const LIBRARY_REGEX = /^(?<lib>[^/.() ]+)\*$/;
        const FILTER_REGEX = /^(?<lib>[^/.() ]+)(\/(?<obj>[^/.() ]+))?(\/(?<mbr>[^/.() ]+))?(\.(?<mbrType>[^/.() ]+))?( \((?<objType>[^/.()]+)\))?$/;
        const newFilter = await vscode_1.default.window.showInputBox({
            prompt: `Enter filter as LIB* or LIB/OBJ/MBR.MBRTYPE (OBJTYPE) where each parameter is optional except the library`,
            value: ``,
            validateInput: newFilter => {
                const libraryRegex = LIBRARY_REGEX.exec(connection.upperCaseName(newFilter));
                const filterRegex = FILTER_REGEX.exec(connection.upperCaseName(newFilter));
                if (!libraryRegex && !filterRegex)
                    return `Invalid filter: ${newFilter}. Use format LIB* or LIB/OBJ/MBR.MBRTYPE (OBJTYPE) where each parameter is optional except the library`;
            }
        });
        if (newFilter) {
            let regex = LIBRARY_REGEX.exec(connection.upperCaseName(newFilter));
            const parsedFilter = regex?.groups;
            if (regex && parsedFilter) {
                const filter = {
                    name: `Filter ${objectFilters.length + 1}`,
                    filterType: 'simple',
                    library: `${parsedFilter.lib}*`,
                    object: `*`,
                    types: [`*ALL`],
                    member: `*`,
                    memberType: `*`,
                    protected: false
                };
                objectFilters.push(filter);
            }
            else {
                regex = FILTER_REGEX.exec(connection.upperCaseName(newFilter));
                const parsedFilter = regex?.groups;
                if (regex && parsedFilter) {
                    const filter = {
                        name: `Filter ${objectFilters.length + 1}`,
                        filterType: 'simple',
                        library: parsedFilter.lib || `QGPL`,
                        object: parsedFilter.obj || `*`,
                        types: [parsedFilter.objType || `*SRCPF`],
                        member: parsedFilter.mbr || `*`,
                        memberType: parsedFilter.mbrType || `*`,
                        protected: false
                    };
                    objectFilters.push(filter);
                }
            }
            config.objectFilters = objectFilters;
            await IBMi_1.default.connectionManager.update(config);
            objectBrowser.refresh();
        }
    }), vscode_1.default.commands.registerCommand(`code-for-ibmi.copyFilter`, async (node) => {
        await (0, filters_1.editFilter)(node.filter, true);
        objectBrowser.refresh();
    }), vscode_1.default.commands.registerCommand(`code-for-ibmi.maintainFilter`, async (node, nodes) => {
        if (node) {
            (nodes || [node]).map(n => n.filter).forEach(filter => (0, filters_1.editFilter)(filter).then(() => objectBrowser.refresh()));
        }
        else {
            await (0, filters_1.editFilter)();
            objectBrowser.refresh();
        }
    }), vscode_1.default.commands.registerCommand(`code-for-ibmi.moveFilterUp`, (node) => objectBrowser.moveFilterInList(node, `UP`)), vscode_1.default.commands.registerCommand(`code-for-ibmi.moveFilterDown`, (node) => objectBrowser.moveFilterInList(node, `DOWN`)), vscode_1.default.commands.registerCommand(`code-for-ibmi.moveFilterToTop`, (node) => objectBrowser.moveFilterInList(node, `TOP`)), vscode_1.default.commands.registerCommand(`code-for-ibmi.moveFilterToBottom`, (node) => objectBrowser.moveFilterInList(node, `BOTTOM`)), vscode_1.default.commands.registerCommand(`code-for-ibmi.sortFilters`, async () => {
        const config = getConfig();
        config.objectFilters.sort((filter1, filter2) => filter1.name.toLowerCase().localeCompare(filter2.name.toLowerCase()));
        await IBMi_1.default.connectionManager.update(config);
        objectBrowser.autoRefresh();
    }), vscode_1.default.commands.registerCommand(`code-for-ibmi.refreshObjectBrowser`, () => objectBrowser.refresh()), vscode_1.default.commands.registerCommand(`code-for-ibmi.refreshObjectBrowserItem`, async (item) => {
        objectBrowser.refresh(item);
    }), vscode_1.default.commands.registerCommand(`code-for-ibmi.revealInObjectBrowser`, async (item, options) => {
        objectTreeViewer.reveal(item, options);
    }), vscode_1.default.commands.registerCommand(`code-for-ibmi.generateBinderSource`, async (node, nodes) => {
        nodes = (nodes || [node]);
        const contentApi = getContent();
        const increment = 100 / nodes.length;
        vscode_1.default.window.withProgress({ location: vscode_1.default.ProgressLocation.Notification, cancellable: true, title: vscode_1.l10n.t("Generating binder source") }, async (progress, cancel) => {
            for (const node of nodes) {
                if (cancel.isCancellationRequested) {
                    return;
                }
                progress.report({ message: node.toString(), increment });
                const exports = [];
                if (node.object.type === '*MODULE') {
                    exports.push(...(await contentApi.getModuleExports(node.object.library, node.object.name))
                        .filter(exp => exp.symbolType === 'PROCEDURE'));
                }
                else {
                    exports.push(...(await contentApi.getProgramExportImportInfo(node.object.library, node.object.name, node.object.type))
                        .filter(info => info.symbolUsage === '*PROCEXP'));
                }
                const content = [
                    `/*  Binder source generated from ${node}  */`,
                    ``,
                    `STRPGMEXP PGMLVL(*CURRENT) /* SIGNATURE("") */`,
                    ...exports.map(info => `  EXPORT SYMBOL("${info.symbolName}")`),
                    `ENDPGMEXP`,
                ].join("\n");
                const textDoc = await vscode_1.default.workspace.openTextDocument({ language: 'bnd', content });
                await vscode_1.default.window.showTextDocument(textDoc);
            }
        });
    }), vscode_1.default.commands.registerCommand(`code-for-ibmi.createMember`, async (node, fullName) => {
        const connection = getConnection();
        const toPath = (value) => connection.upperCaseName(`${node.path}/${value}`);
        fullName = await vscode_1.default.window.showInputBox({
            prompt: vscode_1.default.l10n.t(`Name of new source member (member.ext)`),
            value: fullName,
            validateInput: (value) => {
                try {
                    connection.parserMemberPath(toPath(value), true);
                }
                catch (e) {
                    return e.toString();
                }
            }
        });
        if (fullName) {
            const fullPath = toPath(fullName);
            const member = connection.parserMemberPath(fullPath);
            const error = await vscode_1.default.window.withProgress({ location: vscode_1.default.ProgressLocation.Notification, title: vscode_1.default.l10n.t(`Creating member {0}...`, fullPath) }, async (progress) => {
                const addResult = await connection.runCommand({
                    command: `ADDPFM FILE(${member.library}/${member.file}) MBR(${member.name}) SRCTYPE(${member.extension.length > 0 ? member.extension : `*NONE`})`,
                    noLibList: true
                });
                if (addResult.code === 0) {
                    if (IBMi_1.default.connectionManager.get(`autoOpenFile`)) {
                        vscode_1.default.commands.executeCommand(`code-for-ibmi.openEditable`, fullPath);
                    }
                    objectBrowser.refresh(node);
                }
                else {
                    return addResult.stderr;
                }
            });
            if (error) {
                if (await vscode_1.default.window.showErrorMessage(vscode_1.default.l10n.t(`Error creating member {0}: {1}`, fullPath, error), vscode_1.default.l10n.t("Retry"))) {
                    vscode_1.default.commands.executeCommand(`code-for-ibmi.createMember`, node, fullName);
                }
            }
        }
    }), vscode_1.default.commands.registerCommand(`code-for-ibmi.copyMember`, async (node, fullPath) => {
        const connection = getConnection();
        const oldUri = node.resourceUri;
        const oldMember = node.member;
        const oldMemberTabs = Tools_2.VscodeTools.findUriTabs(oldUri);
        if (oldMemberTabs.find(tab => tab.isDirty)) {
            const result = await vscode_1.default.window.showWarningMessage(vscode_1.default.l10n.t(`The member {0} has unsaved changes. The copied member will not include these changes. Do you want to continue?`, oldMember.name), { modal: true }, vscode_1.default.l10n.t("Yes"), vscode_1.default.l10n.t("No"));
            if (result === vscode_1.default.l10n.t("No")) {
                return;
            }
        }
        fullPath = await vscode_1.default.window.showInputBox({
            prompt: vscode_1.default.l10n.t(`New path for copy of source member`),
            value: node.path || fullPath,
            validateInput: (value) => {
                try {
                    const memberPath = connection.parserMemberPath(value, true);
                    if (memberPath.library === oldMember.library && memberPath.file === oldMember.file && memberPath.name === oldMember.name) {
                        return vscode_1.default.l10n.t(`Cannot copy member to itself!`);
                    }
                }
                catch (e) {
                    return e.toString();
                }
            }
        });
        if (fullPath) {
            const memberPath = connection.parserMemberPath(fullPath);
            const error = await vscode_1.default.window.withProgress({ location: vscode_1.default.ProgressLocation.Notification, title: vscode_1.default.l10n.t(`Creating member {0}...`, fullPath.toUpperCase()) }, async (progress) => {
                try {
                    const checkResult = await connection.runCommand({
                        command: `CHKOBJ OBJ(${memberPath.library}/${memberPath.file}) OBJTYPE(*FILE) MBR(${memberPath.name})`,
                        noLibList: true
                    });
                    const newMemberExists = checkResult.code === 0;
                    if (newMemberExists) {
                        const result = await vscode_1.default.window.showInformationMessage(vscode_1.default.l10n.t(`Are you sure you want overwrite member {0}?`, memberPath.name), { modal: true }, vscode_1.default.l10n.t("Yes"));
                        if (result === vscode_1.default.l10n.t(`Yes`)) {
                            await connection.runCommand({
                                command: `RMVM FILE(${memberPath.library}/${memberPath.file}) MBR(${memberPath.name})`,
                                noLibList: true
                            });
                        }
                        else {
                            throw vscode_1.default.l10n.t(`Member {0} already exists!`, memberPath.name);
                        }
                    }
                    const copyResult = await connection.runCommand({
                        command: `CPYSRCF FROMFILE(${oldMember.library}/${oldMember.file}) TOFILE(${memberPath.library}/${memberPath.file}) FROMMBR(${oldMember.name}) TOMBR(${memberPath.name}) MBROPT(*REPLACE)`,
                        noLibList: true
                    });
                    const copyMessages = Tools_1.Tools.parseMessages(copyResult.stderr);
                    if (copyResult.code !== 0 && copyMessages.messages.length && !(copyMessages.findId(`CPF2869`) && copyMessages.findId(`CPF2817`))) {
                        throw (copyResult.stderr);
                    }
                    if (oldMember.extension !== memberPath.extension) {
                        await connection.runCommand({
                            command: `CHGPFM FILE(${memberPath.library}/${memberPath.file}) MBR(${memberPath.name}) SRCTYPE(${memberPath.extension.length > 0 ? memberPath.extension : `*NONE`})`,
                            noLibList: true
                        });
                    }
                    if (IBMi_1.default.connectionManager.get(`autoOpenFile`)) {
                        vscode_1.default.commands.executeCommand(`code-for-ibmi.openEditable`, fullPath);
                    }
                    if (oldMember.library.toLocaleLowerCase() === memberPath.library.toLocaleLowerCase()) {
                        if (oldMember.file.toLocaleLowerCase() === memberPath.file.toLocaleLowerCase()) {
                            objectBrowser.refresh(node.parent);
                        }
                        else {
                            objectBrowser.refresh(node.parent?.parent);
                        }
                    }
                    else {
                        objectBrowser.autoRefresh();
                    }
                }
                catch (e) {
                    return e;
                }
            });
            if (error) {
                if (await vscode_1.default.window.showErrorMessage(vscode_1.default.l10n.t(`Error creating member {0}: {1}`, fullPath, error), vscode_1.default.l10n.t("Retry"))) {
                    vscode_1.default.commands.executeCommand(`code-for-ibmi.copyMember`, node, fullPath);
                }
            }
        }
    }), vscode_1.default.commands.registerCommand(`code-for-ibmi.updateMemberText`, async (node) => {
        const connection = getConnection();
        const { library, file, name, basename } = connection.parserMemberPath(node.path);
        const oldText = node.member.text;
        const newText = await vscode_1.default.window.showInputBox({
            value: oldText,
            prompt: vscode_1.default.l10n.t(`Change member description for {0}, *BLANK for no description`, basename)
        });
        if (newText && newText !== oldText) {
            const escapedText = newText.replace(/'/g, `''`);
            const connection = getConnection();
            const changeResult = await connection.runCommand({
                command: `CHGPFM FILE(${library}/${file}) MBR(${name}) TEXT(${newText.toUpperCase() !== `*BLANK` ? `'${escapedText}'` : `*BLANK`})`,
                noLibList: true
            });
            if (changeResult.code === 0) {
                //pre updating description to avoid old description when multiple updates are performed without refreshing
                node.description = newText.toUpperCase() !== `*BLANK` ? newText : ``;
                node.member.text = node.description;
                objectBrowser.refresh(node);
            }
            else {
                vscode_1.default.window.showErrorMessage(vscode_1.default.l10n.t(`Error changing member description! {0}`, changeResult.stderr));
            }
        }
    }), vscode_1.default.commands.registerCommand(`code-for-ibmi.renameMember`, async (node) => {
        const connection = getConnection();
        const oldMember = connection.parserMemberPath(node.path);
        const oldUri = node.resourceUri;
        const library = oldMember.library;
        const sourceFile = oldMember.file;
        let newBasename = oldMember.basename;
        let newMember;
        let newMemberPath;
        let newNameOK;
        // Check if the member is currently open in an editor tab.
        const oldMemberTabs = Tools_2.VscodeTools.findUriTabs(oldUri);
        // If the member is currently open in an editor tab, and
        // the member has unsaved changes, then prevent the renaming operation.
        if (oldMemberTabs.find(tab => tab.isDirty)) {
            vscode_1.default.window.showErrorMessage(vscode_1.default.l10n.t(`Error renaming member! {0}`, vscode_1.default.l10n.t("The member has unsaved changes.")));
            return;
        }
        do {
            newBasename = await vscode_1.default.window.showInputBox({
                value: newBasename,
                prompt: vscode_1.default.l10n.t(`Rename {0}`, oldMember.basename),
                validateInput: value => {
                    if (connection.upperCaseName(value) === oldMember.basename) {
                        return vscode_1.default.l10n.t(`New member name must be different from it's current name`);
                    }
                    const parsedNewName = path_1.default.parse(value);
                    if (!connection.validQsysName(parsedNewName.name)) {
                        return vscode_1.default.l10n.t(`Not a valid member name!`);
                    }
                    return undefined;
                }
            });
            if (newBasename) {
                newNameOK = true;
                newMemberPath = library + `/` + sourceFile + `/` + newBasename;
                try {
                    newMember = connection.parserMemberPath(newMemberPath);
                }
                catch (e) {
                    newNameOK = false;
                    vscode_1.default.window.showErrorMessage(e);
                }
                if (newMember) {
                    let commandResult;
                    if (oldMember.name !== newMember.name) {
                        commandResult = await connection.runCommand({
                            command: `RNMM FILE(${library}/${sourceFile}) MBR(${oldMember.name}) NEWMBR(${newMember.name})`,
                            noLibList: true
                        });
                        if (commandResult.code !== 0) {
                            newNameOK = false;
                            vscode_1.default.window.showErrorMessage(vscode_1.default.l10n.t(`Error renaming member! {0}`, commandResult.stderr));
                        }
                    }
                    if (oldMember.extension !== newMember.extension) {
                        commandResult = await connection.runCommand({
                            command: `CHGPFM FILE(${library}/${sourceFile}) MBR(${newMember.name}) SRCTYPE(${newMember.extension.length > 0 ? newMember.extension : `*NONE`})`,
                            noLibList: true
                        });
                        if (commandResult.code !== 0) {
                            newNameOK = false;
                            vscode_1.default.window.showErrorMessage(vscode_1.default.l10n.t(`Error renaming member! {0}`, commandResult.stderr));
                        }
                    }
                    objectBrowser.refresh(node.parent);
                }
            }
        } while (newBasename && !newNameOK);
        // If the member was open in an editor tab prior to the renaming,
        // refresh those tabs to reflect the new member path/name.
        // (Directly modifying the label or uri of an open tab is apparently not
        // possible with the current VS Code API, so refresh the tab by closing
        // it and then opening a new one at the new uri.)
        if (newNameOK && newMemberPath) {
            oldMemberTabs.forEach((tab) => {
                vscode_1.default.window.tabGroups.close(tab).then(() => {
                    vscode_1.default.commands.executeCommand(`code-for-ibmi.openEditable`, newMemberPath);
                });
            });
        }
    }), vscode_1.default.commands.registerCommand(`code-for-ibmi.uploadAndReplaceMemberAsFile`, async (node) => {
        const contentApi = getContent();
        const originPath = await vscode_1.default.window.showOpenDialog({ defaultUri: vscode_1.default.Uri.file(os_1.default.homedir()) });
        if (originPath) {
            const connection = getConnection();
            const { asp, library, file, name } = connection.parserMemberPath(node.path);
            const data = fs_1.default.readFileSync(originPath[0].fsPath, `utf8`);
            try {
                contentApi.uploadMemberContent(library, file, name, data);
                vscode_1.default.window.showInformationMessage(vscode_1.default.l10n.t(`Member was uploaded.`));
            }
            catch (e) {
                vscode_1.default.window.showErrorMessage(vscode_1.default.l10n.t(`Error uploading content to member! {0}`, e));
            }
        }
    }), vscode_1.default.commands.registerCommand(`code-for-ibmi.downloadMemberAsFile`, async (node, nodes) => {
        const contentApi = getContent();
        const connection = getConnection();
        const config = getConfig();
        //Gather all the members
        const members = [];
        for (const item of (nodes || [node])) {
            if ("object" in item) {
                members.push(...await contentApi.getMemberList({ library: item.object.library, sourceFile: item.object.name }));
            }
            else if ("member" in item) {
                members.push(item.member);
            }
        }
        const saveIntoDirectory = members.length > 1;
        let downloadLocationURI;
        if (saveIntoDirectory) {
            downloadLocationURI = (await vscode_1.default.window.showOpenDialog({
                canSelectMany: false,
                canSelectFiles: false,
                canSelectFolders: true,
                defaultUri: vscode_1.default.Uri.file(connection.getLastDownloadLocation())
            }))?.[0];
        }
        else {
            downloadLocationURI = (await vscode_1.default.window.showSaveDialog({
                defaultUri: vscode_1.default.Uri.file(path_1.default.join(connection.getLastDownloadLocation(), members[0].name)),
                filters: { 'Source member': [members[0].extension || '*'] }
            }));
        }
        if (downloadLocationURI) {
            //Remove double entries and map to { path, copy } object
            const toBeDownloaded = members
                .filter((member, index, list) => list.findIndex(m => m.library === member.library && m.file === member.file && m.name === member.name) === index)
                .sort((m1, m2) => m1.name.localeCompare(m2.name))
                .map(member => ({ member, path: Tools_1.Tools.qualifyPath(member.library, member.file, member.name, member.asp), name: `${member.name}.${member.extension || "MBR"}`, copy: true }));
            if (!saveIntoDirectory) {
                toBeDownloaded[0].name = (0, path_1.basename)(downloadLocationURI.path);
            }
            const downloadLocation = saveIntoDirectory ? downloadLocationURI.path : (0, path_1.dirname)(downloadLocationURI.path);
            await connection.setLastDownloadLocation(downloadLocation);
            //Ask what do to with existing files in the target directory
            if (saveIntoDirectory) {
                let overwriteAll = false;
                let skipAll = false;
                const overwriteLabel = vscode_1.default.l10n.t(`Overwrite`);
                const overwriteAllLabel = vscode_1.default.l10n.t(`Overwrite all`);
                const skipAllLabel = vscode_1.default.l10n.t(`Skip all`);
                for (const item of toBeDownloaded) {
                    const target = path_1.default.join(Tools_1.Tools.fixWindowsPath(downloadLocation), item.name);
                    if ((0, fs_1.existsSync)(target)) {
                        if (skipAll) {
                            item.copy = false;
                        }
                        else if (!overwriteAll) {
                            const answer = await vscode_1.default.window.showWarningMessage(vscode_1.default.l10n.t(`{0} already exists.
Do you want to replace it?`, item.name), { modal: true }, skipAllLabel, overwriteLabel, overwriteAllLabel);
                            if (answer) {
                                overwriteAll ||= (answer === overwriteAllLabel);
                                skipAll ||= (answer === skipAllLabel);
                                item.copy = !skipAll && (overwriteAll || answer === overwriteLabel);
                            }
                            else {
                                //Abort!
                                vscode_1.default.window.showInformationMessage(vscode_1.default.l10n.t(`Members download cancelled.`));
                                return;
                            }
                        }
                    }
                }
            }
            // Download members
            vscode_1.default.window.withProgress({ title: vscode_1.default.l10n.t(`Downloading {0} members`, toBeDownloaded.filter(m => m.copy).length), location: vscode_1.default.ProgressLocation.Notification }, async (task) => {
                try {
                    await connection.withTempDirectory(async (directory) => {
                        task.report({ message: vscode_1.default.l10n.t(`copying to streamfiles`), increment: -1 });
                        const copyToStreamFiles = toBeDownloaded
                            .filter(item => item.copy)
                            .map(item => [
                            `@QSYS/CPYF FROMFILE(${item.member.library}/${item.member.file}) TOFILE(QTEMP/QTEMPSRC) FROMMBR(${item.member.name}) TOMBR(TEMPMBR) MBROPT(*REPLACE) CRTFILE(*YES);`,
                            `@QSYS/CPYTOSTMF FROMMBR('${Tools_1.Tools.qualifyPath("QTEMP", "QTEMPSRC", "TEMPMBR")}') TOSTMF('${directory}/${item.name.toLocaleLowerCase()}') STMFOPT(*REPLACE) STMFCCSID(1208) DBFCCSID(${config.sourceFileCCSID});`
                        ].join("\n"))
                            .join("\n");
                        await connection.runSQL(copyToStreamFiles);
                        task.report({ message: vscode_1.default.l10n.t(`getting streamfiles`), increment: -1 });
                        await connection.getContent().downloadDirectory(downloadLocation, directory);
                        vscode_1.default.window.showInformationMessage(vscode_1.default.l10n.t(`Members download complete.`), vscode_1.default.l10n.t(`Open`))
                            .then(open => open ? vscode_1.default.commands.executeCommand('revealFileInOS', saveIntoDirectory ? vscode_1.default.Uri.joinPath(downloadLocationURI, toBeDownloaded[0].name.toLocaleLowerCase()) : downloadLocationURI) : undefined);
                    });
                }
                catch (e) {
                    vscode_1.default.window.showErrorMessage(vscode_1.default.l10n.t(`Error downloading member(s)! {0}`, String(e)));
                }
            });
        }
    }), vscode_1.default.commands.registerCommand(`code-for-ibmi.downloadMembersStructured`, async (node, nodes) => {
        const contentApi = getContent();
        const connection = getConnection();
        // Gather all members to download
        const members = [];
        for (const item of (nodes || [node])) {
            if ("object" in item) {
                members.push(...await contentApi.getMemberList({ library: item.object.library, sourceFile: item.object.name }));
            }
            else if ("member" in item) {
                members.push(item.member);
            }
        }
        if (members.length === 0) {
            vscode_1.default.window.showWarningMessage(vscode_1.default.l10n.t(`No members found to download.`));
            return;
        }
        // Prompt for root folder once
        const rootUriArray = await vscode_1.default.window.showOpenDialog({
            canSelectMany: false,
            canSelectFiles: false,
            canSelectFolders: true,
            openLabel: vscode_1.default.l10n.t(`Select base download folder`),
            defaultUri: vscode_1.default.Uri.file(connection.getLastDownloadLocation()),
            title: vscode_1.default.l10n.t(`Download {0} member(s) into structured folders`, members.length)
        });
        if (!rootUriArray || rootUriArray.length === 0)
            return;
        const rootPath = rootUriArray[0].fsPath;
        await connection.setLastDownloadLocation(rootPath);
        // Deduplicate
        const toDownload = members.filter((m, i, arr) => arr.findIndex(x => x.library === m.library && x.file === m.file && x.name === m.name) === i);
        await vscode_1.default.window.withProgress({ title: vscode_1.default.l10n.t(`Downloading {0} member(s)`, toDownload.length), location: vscode_1.default.ProgressLocation.Notification }, async (progress) => {
            let done = 0;
            const errors = [];
            for (const member of toDownload) {
                const localDir = path_1.default.join(rootPath, member.library.toUpperCase(), member.file.toUpperCase());
                const localFile = path_1.default.join(localDir, `${member.name.toUpperCase()}.${(member.extension || `MBR`).toUpperCase()}`);
                progress.report({ message: `${member.library}/${member.file}/${member.name}.${member.extension || `MBR`}`, increment: (100 / toDownload.length) });
                try {
                    fs_1.default.mkdirSync(localDir, { recursive: true });
                    const content = await contentApi.downloadMemberContent(member.library, member.file, member.name);
                    if (content !== undefined) {
                        fs_1.default.writeFileSync(localFile, content, `utf8`);
                    }
                }
                catch (e) {
                    errors.push(`${member.library}/${member.file}/${member.name}: ${String(e)}`);
                }
                done++;
            }
            if (errors.length > 0) {
                vscode_1.default.window.showWarningMessage(vscode_1.default.l10n.t(`{0} of {1} member(s) downloaded. {2} error(s).`, done - errors.length, toDownload.length, errors.length), vscode_1.default.l10n.t(`Show Details`)).then(action => {
                    if (action) {
                        vscode_1.default.window.showErrorMessage(errors.join(`\n`));
                    }
                });
            }
            else {
                vscode_1.default.window.showInformationMessage(vscode_1.default.l10n.t(`{0} member(s) downloaded to {1}`, done, rootPath), vscode_1.default.l10n.t(`Open download folder`)).then(action => {
                    if (action) {
                        vscode_1.default.commands.executeCommand(`revealFileInOS`, vscode_1.default.Uri.file(rootPath));
                    }
                });
            }
        });
    }), vscode_1.default.commands.registerCommand(`code-for-ibmi.downloadMembersStructuredFlat`, async (node, nodes) => {
        const contentApi = getContent();
        const connection = getConnection();
        // Gather all members to download
        const members = [];
        for (const item of (nodes || [node])) {
            if ("object" in item) {
                members.push(...await contentApi.getMemberList({ library: item.object.library, sourceFile: item.object.name }));
            }
            else if ("member" in item) {
                members.push(item.member);
            }
        }
        if (members.length === 0) {
            vscode_1.default.window.showWarningMessage(vscode_1.default.l10n.t(`No members found to download.`));
            return;
        }
        // Prompt for root folder once
        const rootUriArray = await vscode_1.default.window.showOpenDialog({
            canSelectMany: false,
            canSelectFiles: false,
            canSelectFolders: true,
            openLabel: vscode_1.default.l10n.t(`Select base download folder`),
            defaultUri: vscode_1.default.Uri.file(connection.getLastDownloadLocation()),
            title: vscode_1.default.l10n.t(`Download {0} member(s) into FILE/MEMBER folders`, members.length)
        });
        if (!rootUriArray || rootUriArray.length === 0)
            return;
        const rootPath = rootUriArray[0].fsPath;
        await connection.setLastDownloadLocation(rootPath);
        // Deduplicate
        const toDownload = members.filter((m, i, arr) => arr.findIndex(x => x.library === m.library && x.file === m.file && x.name === m.name) === i);
        // Detect cross-library collisions: same FILE/MEMBER.EXT from different libraries
        // For colliding members, fall back to including the library folder
        const fileKey = (m) => `${m.file.toUpperCase()}/${m.name.toUpperCase()}.${(m.extension || `MBR`).toUpperCase()}`;
        const keyCounts = new Map();
        for (const m of toDownload) {
            const k = fileKey(m);
            keyCounts.set(k, (keyCounts.get(k) || 0) + 1);
        }
        const collidingKeys = new Set([...keyCounts.entries()].filter(([, count]) => count > 1).map(([k]) => k));
        if (collidingKeys.size > 0) {
            const examples = [...collidingKeys].slice(0, 3).join(`, `);
            vscode_1.default.window.showWarningMessage(vscode_1.default.l10n.t(`{0} path collision(s) detected (e.g. {1}). The library folder will be included for those members only.`, collidingKeys.size, examples));
        }
        await vscode_1.default.window.withProgress({ title: vscode_1.default.l10n.t(`Downloading {0} member(s)`, toDownload.length), location: vscode_1.default.ProgressLocation.Notification }, async (progress) => {
            let done = 0;
            const errors = [];
            for (const member of toDownload) {
                const useLibrary = collidingKeys.has(fileKey(member));
                const localDir = useLibrary
                    ? path_1.default.join(rootPath, member.library.toUpperCase(), member.file.toUpperCase())
                    : path_1.default.join(rootPath, member.file.toUpperCase());
                const localFile = path_1.default.join(localDir, `${member.name.toUpperCase()}.${(member.extension || `MBR`).toUpperCase()}`);
                progress.report({ message: `${member.file}/${member.name}.${member.extension || `MBR`}`, increment: (100 / toDownload.length) });
                try {
                    fs_1.default.mkdirSync(localDir, { recursive: true });
                    const content = await contentApi.downloadMemberContent(member.library, member.file, member.name);
                    if (content !== undefined) {
                        fs_1.default.writeFileSync(localFile, content, `utf8`);
                    }
                }
                catch (e) {
                    errors.push(`${member.library}/${member.file}/${member.name}: ${String(e)}`);
                }
                done++;
            }
            if (errors.length > 0) {
                vscode_1.default.window.showWarningMessage(vscode_1.default.l10n.t(`{0} of {1} member(s) downloaded. {2} error(s).`, done - errors.length, toDownload.length, errors.length), vscode_1.default.l10n.t(`Show Details`)).then(action => {
                    if (action) {
                        vscode_1.default.window.showErrorMessage(errors.join(`\n`));
                    }
                });
            }
            else {
                vscode_1.default.window.showInformationMessage(vscode_1.default.l10n.t(`{0} member(s) downloaded to {1}`, done, rootPath), vscode_1.default.l10n.t(`Open download folder`)).then(action => {
                    if (action) {
                        vscode_1.default.commands.executeCommand(`revealFileInOS`, vscode_1.default.Uri.file(rootPath));
                    }
                });
            }
        });
    }), vscode_1.default.commands.registerCommand(`code-for-ibmi.searchSourceFile`, async (node, nodes) => {
        const parameters = [];
        if (node) {
            (nodes || [node]).forEach(n => parameters.push({ path: n.path, fillter: n.filter }));
        }
        else {
            const connection = getConnection();
            const input = await vscode_1.default.window.showInputBox({
                prompt: vscode_1.default.l10n.t(`Enter LIB/SPF/member.ext to search (member.ext is optional and can contain wildcards)`),
                title: vscode_1.default.l10n.t(`Search source file`),
                validateInput: (input) => {
                    input = input.trim();
                    const path = input.split(`/`);
                    let checkPath;
                    if (path.length > 3) {
                        return vscode_1.default.l10n.t(`Please enter value in form LIB/SPF/member.ext`);
                    }
                    else if (path.length > 2) { // Check member
                        let checkMember = path[2].replace(/[*]/g, ``).split(`.`);
                        checkMember[0] = checkMember[0] !== `` ? checkMember[0] : `a`;
                        checkPath = path[0] + `/` + path[1] + `/` + checkMember[0] + `.` + (checkMember.length > 1 ? checkMember[1] : ``);
                    }
                    else if (path.length > 1) { // Check filename
                        checkPath = input + (path[path.length - 1] === `` ? `a` : ``) + `/a.b`;
                    }
                    else { // Check library
                        checkPath = input + (path[path.length - 1] === `` ? `a` : ``) + `/a/a.a`;
                    }
                    if (checkPath) {
                        try {
                            connection.parserMemberPath(checkPath, true);
                        }
                        catch (e) {
                            return e;
                        }
                    }
                }
            });
            if (input) {
                const path = connection.upperCaseName(input.trim()).split(`/`);
                parameters.push({ path: [path[0], path[1]].join('/') });
            }
        }
        if (parameters.length) {
            const connection = getConnection();
            if (!parameters.some(p => p.path.split('/')[1] === '*ALL')) {
                const selectedAsp = connection.getCurrentIAspName();
                const aspText = (selectedAsp ? vscode_1.default.l10n.t(`(in ASP {0})`, selectedAsp) : ``);
                const list = IBMi_1.default.GlobalStorage.getPreviousSearchTerms();
                const listHeader = [
                    { label: vscode_1.default.l10n.t(`Previous search terms`), kind: vscode_1.default.QuickPickItemKind.Separator }
                ];
                const clearList = vscode_1.default.l10n.t(`$(trash) Clear list`);
                const clearListArray = [{ label: ``, kind: vscode_1.default.QuickPickItemKind.Separator }, { label: clearList }];
                const quickPick = vscode_1.default.window.createQuickPick();
                quickPick.items = list.length > 0 ? listHeader.concat(list.map(term => ({ label: term }))).concat(clearListArray) : [];
                quickPick.placeholder = list.length > 0 ? vscode_1.default.l10n.t(`Enter search term or select one of the previous search terms.`) : vscode_1.default.l10n.t(`Enter search term.`);
                quickPick.title = vscode_1.default.l10n.t(`Search {0} {1}`, parameters.map(p => p.path).join(", "), aspText);
                quickPick.onDidChangeValue(() => {
                    if (quickPick.value === ``) {
                        quickPick.items = listHeader.concat(list.map(term => ({ label: term }))).concat(clearListArray);
                    }
                    else if (!list.includes(quickPick.value)) {
                        quickPick.items = [{ label: quickPick.value }].concat(listHeader)
                            .concat(list.map(term => ({ label: term })));
                    }
                });
                quickPick.onDidAccept(async () => {
                    const searchTerm = quickPick.activeItems[0].label;
                    if (searchTerm) {
                        if (searchTerm === clearList) {
                            IBMi_1.default.GlobalStorage.clearPreviousSearchTerms();
                            quickPick.items = [];
                            quickPick.placeholder = vscode_1.default.l10n.t(`Enter search term.`);
                            vscode_1.default.window.showInformationMessage(vscode_1.default.l10n.t(`Cleared list.`));
                            quickPick.show();
                        }
                        else {
                            quickPick.hide();
                            IBMi_1.default.GlobalStorage.addPreviousSearchTerm(searchTerm);
                            await doSearch(searchTerm, parameters);
                        }
                    }
                });
                quickPick.onDidHide(() => quickPick.dispose());
                quickPick.show();
            }
            else {
                vscode_1.default.window.showErrorMessage(vscode_1.default.l10n.t(`Cannot search listings using *ALL.`));
            }
        }
    }), vscode_1.default.commands.registerCommand(`code-for-ibmi.createLibrary`, async () => {
        const config = getConfig();
        const connection = getConnection();
        const newLibrary = await vscode_1.default.window.showInputBox({
            prompt: vscode_1.default.l10n.t(`Name of new library`),
            validateInput: (library => !connection.validQsysName(library) ? vscode_1.default.l10n.t(`Library name not valid.`) : undefined)
        });
        if (newLibrary) {
            const filters = config.objectFilters;
            const createResult = await connection.runCommand({
                command: `CRTLIB LIB(${newLibrary})`,
                noLibList: true
            });
            const isSuccess = createResult.code === 0;
            if (isSuccess) {
                const config = connection.getConfig();
                const libl = [config.currentLibrary, ...config.libraryList].map(library => connection.upperCaseName(library));
                const existsInLibl = libl.includes(connection.upperCaseName(newLibrary));
                if (existsInLibl) {
                    vscode_1.commands.executeCommand(`code-for-ibmi.refreshLibraryListView`);
                }
                filters.push({
                    name: newLibrary,
                    filterType: 'simple',
                    library: newLibrary,
                    object: `*ALL`,
                    types: [`*ALL`],
                    member: `*`,
                    memberType: `*`,
                    protected: false
                });
                config.objectFilters = filters;
                IBMi_1.default.connectionManager.update(config);
                const autoRefresh = objectBrowser.autoRefresh();
                if (!existsInLibl) {
                    // Add to library list ?
                    await vscode_1.default.window.showInformationMessage(vscode_1.default.l10n.t(`Would you like to add the new library to the library list?`), vscode_1.default.l10n.t(`Yes`))
                        .then(async (result) => {
                        switch (result) {
                            case vscode_1.default.l10n.t(`Yes`):
                                await vscode_1.default.commands.executeCommand(`code-for-ibmi.addToLibraryList`, { library: newLibrary });
                                if (autoRefresh) {
                                    vscode_1.default.commands.executeCommand(`code-for-ibmi.refreshLibraryListView`);
                                }
                                break;
                        }
                    });
                }
            }
            else {
                vscode_1.default.window.showErrorMessage(vscode_1.default.l10n.t(`Cannot create library "{0}": {1}`, newLibrary, createResult.stderr));
            }
        }
    }), vscode_1.default.commands.registerCommand(`code-for-ibmi.createSourceFile`, async (node) => {
        if (node.library) {
            const connection = getConnection();
            const fileName = await vscode_1.default.window.showInputBox({
                prompt: vscode_1.default.l10n.t(`Name of new source file`),
                validateInput: (fileName => !connection.validQsysName(fileName) ? vscode_1.default.l10n.t(`Source filename is not valid.`) : undefined)
            });
            if (fileName) {
                const library = node.library;
                const uriPath = `${library}/${connection.upperCaseName(fileName)}`;
                vscode_1.default.window.showInformationMessage(vscode_1.default.l10n.t(`Creating source file {0}.`, uriPath));
                const createResult = await connection.runCommand({
                    command: `CRTSRCPF FILE(${uriPath}) RCDLEN(112)`,
                    noLibList: true
                });
                if (createResult.code === 0) {
                    objectBrowser.refresh(node);
                }
                else {
                    vscode_1.default.window.showErrorMessage(vscode_1.default.l10n.t(`Error creating source file! {0}`, createResult.stderr));
                }
            }
        }
    }), vscode_1.default.commands.registerCommand(`code-for-ibmi.changeObjectDesc`, async (node) => {
        let newText = node.object.text;
        let newTextOK;
        do {
            newText = await vscode_1.default.window.showInputBox({
                prompt: vscode_1.default.l10n.t(`Change object description for {0}, *BLANK for no description`, node.path),
                value: newText,
                validateInput: newText => {
                    return newText.length <= 50 ? null : vscode_1.default.l10n.t(`Object description must be 50 chars or less.`);
                }
            }) || "";
            if (newText) {
                const escapedText = newText.replace(/'/g, `''`).replace(/`/g, `\\\``);
                const connection = getConnection();
                newTextOK = true;
                const changeResult = await connection.runCommand({
                    command: `CHGOBJD OBJ(${node.path}) OBJTYPE(${node.object.type}) TEXT(${newText.toUpperCase() !== `*BLANK` ? `'${escapedText}'` : `*BLANK`})`,
                    noLibList: true
                });
                if (changeResult.code === 0) {
                    node.object.text = newText;
                    node.updateDescription();
                    objectBrowser.refresh(node);
                    vscode_1.default.window.showInformationMessage(vscode_1.default.l10n.t(`Changed object description for {0} {1}.`, node.path, node.object.type.toUpperCase()));
                }
                else {
                    vscode_1.default.window.showErrorMessage(vscode_1.default.l10n.t(`Error changing description for {0}! {1}`, node.path, changeResult.stderr));
                    newTextOK = false;
                }
            }
        } while (newText && !newTextOK);
    }), vscode_1.default.commands.registerCommand(`code-for-ibmi.copyObject`, async (node) => {
        let newPath = node.path;
        let newPathOK;
        do {
            newPath = await vscode_1.default.window.showInputBox({
                prompt: vscode_1.default.l10n.t(`Create duplicate object to new library/object`),
                value: newPath,
                validateInput: newPath => {
                    let splitPath = newPath.split(`/`);
                    if (splitPath.length != 2)
                        return vscode_1.default.l10n.t(`Invalid path: {0}. Use format LIB/OBJ`, newPath);
                    if (splitPath[0].length > 10)
                        return vscode_1.default.l10n.t(`Library must be 10 chars or less.`);
                    if (splitPath[1].length > 10)
                        return vscode_1.default.l10n.t(`Object name must be 10 chars or less.`);
                }
            }) || "";
            if (newPath) {
                const [oldLibrary, oldObject] = node.path.split(`/`);
                const escapedPath = newPath.replace(/'/g, `''`).replace(/`/g, `\\\``);
                const [newLibrary, newObject] = escapedPath.split(`/`);
                const connection = getConnection();
                newPathOK = true;
                let command;
                if (node.object.type.toLocaleLowerCase() === `*lib`) {
                    command = `CPYLIB FROMLIB(${oldObject}) TOLIB(${newObject})`;
                }
                else {
                    command = `CRTDUPOBJ OBJ(${oldObject}) FROMLIB(${oldLibrary}) OBJTYPE(${node.object.type}) TOLIB(${newLibrary}) NEWOBJ(${newObject}) ${node.object.type.toLocaleLowerCase() === '*file' ? 'DATA(*YES)' : ''}`;
                }
                const commandRes = await connection.runCommand({
                    command,
                    noLibList: true
                });
                if (commandRes.code === 0) {
                    if (oldLibrary.toLocaleLowerCase() === newLibrary.toLocaleLowerCase()) {
                        objectBrowser.refresh(node.parent);
                    }
                    else if (!objectBrowser.autoRefresh(vscode_1.default.l10n.t(`Copied object {0} {1} to {2}.`, node.path, node.object.type.toUpperCase(), escapedPath))) {
                        vscode_1.default.window.showInformationMessage(vscode_1.default.l10n.t(`Copied object {0} {1} to {2}. Refresh object browser.`, node.path, node.object.type.toUpperCase(), escapedPath));
                    }
                }
                else {
                    vscode_1.default.window.showErrorMessage(vscode_1.default.l10n.t(`Error copying object {0}! {1}`, node.path, commandRes.stderr));
                    newPathOK = false;
                }
            }
        } while (newPath && !newPathOK);
    }), vscode_1.default.commands.registerCommand(`code-for-ibmi.renameObject`, async (node) => {
        let [, newObject] = node.path.split(`/`);
        let newObjectOK;
        do {
            newObject = await vscode_1.default.window.showInputBox({
                prompt: vscode_1.default.l10n.t(`Rename object`),
                value: newObject,
                validateInput: newObject => {
                    return newObject.length <= 10 ? null : vscode_1.default.l10n.t(`Object name must be 10 chars or less.`);
                }
            }) || "";
            if (newObject) {
                const escapedObject = newObject.replace(/'/g, `''`).replace(/`/g, `\\\``).split(`/`);
                const connection = getConnection();
                newObjectOK = await vscode_1.default.window.withProgress({ location: vscode_1.default.ProgressLocation.Notification, title: vscode_1.default.l10n.t(`Renaming object {0} {1} to {2}...`, node.path, node.object.type.toUpperCase(), escapedObject.join('/')) }, async (progress) => {
                    const renameResult = await connection.runCommand({
                        command: `RNMOBJ OBJ(${node.path}) OBJTYPE(${node.object.type}) NEWOBJ(${escapedObject})`,
                        noLibList: true
                    });
                    if (renameResult.code !== 0) {
                        vscode_1.default.window.showErrorMessage(vscode_1.default.l10n.t(`Error renaming object {0}! {1}`, node.path, renameResult.stderr));
                        return false;
                    }
                    vscode_1.default.window.showInformationMessage(vscode_1.default.l10n.t(`Renamed object {0} {1} to {2}.`, node.path, node.object.type.toUpperCase(), escapedObject.join('/')));
                    objectBrowser.refresh(node.parent);
                    return true;
                });
            }
        } while (newObject && !newObjectOK);
    }), vscode_1.default.commands.registerCommand(`code-for-ibmi.moveObject`, async (node) => {
        let [newLibrary,] = node.path.split(`/`);
        let newLibraryOK;
        do {
            newLibrary = await vscode_1.default.window.showInputBox({
                prompt: vscode_1.default.l10n.t(`Move object`),
                value: newLibrary,
                validateInput: newLibrary => {
                    return newLibrary.length <= 10 ? null : vscode_1.default.l10n.t(`Object name must be 10 chars or less.`);
                }
            }) || "";
            if (newLibrary) {
                const escapedLibrary = newLibrary.replace(/'/g, `''`).replace(/`/g, `\\\``);
                const connection = getConnection();
                newLibraryOK = await vscode_1.default.window.withProgress({ location: vscode_1.default.ProgressLocation.Notification, title: vscode_1.default.l10n.t(`Moving object {0} {1} to {2}...`, node.path, node.object.type.toUpperCase(), escapedLibrary) }, async (progress) => {
                    const moveResult = await connection.runCommand({
                        command: `MOVOBJ OBJ(${node.path}) OBJTYPE(${node.object.type}) TOLIB(${newLibrary})`,
                        noLibList: true
                    });
                    if (moveResult.code !== 0) {
                        vscode_1.default.window.showErrorMessage(vscode_1.default.l10n.t(`Error moving object {0}! {1}`, node.path, moveResult.stderr));
                        return false;
                    }
                    if (!objectBrowser.autoRefresh(vscode_1.default.l10n.t(`Moved object {0} {1} to {2}.`, node.path, node.object.type.toUpperCase(), escapedLibrary))) {
                        vscode_1.default.window.showInformationMessage(vscode_1.default.l10n.t(`Moved object {0} {1} to {2}. Refresh object browser.`, node.path, node.object.type.toUpperCase(), escapedLibrary));
                    }
                    return true;
                });
            }
        } while (newLibrary && !newLibraryOK);
    }), vscode_1.default.commands.registerCommand("code-for-ibmi.objectBrowser.delete", async (node, nodes) => {
        const candidates = [];
        if (nodes) {
            candidates.push(...nodes);
        }
        else if (node) {
            candidates.push(node);
        }
        else {
            candidates.push(...objectTreeViewer.selection.filter(i => i instanceof ObjectBrowserItem));
        }
        const toBeDeleted = candidates.filter(item => item instanceof ObjectBrowserFilterItem || !item.isProtected());
        if (toBeDeleted.length) {
            const message = toBeDeleted.length === 1 ? vscode_1.default.l10n.t(`Are you sure you want to delete {0}?`, toBeDeleted[0].toString()) : vscode_1.default.l10n.t("Are you sure you want to delete these {0} elements?", toBeDeleted.length);
            const detail = toBeDeleted.length === 1 ? undefined : toBeDeleted.map(item => `- ${item.toString()}`).join("\n");
            if (await vscode_1.default.window.showWarningMessage(message, { modal: true, detail }, vscode_1.default.l10n.t(`Yes`))) {
                const increment = 100 / toBeDeleted.length;
                const toRefresh = new Set();
                let refreshBrowser = false;
                await vscode_1.default.window.withProgress({ title: vscode_1.default.l10n.t(`Deleting`), location: vscode_1.default.ProgressLocation.Notification }, async (task) => {
                    for (const item of toBeDeleted) {
                        task.report({ message: item.toString(), increment });
                        await item.delete();
                        if (!item.parent) {
                            //No parent (a filter): the whole browser needs to be refreshed
                            refreshBrowser = true;
                            toRefresh.clear();
                        }
                        if (!refreshBrowser && item.parent) {
                            //Refresh the element's parent unless its own parent must be refreshed
                            let parent = item.parent;
                            let found = false;
                            while (!found && parent) {
                                found = toRefresh.has(parent);
                                parent = parent.parent;
                            }
                            if (!found) {
                                toRefresh.add(item.parent);
                            }
                        }
                    }
                });
                if (refreshBrowser) {
                    vscode_1.default.commands.executeCommand(`code-for-ibmi.refreshObjectBrowser`);
                }
                else {
                    toRefresh.forEach(item => item.refresh?.());
                }
            }
        }
    }), vscode_1.default.commands.registerCommand(`code-for-ibmi.searchObjectBrowser`, async () => {
        vscode_1.default.commands.executeCommand('objectBrowser.focus');
        vscode_1.default.commands.executeCommand('list.find');
    }), vscode_1.default.commands.registerCommand(`code-for-ibmi.renameQSYS`, async (node) => {
        node = getSelectedItems(node).at(0);
        if (node instanceof ObjectBrowserObjectItem || node instanceof ObjectBrowserSourcePhysicalFileItem) {
            vscode_1.default.commands.executeCommand(`code-for-ibmi.renameObject`, node);
        }
        else if (node instanceof ObjectBrowserMemberItem) {
            vscode_1.default.commands.executeCommand(`code-for-ibmi.renameMember`, node);
        }
    }), vscode_1.default.commands.registerCommand(`code-for-ibmi.objectBrowser.selection`, getSelectedItems));
}
exports.initializeObjectBrowser = initializeObjectBrowser;
function getConfig() {
    const config = instantiate_1.instance.getConnection()?.getConfig();
    if (config) {
        return config;
    }
    else {
        throw new Error(vscode_1.default.l10n.t(`Not connected to an IBM i`));
    }
}
function getConnection() {
    const connection = instantiate_1.instance.getConnection();
    if (connection) {
        return connection;
    }
    else {
        throw new Error(vscode_1.default.l10n.t(`Not connected to an IBM i`));
    }
}
function getContent() {
    const content = instantiate_1.instance.getConnection()?.getContent();
    if (content) {
        return content;
    }
    else {
        throw new Error(vscode_1.default.l10n.t(`Not connected to an IBM i`));
    }
}
function storeMemberList(path, list) {
    const storage = instantiate_1.instance.getStorage();
    if (storage) {
        const existingDirs = storage.getSourceList();
        existingDirs[path] = list;
        return storage.setSourceList(existingDirs);
    }
}
async function doSearch(searchTerm, parameters) {
    try {
        const total = await vscode_1.default.window.withProgress({
            location: vscode_1.default.ProgressLocation.Notification,
            title: vscode_1.default.l10n.t(`Searching`),
            cancellable: true
        }, async (progress, cancel) => {
            let total = 0;
            const increment = 100 / parameters.length;
            let appendResults = false;
            for (const parameter of parameters) {
                if (cancel.isCancellationRequested) {
                    return total;
                }
                const path = parameter.path;
                const filter = parameter.fillter;
                progress.report({ message: vscode_1.default.l10n.t(`"{0}" in {1}.`, searchTerm, path), increment });
                // NOTE: if more messages are added, lower the timeout interval
                const timeoutInternal = 9000;
                const searchMessages = [
                    // vscode.l10n.t(`This is taking a while because there are {0} members. Searching "{1}" in {2} still.`, members.length,  searchTerm,  path),
                    vscode_1.default.l10n.t(`What's so special about "{0}" anyway?`, searchTerm),
                    vscode_1.default.l10n.t(`Still searching "{0}" in {1}...`, searchTerm, path),
                    vscode_1.default.l10n.t(`While you wait, why not make some tea?`),
                    vscode_1.default.l10n.t(`Wow. This really is taking a while. Let's hope you get the result you want.`),
                    vscode_1.default.l10n.t(`Why was six afraid of seven?`),
                    // vscode.l10n.t(`How does one end up with {0} members?`, members.length),
                    vscode_1.default.l10n.t(`"{0}" in {1}.`, searchTerm, path),
                ];
                let currentMessage = 0;
                const messageTimeout = setInterval(() => {
                    if (currentMessage < searchMessages.length) {
                        progress.report({
                            message: searchMessages[currentMessage]
                        });
                        currentMessage++;
                    }
                    else {
                        clearInterval(messageTimeout);
                    }
                }, timeoutInternal);
                let memberFilter = '*';
                if (filter?.member && filter?.filterType !== "regex" && (0, Filter_1.singleGenericName)(filter.member)) {
                    memberFilter = filter?.member;
                }
                const [library, sourceFile] = path.split(`/`);
                const results = await Search_1.Search.searchMembers(instantiate_1.instance.getConnection(), library, sourceFile, searchTerm, memberFilter, filter?.protected);
                clearInterval(messageTimeout);
                if (cancel.isCancellationRequested) {
                    return;
                }
                if (results.hits.length) {
                    const objectNamesLower = IBMi_1.default.connectionManager.get(`ObjectBrowser.showNamesInLowercase`);
                    // Format result to be lowercase if the setting is enabled
                    results.hits.forEach(result => {
                        if (objectNamesLower === true) {
                            result.path = result.path.toLowerCase();
                        }
                    });
                    results.hits = results.hits.sort((a, b) => {
                        return a.path.localeCompare(b.path);
                    });
                    vscode_1.default.commands.executeCommand(`code-for-ibmi.setSearchResults`, results, appendResults);
                    appendResults = true;
                }
                total += results.hits.length;
            }
            return total;
        });
        if (!total) {
            vscode_1.default.window.showInformationMessage(vscode_1.default.l10n.t(`No results found searching for "{0}".`, searchTerm));
        }
    }
    catch (e) {
        vscode_1.default.window.showErrorMessage(vscode_1.default.l10n.t(`Error searching source members: {0}`, e));
    }
}
async function listObjects(item, filter) {
    return (await getContent().getObjectList(filter || item.filter, objectSortOrder()))
        .map(object => {
        return object.sourceFile ? new ObjectBrowserSourcePhysicalFileItem(item, object) : new ObjectBrowserObjectItem(item, object);
    });
}
async function deleteObject(object) {
    const connection = getConnection();
    const deleteResult = await connection.runCommand({
        command: `DLTOBJ OBJ(${object.library}/${object.name}) OBJTYPE(${object.type})`,
        noLibList: true
    });
    const isSuccess = deleteResult.code === 0;
    if (isSuccess) {
        const config = connection.getConfig();
        const libl = [config.currentLibrary, ...config.libraryList].map(library => connection.upperCaseName(library));
        if (libl.includes(connection.upperCaseName(object.name))) {
            vscode_1.commands.executeCommand(`code-for-ibmi.refreshLibraryListView`);
        }
    }
    else {
        vscode_1.default.window.showErrorMessage(vscode_1.default.l10n.t(`Error deleting object! {0}`, deleteResult.stderr));
    }
    return isSuccess;
}
//# sourceMappingURL=objectBrowser.js.map