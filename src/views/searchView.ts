
import vscode from "vscode";
import { TreeDataProvider } from "vscode";
const path = require(`path`);

export interface IResult {
  path: string;
  lines: {
    number: number, content: string
  }[];
}

export class searchView implements TreeDataProvider<any> {
  private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined | null | void> = new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

  term: string = ``;
  results: IResult[] = [];

  constructor(context: vscode.ExtensionContext) {
    context.subscriptions.push(
      vscode.commands.registerCommand(`code-for-ibmi.refreshSearchView`, async () => {
        this.refresh();
      }),

      vscode.commands.registerCommand(`code-for-ibmi.closeSearchView`, async () => {
        vscode.commands.executeCommand(`setContext`, `code-for-ibmi:searchViewVisable`, false);
      }),
    )
  }

  setViewVisable(visable: boolean) {
    vscode.commands.executeCommand(`setContext`, `code-for-ibmi:searchViewVisable`, visable);
  }

  setResults(term: string, results: IResult[]) {
    this.term = term;
    this.results = results;
    this.refresh();
    this.setViewVisable(true);

    vscode.commands.executeCommand(`searchView.focus`)
  }

  refresh() {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: vscode.TreeItem) {
    return element;
  }

  /**
   * @param {HitSource} hitSource
   * @returns {};
   */
  async getChildren(hitSource: HitSource): Promise<vscode.TreeItem[]> {
    let items: vscode.TreeItem[] = [];

    if (hitSource) {
      const file = this.results.find(file => file.path === hitSource.path);
      if (file) {
        file.lines.forEach(line => {
          items.push(new LineHit(this.term, file.path, line.number, line.content));
        });
      }
    } else {
      this.results.forEach(file => {
        items.push(new HitSource(file.path, file.lines.length));
      });
    }

    return items;
  }
}

class HitSource extends vscode.TreeItem {
  path: string;
  constructor(hitPath: string, hits: number) {
    super(path.posix.basename(hitPath), vscode.TreeItemCollapsibleState.Expanded);

    this.contextValue = `hitSource`;
    
    this.iconPath = vscode.ThemeIcon.File;
    this.description = `${hits} hit${hits === 1 ? `` : `s`}`;
    this.path = hitPath;
  }
}

class LineHit extends vscode.TreeItem {
  path: string;

  constructor(term: string, hitPath: string, line: number, content: string) {
    const highlights: [number, number][] = [];

    const upperContent = content.trim().toUpperCase();
    const upperTerm = term.toUpperCase();
    let index = 0;

    // Calculate the highlights
    if (term.length > 0) {
      while (index >= 0) {
        index = upperContent.indexOf(upperTerm, index);
        if (index >= 0) {
          highlights.push([index, index+term.length]);
          index += term.length;
        }
      }
    }

    super({
      label: content.trim(),
      highlights
    });

    this.contextValue = `lineHit`;
    this.collapsibleState = vscode.TreeItemCollapsibleState.None;

    this.description = String(line);
    this.path = hitPath;

    this.command = {
      command: `code-for-ibmi.openEditable`,
      title: `Open`,
      arguments: [hitPath, line-1]
    };
  }
}