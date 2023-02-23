
import vscode from "vscode";
import { TreeDataProvider } from "vscode";
import path from 'path';
import { Search } from "../api/Search";

export class SearchView implements TreeDataProvider<any> {
  private _term = ``;
  private _results: Search.Result[] = [];
  private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined | null | void> = new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

  constructor(context: vscode.ExtensionContext) {
    context.subscriptions.push(
      vscode.commands.registerCommand(`code-for-ibmi.refreshSearchView`, async () => {
        this.refresh();
      }),

      vscode.commands.registerCommand(`code-for-ibmi.closeSearchView`, async () => {
        vscode.commands.executeCommand(`setContext`, `code-for-ibmi:searchViewVisible`, false);
      }),
    )
  }

  setViewVisible(visible: boolean) {
    vscode.commands.executeCommand(`setContext`, `code-for-ibmi:searchViewVisible`, visible);
  }

  setResults(term: string, results: Search.Result[]) {
    this._term = term;
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

  async getChildren(hitSource: HitSource): Promise<vscode.TreeItem[]> {
    if (!hitSource) {
      return this._results.map(result => new HitSource(result, this._term));
    } else {
      return hitSource.getChildren();
    }
  }
}

class HitSource extends vscode.TreeItem {
  private readonly _path: string;

  constructor(readonly result: Search.Result, readonly term: string) {
    super(result.label ? result.label : path.posix.basename(result.path), vscode.TreeItemCollapsibleState.Expanded);

    const hits = result.lines.length;
    this.contextValue = `hitSource`;
    this.iconPath = vscode.ThemeIcon.File;
    this.description = `${hits} hit${hits === 1 ? `` : `s`}`;
    this._path = result.path;   
  }

  async getChildren() : Promise<LineHit[]> {
    return this.result.lines.map(line => new LineHit(this.term, this._path, line));
  }
}

class LineHit extends vscode.TreeItem {
  constructor(term: string, readonly path: string, line: Search.Line) {
    const highlights: [number, number][] = [];

    const upperContent = line.content.trim().toUpperCase();
    const upperTerm = term.toUpperCase();
    let index = 0;

    // Calculate the highlights
    if (term.length > 0) {
      while (index >= 0) {
        index = upperContent.indexOf(upperTerm, index);
        if (index >= 0) {
          highlights.push([index, index + term.length]);
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

    this.description = String(line.number);

    this.command = {
      command: `code-for-ibmi.openEditable`,
      title: `Open`,
      arguments: [this.path, line.number - 1]
    };
  }
}