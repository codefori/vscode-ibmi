import path from 'path';
import vscode, { TreeDataProvider } from "vscode";
import { Find } from "../api/Find";
import { OpenEditableOptions } from "../typings";

export class FindView implements TreeDataProvider<any> {
  private _term = ``;
  private _results: Find.Result[] = [];
  private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined | null | void> = new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

  constructor(context: vscode.ExtensionContext) {
    context.subscriptions.push(
      vscode.commands.registerCommand(`code-for-ibmi.refreshFindView`, async () => {
        this.refresh();
      }),

      vscode.commands.registerCommand(`code-for-ibmi.closeFindView`, async () => {
        vscode.commands.executeCommand(`setContext`, `code-for-ibmi:findViewVisible`, false);
      }),
    )
  }

  setViewVisible(visible: boolean) {
    vscode.commands.executeCommand(`setContext`, `code-for-ibmi:findViewVisible`, visible);
  }

  setResults(term: string, results: Find.Result[]) {
    this._term = term;
    this._results = results;
    this.refresh();
    this.setViewVisible(true);

    vscode.commands.executeCommand(`findView.focus`)
  }

  refresh() {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: vscode.TreeItem) {
    return element;
  }

  async getChildren(): Promise<vscode.TreeItem[]> {
    return this._results.map(result => new HitSource(result, this._term));
  }
}

class HitSource extends vscode.TreeItem {
  private readonly _path: string;
  private readonly _readonly?: boolean;

  constructor(readonly result: Find.Result, readonly term: string, readonly?: boolean) {
    super(path.posix.basename(result.path), vscode.TreeItemCollapsibleState.Expanded);

    const openOptions: OpenEditableOptions = { readonly };

    this.contextValue = `hitSource`;
    this.iconPath = vscode.ThemeIcon.File;
    this.description = `${result.path}`;
    this._path = result.path;
    this._readonly = result.readonly;
    this.tooltip = result.path;
    this.command = {
      command: `code-for-ibmi.openEditable`,
      title: `Open`,
      arguments: [this._path, openOptions]
    };
  }
}
