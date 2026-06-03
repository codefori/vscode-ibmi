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
exports.LiblDecorationProvider = exports.initializeLibraryListView = void 0;
const path_1 = __importDefault(require("path"));
const vscode_1 = __importStar(require("vscode"));
const IBMi_1 = __importDefault(require("../../api/IBMi"));
const instantiate_1 = require("../../instantiate");
const typings_1 = require("../../typings");
const Tools_1 = require("../Tools");
function initializeLibraryListView(context) {
    const libraryListView = new LibraryListView();
    const libraryListViewViewer = vscode_1.default.window.createTreeView(`libraryListView`, {
        treeDataProvider: libraryListView,
        showCollapseAll: false,
        canSelectMany: true,
        dragAndDropController: new LibraryListDragAndDrop()
    });
    const liblDecorationProvider = new LiblDecorationProvider();
    const updateConfig = async (config) => {
        await IBMi_1.default.connectionManager.update(config);
        if (IBMi_1.default.connectionManager.get(`autoRefresh`)) {
            libraryListView.refresh();
        }
    };
    context.subscriptions.push(libraryListViewViewer, vscode_1.window.registerFileDecorationProvider(liblDecorationProvider), vscode_1.default.commands.registerCommand(`code-for-ibmi.userLibraryList.enable`, () => {
        vscode_1.commands.executeCommand(`setContext`, `code-for-ibmi:libraryListDisabled`, false);
    }), vscode_1.default.commands.registerCommand(`code-for-ibmi.refreshLibraryListView`, () => libraryListView.refresh()), vscode_1.default.commands.registerCommand(`code-for-ibmi.changeCurrentLibrary`, () => {
        const connection = instantiate_1.instance.getConnection();
        const storage = instantiate_1.instance.getStorage();
        if (connection && storage) {
            const config = connection.getConfig();
            const currentLibrary = connection.upperCaseName(config.currentLibrary);
            let prevCurLibs = storage.getPreviousCurLibs();
            let list = [...prevCurLibs];
            const listHeader = [
                { label: vscode_1.l10n.t(`Currently active`), kind: vscode_1.default.QuickPickItemKind.Separator },
                { label: currentLibrary },
                { label: vscode_1.l10n.t(`Recently used`), kind: vscode_1.default.QuickPickItemKind.Separator }
            ];
            const clearList = vscode_1.l10n.t(`$(trash) Clear list`);
            const clearListArray = [{ label: ``, kind: vscode_1.default.QuickPickItemKind.Separator }, { label: clearList }];
            const quickPick = vscode_1.default.window.createQuickPick();
            quickPick.items = listHeader.concat(list.map(lib => ({ label: lib }))).concat(clearListArray);
            quickPick.placeholder = vscode_1.l10n.t(`Filter or new library to set as current library`);
            quickPick.title = vscode_1.l10n.t(`Change current library`);
            quickPick.onDidChangeValue(() => {
                if (quickPick.value === ``) {
                    quickPick.items = listHeader.concat(list.map(lib => ({ label: lib }))).concat(clearListArray);
                }
                else if (!list.includes(connection.upperCaseName(quickPick.value))) {
                    quickPick.items = [{ label: connection.upperCaseName(quickPick.value) }].concat(listHeader)
                        .concat(list.map(lib => ({ label: lib })));
                }
            });
            quickPick.onDidAccept(async () => {
                const newLibrary = quickPick.selectedItems[0].label;
                if (newLibrary) {
                    if (newLibrary === clearList) {
                        await storage.setPreviousCurLibs([]);
                        list = [];
                        quickPick.items = list.map(lib => ({ label: lib }));
                        vscode_1.default.window.showInformationMessage(vscode_1.l10n.t(`Cleared list.`));
                        quickPick.show();
                    }
                    else {
                        if (newLibrary !== currentLibrary) {
                            if (await changeCurrentLibrary(newLibrary)) {
                                libraryListView.refresh();
                                quickPick.hide();
                            }
                        }
                        else {
                            quickPick.hide();
                            vscode_1.default.window.showInformationMessage(vscode_1.l10n.t(`{0} is already current library.`, newLibrary));
                        }
                    }
                }
            });
            quickPick.onDidHide(() => quickPick.dispose());
            quickPick.show();
        }
    }), vscode_1.default.commands.registerCommand(`code-for-ibmi.changeUserLibraryList`, async (libraries) => {
        const connection = instantiate_1.instance.getConnection();
        if (connection) {
            const content = connection.getContent();
            const config = connection.getConfig();
            const libraryList = config.libraryList;
            const newLibraryListStr = libraries?.join(",") || await vscode_1.default.window.showInputBox({
                prompt: vscode_1.l10n.t(`Changing library list (can use "*reset")`),
                value: libraryList.map(lib => connection.upperCaseName(lib)).join(`, `)
            });
            if (newLibraryListStr) {
                let newLibraryList = [];
                if (newLibraryListStr.toUpperCase() === `*RESET`) {
                    newLibraryList = connection.defaultUserLibraries;
                }
                else {
                    newLibraryList = newLibraryListStr
                        .replace(/,/g, ` `)
                        .split(` `)
                        .map(lib => connection.upperCaseName(lib))
                        .filter((lib, idx, libl) => lib && libl.indexOf(lib) === idx);
                    const badLibs = await content.validateLibraryList(newLibraryList);
                    if (badLibs.length > 0) {
                        newLibraryList = newLibraryList.filter(lib => !badLibs.includes(lib));
                        vscode_1.default.window.showWarningMessage(vscode_1.l10n.t(`The following libraries were removed from the updated library list as they are invalid: {0}`, badLibs.join(', ')));
                    }
                }
                config.libraryList = newLibraryList;
                await updateConfig(config);
            }
        }
    }), vscode_1.default.commands.registerCommand(`code-for-ibmi.addToLibraryList.prompt`, async () => {
        vscode_1.default.commands.executeCommand(`code-for-ibmi.addToLibraryList`, { library: await vscode_1.default.window.showInputBox({ prompt: vscode_1.l10n.t(`Library to add`) }) });
    }), vscode_1.default.commands.registerCommand(`code-for-ibmi.addToLibraryList`, async (newLibrary) => {
        const connection = instantiate_1.instance.getConnection();
        if (connection) {
            const content = connection.getContent();
            const config = connection.getConfig();
            const addingLib = connection.upperCaseName(newLibrary.library);
            if (addingLib.length > 10) {
                vscode_1.default.window.showErrorMessage(vscode_1.l10n.t(`Library is too long.`));
                return;
            }
            let libraryList = [...config.libraryList];
            if (libraryList.includes(addingLib)) {
                vscode_1.default.window.showWarningMessage(vscode_1.l10n.t(`Library {0} was already in the library list.`, addingLib));
                return;
            }
            let badLibs = await content.validateLibraryList([addingLib]);
            if (badLibs.length > 0) {
                libraryList = libraryList.filter(lib => !badLibs.includes(lib));
                vscode_1.default.window.showWarningMessage(vscode_1.l10n.t(`Library {0} does not exist.`, badLibs.join(', ')));
            }
            else {
                libraryList.push(addingLib);
                vscode_1.default.window.showInformationMessage(vscode_1.l10n.t(`Library {0} was added to the library list.`, addingLib));
            }
            badLibs = await content.validateLibraryList(libraryList);
            if (badLibs.length > 0) {
                libraryList = libraryList.filter(lib => !badLibs.includes(lib));
                vscode_1.default.window.showWarningMessage(vscode_1.l10n.t(`The following libraries were removed from the updated library list as they are invalid: {0}`, badLibs.join(', ')));
            }
            config.libraryList = libraryList;
            await updateConfig(config);
        }
    }), vscode_1.default.commands.registerCommand(`code-for-ibmi.removeFromLibraryList`, async (node, nodes) => {
        if (node) {
            //Running from right click
            nodes = nodes ? nodes : [node];
            const connection = instantiate_1.instance.getConnection();
            if (connection) {
                const config = connection.getConfig();
                const libraryList = config.libraryList;
                const removedLibs = [];
                nodes.map(n => n.library).forEach(lib => {
                    const index = libraryList.findIndex(library => connection.upperCaseName(library) === lib);
                    if (index >= 0) {
                        removedLibs.push(libraryList[index]);
                        libraryList.splice(index, 1);
                    }
                });
                config.libraryList = libraryList;
                await updateConfig(config);
                if (removedLibs.length === 1) {
                    vscode_1.default.window.showInformationMessage(vscode_1.l10n.t(`Library {0} was removed from the library list.`, removedLibs.join("")));
                }
                else {
                    vscode_1.default.window.showInformationMessage(vscode_1.l10n.t(`Libraries {0} were removed from the library list.`, removedLibs.join(", ")));
                }
            }
        }
    }), vscode_1.default.commands.registerCommand(`code-for-ibmi.moveLibraryUp`, async (node) => {
        if (node) {
            //Running from right click
            const connection = instantiate_1.instance.getConnection();
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
    }), vscode_1.default.commands.registerCommand(`code-for-ibmi.moveLibraryDown`, async (node) => {
        if (node) {
            //Running from right click
            const connection = instantiate_1.instance.getConnection();
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
    }), vscode_1.default.commands.registerCommand(`code-for-ibmi.cleanupLibraryList`, async () => {
        const connection = instantiate_1.instance.getConnection();
        if (connection) {
            const content = connection.getContent();
            const config = connection.getConfig();
            let libraryList = [...config.libraryList];
            const badLibs = await content.validateLibraryList(libraryList);
            if (badLibs.length > 0) {
                libraryList = libraryList.filter(lib => !badLibs.includes(lib));
                vscode_1.default.window.showWarningMessage(vscode_1.l10n.t(`The following libraries were removed from the updated library list as they are invalid: {0}`, badLibs.join(', ')));
                config.libraryList = libraryList;
                await updateConfig(config);
            }
            else {
                vscode_1.default.window.showInformationMessage(vscode_1.l10n.t(`Library list were validated without any errors.`));
            }
        }
    }), vscode_1.default.commands.registerCommand(`code-for-ibmi.setCurrentLibrary`, async (node) => {
        const library = node.library;
        if (library) {
            const connection = instantiate_1.instance.getConnection();
            const storage = instantiate_1.instance.getStorage();
            if (connection && storage) {
                const content = connection.getContent();
                if (await content.checkObject({ library: "QSYS", name: library, type: "*LIB" })) {
                    await changeCurrentLibrary(library);
                    libraryListView.refresh();
                }
            }
        }
    }));
}
exports.initializeLibraryListView = initializeLibraryListView;
class LibraryListDragAndDrop {
    dragMimeTypes = [];
    dropMimeTypes = [typings_1.URI_LIST_MIMETYPE];
    handleDrag(source, dataTransfer, token) {
        dataTransfer.set(typings_1.LIBRARY_LIST_MIMETYPE, new vscode_1.default.DataTransferItem(source));
    }
    handleDrop(target, dataTransfer, token) {
        const libraries = this.getLibraries(dataTransfer)?.map(library => library.toUpperCase());
        const config = instantiate_1.instance.getConnection()?.getConfig();
        if (config && libraries?.length) {
            if (target?.contextValue === 'currentLibrary') {
                //Dropped on current library: change current library
                vscode_1.default.commands.executeCommand(`code-for-ibmi.setCurrentLibrary`, { library: libraries[0] });
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
                vscode_1.default.commands.executeCommand(`code-for-ibmi.changeUserLibraryList`, libraryList);
            }
        }
    }
    getLibraries(dataTransfer) {
        const libraryListData = dataTransfer.get(typings_1.LIBRARY_LIST_MIMETYPE);
        const urisData = dataTransfer.get(typings_1.URI_LIST_MIMETYPE);
        if (libraryListData) {
            return libraryListData.value.map(node => node.library);
        }
        else if (urisData && urisData.value) {
            return String(urisData.value).split(typings_1.URI_LIST_SEPARATOR)
                .map(uri => vscode_1.default.Uri.parse(uri))
                .filter(uri => uri.scheme === "object")
                .map(uri => path_1.default.parse(uri.path))
                .filter(path => path.ext?.toUpperCase() === ".LIB")
                .map(path => path.name);
        }
    }
}
class LibraryListView {
    _emitter = new vscode_1.default.EventEmitter();
    onDidChangeTreeData = this._emitter.event;
    ;
    refresh(element) {
        this._emitter.fire(element);
    }
    getTreeItem(element) {
        return element;
    }
    async getChildren() {
        const items = [];
        const connection = instantiate_1.instance.getConnection();
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
class LibraryListNode extends vscode_1.default.TreeItem {
    library;
    object;
    constructor(library, object, context = `library`, showDescInLibList) {
        super(library, vscode_1.default.TreeItemCollapsibleState.None);
        this.library = library;
        this.object = object;
        this.contextValue = context;
        this.iconPath = new vscode_1.ThemeIcon('library');
        const isFound = object.text !== `*** NOT FOUND ***`;
        this.resourceUri = vscode_1.Uri.parse(`${context}:${library}?isFound=${isFound}`);
        this.description =
            ((context === `currentLibrary` ? `${vscode_1.l10n.t(`(current library)`)}` : ``)
                + (object.text !== `` && showDescInLibList ? ` ${object.text}` : ``)
                + (object.attribute !== `` ? ` (*${object.attribute})` : ``)).trim();
        this.tooltip = Tools_1.VscodeTools.objectToToolTip([object.library, object.name].join(`/`), object);
    }
}
async function changeCurrentLibrary(library) {
    const connection = instantiate_1.instance.getConnection();
    const storage = instantiate_1.instance.getStorage();
    if (connection && storage) {
        const config = connection.getConfig();
        const commandResult = await connection.runCommand({ command: `CHGCURLIB ${library}`, noLibList: true });
        if (commandResult.code === 0) {
            const currentLibrary = connection.upperCaseName(config.currentLibrary);
            config.currentLibrary = library;
            vscode_1.default.window.showInformationMessage(vscode_1.l10n.t(`Changed current library to {0}.`, library));
            storage.getPreviousCurLibs();
            const previousCurLibs = storage.getPreviousCurLibs().filter(lib => lib !== library);
            previousCurLibs.splice(0, 0, currentLibrary);
            await storage.setPreviousCurLibs(previousCurLibs);
            await IBMi_1.default.connectionManager.update(config);
            return true;
        }
        else {
            vscode_1.default.window.showErrorMessage(vscode_1.l10n.t(`Failed to set {0} as current library: {1}`, library, commandResult.stderr));
            return false;
        }
    }
}
class LiblDecorationProvider {
    onDidChangeFileDecorations;
    provideFileDecoration(uri, token) {
        const params = new URLSearchParams(uri.query);
        if (uri.scheme === 'currentLibrary' || uri.scheme === 'library') {
            const isNotFound = params.get('isFound') === 'false';
            if (isNotFound) {
                return {
                    badge: '⚠',
                    color: new vscode_1.ThemeColor('errorForeground')
                };
            }
        }
    }
}
exports.LiblDecorationProvider = LiblDecorationProvider;
//# sourceMappingURL=LibraryListView.js.map