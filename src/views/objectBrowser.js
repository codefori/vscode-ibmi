
const vscode = require(`vscode`);

let instance = require(`../Instance`);
const Configuration = require("../api/Configuration");

module.exports = class objectBrowserProvider {
  /**
   * @param {vscode.ExtensionContext} context
   */
  constructor(context) {
    this.selections = undefined;
    this.emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.emitter.event;

    // used for targeted member list refreshes
    this.targetLib = `*ALL`;

    /** @type {{[library: string]: Object[]}} */
    this.refreshCache = {};

    context.subscriptions.push(
      vscode.commands.registerCommand(`code-for-ibmi.refreshObjectList`, async (library) => {
        if (library) {
          if (typeof library === `string`) {
            this.refresh(library);
          } else if (library.path) {
            this.refresh(library.path);
          }
        } else {
          this.refresh();
        }
      }),

      vscode.commands.registerCommand(`code-for-ibmi.addLibraryToObjectBrowser`, async () => {
        const config = instance.getConfig();

        let libraries = config.objectBrowserList;

        const newLibrary = await vscode.window.showInputBox({
          prompt: `Library to add to Object Browser`
        });

        if (newLibrary) {
          if (newLibrary.length <= 10) {
            libraries.push(newLibrary.toUpperCase());
            await config.set(`objectBrowserList`, libraries);
            if (Configuration.get(`autoRefresh`)) this.refresh();
          } else {
            vscode.window.showErrorMessage(`Library name too long.`);
          }
        }
      }),

      vscode.commands.registerCommand(`code-for-ibmi.removeLibraryFromObjectBrowser`, async (node) => {
        if (node) {
          //Running from right click
          const config = instance.getConfig();

          let libraries = config.objectBrowserList;

          let index = libraries.findIndex(file => file.toUpperCase() === node.path)
          if (index >= 0) {
            libraries.splice(index, 1);
          }

          await config.set(`objectBrowserList`, libraries);
          if (Configuration.get(`autoRefresh`)) this.refresh();
        }
      }),
      vscode.commands.registerCommand(`code-for-ibmi.createSourceFile`, async (node) => {
        if (node) {
          //Running from right click
          const fileName = await vscode.window.showInputBox({
            prompt: `Name of new source file`
          });

          if (fileName) {
            const connection = instance.getConnection();
     
            if (fileName !== undefined && fileName.length > 0 && fileName.length <= 10) {
              try {
                const library = node.path.toUpperCase();
                const uriPath = `${library}/${fileName.toUpperCase()}`

                vscode.window.showInformationMessage(`Creating source file ${uriPath}.`);

                await connection.remoteCommand(
                  `CRTSRCPF FILE(${uriPath}) RCDLEN(112)`
                );

                if (Configuration.get(`autoRefresh`)) {
                  this.refresh();
                }
              } catch (e) {
                vscode.window.showErrorMessage(`Error creating source file! ${e}`);
              }
            } else {
              vscode.window.showErrorMessage(`Source filename must be 10 chars or less.`);
            }
          }

        } else {
          //Running from command
          console.log(this);
        }
      }),
      vscode.commands.registerCommand(`code-for-ibmi.Debug`, async (node) => {
        const config = instance.getConfig();
        let debugPath = config.debugPath;
        if (debugPath == '') {
         vscode.window.showErrorMessage("Debug path is undefined.");
        } else {
        let exec = require("child_process").exec;
        
        
        let cmd = "java -cp " + debugPath.trim() + "jt400.jar;"+ debugPath.trim() +"tes.jar utilities.DebugMgr";
        exec(cmd, (error, stdout, stderr) => {
          if (stderr) {
            vscode.window.showErrorMessage(stderr);
          } else {
            vscode.window.showInformationMessage("Debugging finished");
          }
        });
        }
      })
    )
  }

  /**
   * @param {string} lib 
   */
  refresh(lib = `*ALL`) {
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
    let items = [], item;

    if (element) { //Chosen SPF
      //Fetch members
      console.log(element.path);
      const lib = element.path;

      // init cache entry if not exists
      let cacheExists = element.path in this.refreshCache;
      if (!cacheExists) {
        this.refreshCache[element.path] = []; // init cache entry
      }

      // only refresh member list for specific target, all LIB/SPF, or if cache entry didn't exist
      if (!cacheExists || ([lib, `*ALL`].includes(this.targetLib))) {
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
          item = new vscode.TreeItem(`Error loading members.`);
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
        const config = instance.getConfig();
        const libraries = config.objectBrowserList;

        for (let library of libraries) {
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

    this.contextValue = `library`;
    this.path = label.toUpperCase();
  }
}

class Object extends vscode.TreeItem {
  /**
   * 
   * @param {{library: string, name: string, type: string, text: string}} objectInfo
   */
  constructor({library, name, type, text}) {
    if (type.startsWith(`*`)) type = type.substring(1);

    const icon = objectIcons[type] || objectIcons[``];

    super(`${name.toLowerCase()}.${type.toLowerCase()}`);

    this.contextValue = `object`;
    this.path = `${library}/${name}`;
    this.type = type;
    this.description = text;
    this.iconPath = new vscode.ThemeIcon(icon);
    this.resourceUri = vscode.Uri.parse(`${library}/${name}.${type}`).with({scheme: `object`})
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
