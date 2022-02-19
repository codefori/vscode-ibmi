
const vscode = require(`vscode`);
const path = require(`path`);

module.exports = class searchView {
  /**
   * @param {vscode.ExtensionContext} context
   */
  constructor(context) {
    this.emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.emitter.event;

    this.term = ``;

    /** @type {{path: string, lines: {number: number, content: string}[]}[]} */
    this.results = [];

    context.subscriptions.push(
      vscode.commands.registerCommand(`code-for-ibmi.refreshSearchView`, async () => {
        this.refresh();
      }),

      vscode.commands.registerCommand(`code-for-ibmi.closeSearchView`, async () => {
        vscode.commands.executeCommand(`setContext`, `code-for-ibmi:searchViewVisable`, false);
      }),
    )
  }

  /**
   * @param {boolean} visable
   **/
  setViewVisable(visable) {
    vscode.commands.executeCommand(`setContext`, `code-for-ibmi:searchViewVisable`, visable);
  }

  setResults(term, results) {
    this.term = term;
    this.results = results;
    this.refresh();
    this.setViewVisable(true);

    vscode.commands.executeCommand(`searchView.focus`)
  }

  refresh() {
    this.emitter.fire();
  }

  /**
   * @param {vscode.TreeItem} element
   * @returns {vscode.TreeItem};
   */
  getTreeItem(element) {
    return element;
  }

  /**
   * @param {HitSource} hitSource
   * @returns {Promise<vscode.TreeItem[]>};
   */
  async getChildren(hitSource) {
    let items = [];

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
  constructor(hitPath, hits) {
    super(path.posix.basename(hitPath), vscode.TreeItemCollapsibleState.Expanded);

    this.contextValue = `hitSource`;
    
    this.iconPath = vscode.ThemeIcon.File;
    this.description = `${hits} hit${hits === 1 ? `` : `s`}`;
    this.path = hitPath;
  }
}

class LineHit extends vscode.TreeItem {
  constructor(term, hitPath, line, content) {
    /** @type {[number, number][]} */
    const highlights = [];

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

    this.description = line;
    this.path = hitPath;

    this.command = {
      command: `code-for-ibmi.openEditable`,
      title: `Open`,
      arguments: [hitPath, line-1]
    };
  }
}