import path from 'path';
import vscode from "vscode";
import { DefaultOpenMode, SearchHit, SearchHitLine, SearchResults, WithPath } from "../../typings";

export function initializeSearchView(context: vscode.ExtensionContext) {
  const searchView = new SearchView();
  const searchViewViewer = vscode.window.createTreeView(
    `searchView`, {
    treeDataProvider: searchView,
    showCollapseAll: true,
    canSelectMany: false
  });

  context.subscriptions.push(
    searchViewViewer,
    vscode.commands.registerCommand(`code-for-ibmi.refreshSearchView`, async () => searchView.refresh()),
    vscode.commands.registerCommand(`code-for-ibmi.closeSearchView`, async () => vscode.commands.executeCommand(`setContext`, `code-for-ibmi:searchViewVisible`, false)),
    vscode.commands.registerCommand(`code-for-ibmi.collapseSearchView`, async () => searchView.collapse()),
    vscode.commands.registerCommand(`code-for-ibmi.setSearchResults`, async (searchResults: SearchResults, appendResults?: boolean) => {
      const hits = appendResults ? searchView.hits + searchResults.hits.length : searchResults.hits.length;
      if (searchResults.hits.some(hit => hit.lines.length)) {
        searchViewViewer.message = vscode.l10n.t(`{0} file(s) contain(s) '{1}'`, hits, searchResults.term);
      }
      else {
        searchViewViewer.message = vscode.l10n.t(`{0} file(s) named '{1}'`, hits, searchResults.term);
      }
      searchView.setResults(searchResults, appendResults);
    })
  )
}

class SearchView implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly _results: SearchResults = { term: "", hits: [] };
  private readonly _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined | null | void> = new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

  setViewVisible(visible: boolean) {
    vscode.commands.executeCommand(`setContext`, `code-for-ibmi:searchViewVisible`, visible);
  }

  setResults(results: SearchResults, appendResults?: boolean) {
    if(!appendResults){
      this._results.term = results.term;
      this._results.hits = [];      
    }    
    this._results.hits.push(...results.hits);
    
    this.refresh();
    this.setViewVisible(true);

    vscode.commands.executeCommand(`searchView.focus`)
  }

  refresh() {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: vscode.TreeItem) {
    return element;
  }

  collapse() {
    vscode.commands.executeCommand(`workbench.actions.treeView.searchView.collapseAll`);
  }

  async getChildren(hitSource: HitSource): Promise<vscode.TreeItem[]> {
    if (!hitSource) {
      return this._results.hits.map(hit => new HitSource(this._results.term, hit));
    } else {
      return hitSource.getChildren();
    }
  }

  get hits() {
    return this._results.hits.length;
  }
}

class HitSource extends vscode.TreeItem implements WithPath {
  private readonly _readonly?: boolean;
  readonly path: string;

  constructor(readonly term: string, readonly result: SearchHit) {
    const hits = result.lines.length;
    super(computeSearchHitLabel(term, result), hits ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None);

    this.contextValue = `hitSource`;
    this.iconPath = vscode.ThemeIcon.File;
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
        arguments: [this, this._readonly ? "browse" as DefaultOpenMode : undefined]
      };
    }
  }

  async getChildren(): Promise<LineHit[]> {
    return this.result.lines.map(line => new LineHit(this.term, this.path, line, this._readonly));
  }
}

class LineHit extends vscode.TreeItem {
  constructor(readonly term: string, readonly path: string, line: SearchHitLine, readonly?: boolean) {
    const highlights: [number, number][] = [];

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
            position = new vscode.Range(positionLine, offset, positionLine, offset + term.length)
          }
          index += term.length;
        }
      }
    }

    super({
      label: line.content.trim(),
      highlights
    });

    this.contextValue = `lineHit`;
    this.collapsibleState = vscode.TreeItemCollapsibleState.None;

    this.description = `line ${line.number}`;

    this.command = {
      command: `code-for-ibmi.openWithDefaultMode`,
      title: `Open`,
      arguments: [this, readonly ? "browse" as DefaultOpenMode : undefined, position]
    };
  }
}

function computeSearchHitLabel(term: string, result: SearchHit) {
  const label = result.label || path.posix.basename(result.path);
  if (result.lines.length) {
    return label;
  }
  else {
    const position = label.toLocaleLowerCase().lastIndexOf(term.toLocaleLowerCase());
    return {
      label,
      highlights: position > -1 ? [[position, term.length + position]] : undefined
    } as vscode.TreeItemLabel;
  }
}