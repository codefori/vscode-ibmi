import fs from "fs";
import path from "path";
import vscode from "vscode";
import IBMi from "../../api/IBMi";
import { Tools } from "../../api/Tools";
import { instance } from "../../instantiate";
import { DefaultOpenMode, SearchHit, SearchHitLine, SearchResults, WithPath } from "../../typings";

export function initializeSearchView(context: vscode.ExtensionContext) {
  const searchView = new SearchView();
  const searchViewViewer = vscode.window.createTreeView(
    `searchView`, {
    treeDataProvider: searchView,
    showCollapseAll: true,
    canSelectMany: true
  });

  context.subscriptions.push(
    searchViewViewer,
    vscode.commands.registerCommand(`code-for-ibmi.refreshSearchView`, async () => searchView.refresh()),
    vscode.commands.registerCommand(`code-for-ibmi.closeSearchView`, async () => vscode.commands.executeCommand(`setContext`, `code-for-ibmi:searchViewVisible`, false)),
    vscode.commands.registerCommand(`code-for-ibmi.collapseSearchView`, async () => searchView.collapse()),
    vscode.commands.registerCommand(`code-for-ibmi.setSearchResults`, async (searchResults: SearchResults, appendResults?: boolean) => {
      const hits = appendResults ? searchView.hits + searchResults.hits.length : searchResults.hits.length;
      const warningCount = appendResults
        ? searchView.warningCount + (searchResults.warnings?.length || 0)
        : (searchResults.warnings?.length || 0);
      const isContentSearch = searchResults.hits.some(hit => hit.lines.length);

      if (isContentSearch) {
        searchViewViewer.message = vscode.l10n.t(`{0} file(s) contain(s) '{1}'`, hits, searchResults.term);

        if (warningCount) {
          searchViewViewer.message += vscode.l10n.t(` — Permission denied to {0} folder(s)`, warningCount);
        }
      }
      else {
        searchViewViewer.message = warningCount
          ? vscode.l10n.t(`{0} file(s) name '{1}' — Permission denied to {2} folder(s)`, hits, searchResults.term, warningCount)
          : vscode.l10n.t(`{0} file(s) name '{1}'`, hits, searchResults.term);
      }

      searchView.setResults(searchResults, appendResults);
    }),
    vscode.commands.registerCommand(`code-for-ibmi.downloadAllSearchResults`, () => downloadSearchHits(searchView.getHits())),
    vscode.commands.registerCommand(`code-for-ibmi.downloadSelectedSearchResults`, (node: HitSource, nodes?: HitSource[]) => downloadSearchHits((nodes || [node]).map(item => item.result))),
    vscode.commands.registerCommand(`code-for-ibmi.copyAllSearchResultNames`, () => copySearchHitNames(searchView.getHits())),
    vscode.commands.registerCommand(`code-for-ibmi.copySelectedSearchResultNames`, (node: HitSource, nodes?: HitSource[]) => copySearchHitNames((nodes || [node]).map(item => item.result)))
  )
}

async function copySearchHitNames(hits: SearchHit[]) {
  const names = hits.map(hit => path.posix.basename(hit.path))
    .filter(Boolean)
    .filter(Tools.distinct);

  if (names.length === 0) {
    vscode.window.showWarningMessage(vscode.l10n.t(`No search results to copy.`));
    return;
  }

  await vscode.env.clipboard.writeText(names.join(`\n`));
  vscode.window.showInformationMessage(
    vscode.l10n.t(`Copied {0} name(s) to the clipboard.`, names.length)
  );
}

async function downloadSearchHits(hits: SearchHit[]) {
  const connection = instance.getConnection();
  if (!connection) {
    return;
  }

  const uniqueHits = hits.filter(Tools.distinct);

  if (uniqueHits.length === 0) {
    vscode.window.showWarningMessage(vscode.l10n.t(`No search results to download.`));
    return;
  }

  const rootUriArray = await vscode.window.showOpenDialog({
    canSelectMany: false,
    canSelectFiles: false,
    canSelectFolders: true,
    openLabel: vscode.l10n.t(`Select download folder`),
    defaultUri: vscode.Uri.file(IBMi.GlobalStorage.getLastDownloadLocation()),
    title: vscode.l10n.t(`Download {0} search result(s)`, uniqueHits.length)
  });

  if (!rootUriArray || rootUriArray.length === 0) {
    return;
  }

  const rootPath = rootUriArray[0].fsPath;
  await IBMi.GlobalStorage.setLastDownloadLocation(rootPath);

  const contentApi = connection.getContent();

  await vscode.window.withProgress(
    { title: vscode.l10n.t(`Downloading {0} search result(s)`, uniqueHits.length), location: vscode.ProgressLocation.Notification },
    async (progress) => {
      let done = 0;
      const errors: string[] = [];

      for (const hit of uniqueHits) {
        progress.report({
          message: hit.path,
          increment: 100 / uniqueHits.length
        });

        try {
          if (hit.path.startsWith(`/`)) {
            const localFile = path.join(Tools.fixWindowsPath(rootPath), path.posix.basename(hit.path));
            await contentApi.downloadFile(localFile, hit.path);
          }
          else {
            const member = connection.parserMemberPath(hit.path);
            const localDir = path.join(rootPath, member.library.toUpperCase(), member.file.toUpperCase());
            const localFile = path.join(localDir, `${member.name.toUpperCase()}.${(member.extension || `MBR`).toUpperCase()}`);
            fs.mkdirSync(localDir, { recursive: true });
            const content = await contentApi.downloadMemberContent(member.library, member.file, member.name);
            if (content !== undefined) {
              fs.writeFileSync(localFile, content, `utf8`);
            }
          }
          done++;
        } catch (e: any) {
          errors.push(`${hit.path}: ${String(e)}`);
        }
      }

      if (errors.length > 0) {
        vscode.window.showWarningMessage(
          vscode.l10n.t(`{0} of {1} file(s) downloaded. {2} error(s).`, done, uniqueHits.length, errors.length),
          vscode.l10n.t(`Show Details`)
        ).then(action => {
          if (action) {
            vscode.window.showErrorMessage(errors.join(`\n`));
          }
        });
      } else {
        vscode.window.showInformationMessage(
          vscode.l10n.t(`{0} file(s) downloaded to {1}`, done, rootPath),
          vscode.l10n.t(`Open download folder`)
        ).then(action => {
          if (action) {
            vscode.commands.executeCommand(`revealFileInOS`, vscode.Uri.file(rootPath));
          }
        });
      }
    }
  );
}

class SearchView implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly _results: SearchResults = { term: "", hits: [], warnings: [] };
  private readonly _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined | null | void> = new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

  setViewVisible(visible: boolean) {
    vscode.commands.executeCommand(`setContext`, `code-for-ibmi:searchViewVisible`, visible);
  }

  setResults(results: SearchResults, appendResults?: boolean) {
    if(!appendResults){
      this._results.term = results.term;
      this._results.hits = [];
      this._results.warnings = [];
    }

    this._results.hits.push(...results.hits);
    this._results.warnings?.push(...(results.warnings || []));

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

  getHits(): SearchHit[] {
    return this._results.hits;
  }

  get hits() {
    return this._results.hits.length;
  }

  get warningCount() {
    return this._results.warnings?.length || 0;
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
