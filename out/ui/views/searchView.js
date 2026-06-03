"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initializeSearchView = void 0;
const path_1 = __importDefault(require("path"));
const vscode_1 = __importDefault(require("vscode"));
function initializeSearchView(context) {
    const searchView = new SearchView();
    const searchViewViewer = vscode_1.default.window.createTreeView(`searchView`, {
        treeDataProvider: searchView,
        showCollapseAll: true,
        canSelectMany: false
    });
    context.subscriptions.push(searchViewViewer, vscode_1.default.commands.registerCommand(`code-for-ibmi.refreshSearchView`, async () => searchView.refresh()), vscode_1.default.commands.registerCommand(`code-for-ibmi.closeSearchView`, async () => vscode_1.default.commands.executeCommand(`setContext`, `code-for-ibmi:searchViewVisible`, false)), vscode_1.default.commands.registerCommand(`code-for-ibmi.collapseSearchView`, async () => searchView.collapse()), vscode_1.default.commands.registerCommand(`code-for-ibmi.setSearchResults`, async (searchResults, appendResults) => {
        const hits = appendResults ? searchView.hits + searchResults.hits.length : searchResults.hits.length;
        if (searchResults.hits.some(hit => hit.lines.length)) {
            searchViewViewer.message = vscode_1.default.l10n.t(`{0} file(s) contain(s) '{1}'`, hits, searchResults.term);
        }
        else {
            searchViewViewer.message = vscode_1.default.l10n.t(`{0} file(s) named '{1}'`, hits, searchResults.term);
        }
        searchView.setResults(searchResults, appendResults);
    }));
}
exports.initializeSearchView = initializeSearchView;
class SearchView {
    _results = { term: "", hits: [] };
    _onDidChangeTreeData = new vscode_1.default.EventEmitter();
    onDidChangeTreeData = this._onDidChangeTreeData.event;
    setViewVisible(visible) {
        vscode_1.default.commands.executeCommand(`setContext`, `code-for-ibmi:searchViewVisible`, visible);
    }
    setResults(results, appendResults) {
        if (!appendResults) {
            this._results.term = results.term;
            this._results.hits = [];
        }
        this._results.hits.push(...results.hits);
        this.refresh();
        this.setViewVisible(true);
        vscode_1.default.commands.executeCommand(`searchView.focus`);
    }
    refresh() {
        this._onDidChangeTreeData.fire();
    }
    getTreeItem(element) {
        return element;
    }
    collapse() {
        vscode_1.default.commands.executeCommand(`workbench.actions.treeView.searchView.collapseAll`);
    }
    async getChildren(hitSource) {
        if (!hitSource) {
            return this._results.hits.map(hit => new HitSource(this._results.term, hit));
        }
        else {
            return hitSource.getChildren();
        }
    }
    get hits() {
        return this._results.hits.length;
    }
}
class HitSource extends vscode_1.default.TreeItem {
    term;
    result;
    _readonly;
    path;
    constructor(term, result) {
        const hits = result.lines.length;
        super(computeSearchHitLabel(term, result), hits ? vscode_1.default.TreeItemCollapsibleState.Expanded : vscode_1.default.TreeItemCollapsibleState.None);
        this.term = term;
        this.result = result;
        this.contextValue = `hitSource`;
        this.iconPath = vscode_1.default.ThemeIcon.File;
        this.path = result.path;
        this._readonly = result.readonly;
        this.tooltip = result.path;
        if (hits) {
            this.description = `${hits} hit${hits === 1 ? `` : `s`}`;
        }
        else {
            this.description = result.path;
            this.command = {
                command: `code-for-ibmi.openWithDefaultMode`,
                title: `Open`,
                arguments: [this, this._readonly ? "browse" : undefined]
            };
        }
    }
    async getChildren() {
        return this.result.lines.map(line => new LineHit(this.term, this.path, line, this._readonly));
    }
}
class LineHit extends vscode_1.default.TreeItem {
    term;
    path;
    constructor(term, path, line, readonly) {
        const highlights = [];
        const upperContent = line.content.trim().toUpperCase();
        const upperTerm = term.toUpperCase();
        let index = 0;
        // Calculate the highlights
        let position;
        if (term.length > 0) {
            const positionLine = line.number - 1;
            while (index >= 0) {
                index = upperContent.indexOf(upperTerm, index);
                if (index >= 0) {
                    highlights.push([index, index + term.length]);
                    if (!position) {
                        const offset = index + (line.content.length - line.content.trimStart().length);
                        position = new vscode_1.default.Range(positionLine, offset, positionLine, offset + term.length);
                    }
                    index += term.length;
                }
            }
        }
        super({
            label: line.content.trim(),
            highlights
        });
        this.term = term;
        this.path = path;
        this.contextValue = `lineHit`;
        this.collapsibleState = vscode_1.default.TreeItemCollapsibleState.None;
        this.description = `line ${line.number}`;
        this.command = {
            command: `code-for-ibmi.openWithDefaultMode`,
            title: `Open`,
            arguments: [this, readonly ? "browse" : undefined, position]
        };
    }
}
function computeSearchHitLabel(term, result) {
    const label = result.label || path_1.default.posix.basename(result.path);
    if (result.lines.length) {
        return label;
    }
    else {
        const position = label.toLocaleLowerCase().lastIndexOf(term.toLocaleLowerCase());
        return {
            label,
            highlights: position > -1 ? [[position, term.length + position]] : undefined
        };
    }
}
//# sourceMappingURL=searchView.js.map