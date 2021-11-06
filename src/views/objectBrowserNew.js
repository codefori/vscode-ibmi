
const vscode = require(`vscode`);

let instance = require(`../Instance`);
const Configuration = require(`../api/Configuration`);

module.exports = class objectBrowserTwoProvider {
  /**
   * @param {vscode.ExtensionContext} context
   */
  constructor(context) {
    this.selections = undefined;
    this.emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.emitter.event;

    context.subscriptions.push(
      vscode.commands.registerCommand(`code-for-ibmi.refreshObjectBrowser`, async () => {
        this.refresh();
      }),

      vscode.commands.registerCommand(`code-for-ibmi.addFilterObjectBrowser`, async () => {
        const config = instance.getConfig();

        // TODO: create UI to add new filter
      }),

      vscode.commands.registerCommand(`code-for-ibmi.removeFilterFromObjectBrowser`, async (node) => {
        if (node) {
          // TODO: remove filter from config
        }
      }),
    )
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
   * @param {vscode.TreeItem|Filter|Object?} element
   * @returns {Promise<vscode.TreeItem[]>};
   */
  async getChildren(element) {
    const content = instance.getContent();
    const config = instance.getConfig();
    let items = [], item;

    if (element) {
      let filter;

      switch (element.contextValue) {
      case `filter`:
        filter = config.objectFilters.find(filter => filter.name === element.filter);
        const objects = await content.getObjectList(filter);
        items = objects.map(object => 
          object.type === `*FILE` ? new SPF(filter.name, object) : new Object(filter.name, object)
        );
        break;

      case `SPF`:
        filter = config.objectFilters.find(filter => filter.name === element.filter);
        const path = element.path.split(`/`);
        const members = await content.getMemberList(path[0], path[1], filter.member);
        items = members.map(member => new Member(member));
        break;
      }

    } else {
      const connection = instance.getConnection();

      if (connection) {
        const filters = config.objectFilters;

        items = filters.map(filter => new Filter(filter.name));
      }
    }
    return items;
  }
}

class Filter extends vscode.TreeItem {
  /**
   * @param {string} name
   */
  constructor(name) {
    super(name, vscode.TreeItemCollapsibleState.Collapsed);

    this.contextValue = `filter`;
    this.filter = name;
  }
}

class SPF extends vscode.TreeItem {
  /**
   * @param {string} filter Filter name
   * @param {{library: string, name: string}} detail
   */
  constructor(filter, detail) {
    super(detail.name.toLowerCase(), vscode.TreeItemCollapsibleState.Collapsed);

    this.filter = filter;

    this.contextValue = `SPF`;
    this.path = [detail.library, detail.name].join(`/`);

    this.iconPath = new vscode.ThemeIcon(`file-directory`);
  }
}

class Object extends vscode.TreeItem {
  /**
   * @param {string} filter Filter name
   * @param {{library: string, name: string, type: string, text: string}} objectInfo
   */
  constructor(filter, {library, name, type, text}) {
    if (type.startsWith(`*`)) type = type.substring(1);

    const icon = objectIcons[type] || objectIcons[``];

    super(`${name.toLowerCase()}.${type.toLowerCase()}`);

    this.filter = filter;

    this.contextValue = `object`;
    this.path = `${library}/${name}`;
    this.type = type;
    this.description = text;
    this.iconPath = new vscode.ThemeIcon(icon);
    this.resourceUri = vscode.Uri.parse(`${library}/${name}.${type}`).with({scheme: `object`})
  }
}

class Member extends vscode.TreeItem {
  constructor(member) {
    const path = `${member.asp ? `${member.asp}/` : ``}${member.library}/${member.file}/${member.name}.${member.extension}`;

    super(`${member.name}.${member.extension}`.toLowerCase());

    this.contextValue = `member`;
    this.description = member.text;
    this.path = path;
    this.resourceUri = vscode.Uri.parse(path).with({scheme: `member`, path: `/${path}`});
    this.command = {
      command: `code-for-ibmi.openEditable`,
      title: `Open Member`,
      arguments: [path]
    };
  }
}

//https://code.visualstudio.com/api/references/icons-in-labels
const objectIcons = {
  'FILE': `database`,
  'CMD': `terminal`,
  'MODULE': `extensions`,
  'PGM': `file-binary`,
  '': `circle-large-outline`
}