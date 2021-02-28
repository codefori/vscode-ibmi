
const vscode = require('vscode');

var instance = require('../Instance');

module.exports = class objectBrowserProvider {
  /**
   * @param {vscode.ExtensionContext} context
   */
  constructor(context) {
    this.selections = undefined;
    this.emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.emitter.event;

    // used for targeted member list refreshes
    this.targetLib = '*ALL';

    /** @type {{[library: string]: Object[]}} */
    this.refreshCache = {};

    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration(event => {
        let affected = event.affectsConfiguration("code-for-ibmi.libraryList");
        if (affected) {
          this.refresh();
        }
      }),

      vscode.commands.registerCommand(`code-for-ibmi.refreshObjectList`, async () => {
        this.refresh();
      })
    )
  }

  /**
   * @param {string} lib 
   */
  refresh(lib = '*ALL') {
    this.targetLib = lib;
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
   * @param {Library?} element
   * @returns {Promise<vscode.TreeItem[]>};
   */
  async getChildren(element) {
    const content = instance.getContent();
    var items = [], item;

    if (element) { //Chosen SPF
      //Fetch members
      console.log(element.path);
      const lib = element.path;

      // init cache entry if not exists
      var cacheExists = element.path in this.refreshCache;
      if (!cacheExists) {
        this.refreshCache[element.path] = []; // init cache entry
      }

      // only refresh member list for specific target, all LIB/SPF, or if cache entry didn't exist
      if (!cacheExists || ([lib, '*ALL'].includes(this.targetLib))) {
        try {
          const objects = await content.getObjectList(lib);
          this.refreshCache[element.path] = []; // reset cache since we're getting new data

          let listItem;
          for (const object of objects) {
            listItem = new Object(object);
            items.push(listItem);
            this.refreshCache[element.path].push(listItem);
          }
        } catch (e) {
          console.log(e);
          item = new vscode.TreeItem("Error loading members.");
          vscode.window.showErrorMessage(e);
          items = [item];
        }

      } else {
        // add cached items to tree
        items.push(...this.refreshCache[element.path]);
      }
    } else {
      const connection = instance.getConnection();
      if (connection) {
        const libraries = connection.libraryList;

        for (var library of libraries) {
          library = library.toUpperCase();
          items.push(new Library(library));
        }
      }
    }
    return items;
  }
}

class Library extends vscode.TreeItem {
  /**
   * @param {string} label
   */
  constructor(label) {
    super(label, vscode.TreeItemCollapsibleState.Collapsed);

    this.contextValue = 'library';
    this.path = label.toUpperCase();
  }
}

class Object extends vscode.TreeItem {
  /**
   * 
   * @param {{library: string, name: string, type: string, text: string}} objectInfo
   */
  constructor({library, name, type, text}) {
    if (type.startsWith('*')) type = type.substring(1);
    
    const icon = objectIcons[type] || objectIcons[''];

    super(`${name.toLowerCase()}.${type.toLowerCase()}`);

    this.contextValue = 'object';
    this.path = `${library}/${name}`;
    this.type = type;
    this.description = text;
    this.iconPath = new vscode.ThemeIcon(icon)
  }
}

//https://code.visualstudio.com/api/references/icons-in-labels
const objectIcons = {
  'FILE': 'database',
  'PGM': 'terminal', 
  '': 'circle-large-outline'
}