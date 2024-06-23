import path from 'path';
import vscode, { TreeDataProvider } from "vscode";
import { OpenEditableOptions, SearchHit, SearchHitLine, SearchResults } from "../typings";

export class SearchView implements TreeDataProvider<any> {
  private _results: SearchResults = { term: "", hits: [] };
  private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined | null | void> = new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

  constructor(context: vscode.ExtensionContext) {
    context.subscriptions.push(
      vscode.commands.registerCommand(`code-for-ibmi.refreshSearchView`, async () => this.refresh()),
      vscode.commands.registerCommand(`code-for-ibmi.closeSearchView`, async () => vscode.commands.executeCommand(`setContext`, `code-for-ibmi:searchViewVisible`, false)),
      vscode.commands.registerCommand(`code-for-ibmi.collapseSearchView`, async () => this.collapse()),
      vscode.commands.registerCommand(`code-for-ibmi.setSearchResults`, async (searchResults: SearchResults) => this.setResults(searchResults))
    )
  }

  setViewVisible(visible: boolean) {
    vscode.commands.executeCommand(`setContext`, `code-for-ibmi:searchViewVisible`, visible);
  }

  setResults(results: SearchResults) {
    this._results = results;
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
}

class HitSource extends vscode.TreeItem {
  private readonly _path: string;
  private readonly _readonly?: boolean;

  constructor(readonly term: string, readonly result: SearchHit) {
    const hits = result.lines.length;
    super(computeSearchHitLabel(term, result), hits ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None);

    this.contextValue = `hitSource`;
    this.iconPath = vscode.ThemeIcon.File;
    this._path = result.path;
    this._readonly = result.readonly;
    this.tooltip = result.path;

    if (hits) {
      this.description = `${hits} hit${hits === 1 ? `` : `s`}`;
    }
    else {
      this.description = result.path;
      this.command = {
        command: `code-for-ibmi.openEditable`,
        title: `Open`,
        arguments: [this._path, { readonly: result.readonly } as OpenEditableOptions]
      };
    }
  }

  async getChildren(): Promise<LineHit[]> {
    return this.result.lines.map(line => new LineHit(this.term, this._path, line, this._readonly));
  }
}

class LineHit extends vscode.TreeItem {
  constructor(readonly term: string, readonly path: string, line: SearchHitLine, readonly?: boolean) {
    const highlights: [number, number][] = [];

    const upperContent = line.content.trim().toUpperCase();
    const upperTerm = term.toUpperCase();
    const openOptions: OpenEditableOptions = { readonly };
    let index = 0;

    // Calculate the highlights
    if (term.length > 0) {
      const positionLine = line.number - 1;
      while (index >= 0) {
        index = upperContent.indexOf(upperTerm, index);
        if (index >= 0) {
          highlights.push([index, index + term.length]);
          if (!openOptions.position) {
            openOptions.position = new vscode.Range(positionLine, index, positionLine, index + term.length)
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
      command: `code-for-ibmi.openEditable`,
      title: `Open`,
      arguments: [this.path, openOptions]
    };
  }
}

function computeSearchHitLabel(term: string, result: SearchHit) {
  const label = result.label || path.posix.basename(result.path);
  if (result.lines.length) {
    return label;
  }
  else {
    const position = label.indexOf(term);
    return {
      label,
      highlights: position > -1 ? [[position, term.length + position]] : undefined
    } as vscode.TreeItemLabel;
  }
}