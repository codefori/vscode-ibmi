
const vscode = require(`vscode`);
const os = require(`os`);
const path = require(`path`);

let instance = require(`../Instance`);
const Configuration = require(`../api/Configuration`);
const Search = require(`../api/Search`);

module.exports = class ifsBrowserProvider {
  /**
   * @param {vscode.ExtensionContext} context
   */
  constructor(context) {
    this.emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.emitter.event;

    context.subscriptions.push(

      vscode.commands.registerCommand(`code-for-ibmi.refreshIFSBrowser`, async () => {
        this.refresh();
      }),

      vscode.commands.registerCommand(`code-for-ibmi.changeWorkingDirectory`, async (node) => {
        const config = instance.getConfig();
        const homeDirectory = config.homeDirectory;

        let newDirectory;

        if (node) {
          newDirectory = node.path;
        } else {
          newDirectory = await vscode.window.showInputBox({
            prompt: `Changing working directory`,
            value: homeDirectory
          });
        }

        try {
          if (newDirectory && newDirectory !== homeDirectory) {
            await config.set(`homeDirectory`, newDirectory);

            vscode.window.showInformationMessage(`Working directory changed to ${newDirectory}.`);
          }
        } catch (e) {
          console.log(e);
        }
      }),

      vscode.commands.registerCommand(`code-for-ibmi.addIFSShortcut`, async (node) => {
        const config = instance.getConfig();

        let newDirectory;

        let shortcuts = config.ifsShortcuts;

        if (node) {
          newDirectory = node.path;
        } else {
          newDirectory = await vscode.window.showInputBox({
            prompt: `Path to IFS directory`,
          });
        }

        try {
          if (newDirectory) {
            newDirectory = newDirectory.trim();
            
            if (!shortcuts.includes(newDirectory)) {
              shortcuts.push(newDirectory);
              await config.set(`ifsShortcuts`, shortcuts);
              if (Configuration.get(`autoRefresh`)) this.refresh();
            }
          }
        } catch (e) {
          console.log(e);
        }
      }),

      vscode.commands.registerCommand(`code-for-ibmi.removeIFSShortcut`, async (node) => {
        const config = instance.getConfig();

        let removeDir;

        let shortcuts = config.ifsShortcuts;

        if (node) {
          removeDir = node.path;
        } else {
          removeDir = await vscode.window.showQuickPick(shortcuts, {
            placeHolder: `Select IFS directory to remove`,
          });
        }

        try {
          if (removeDir) {
            removeDir = removeDir.trim();

            const inx = shortcuts.indexOf(removeDir);
            
            if (inx >= 0) {
              shortcuts.splice(inx, 1);
              await config.set(`ifsShortcuts`, shortcuts);
              if (Configuration.get(`autoRefresh`)) this.refresh();
            }
          }
        } catch (e) {
          console.log(e);
        }
      }),

      vscode.commands.registerCommand(`code-for-ibmi.createDirectory`, async (node) => {
        const connection = instance.getConnection();
        const config = instance.getConfig();
        let root;

        if (node) {
          //Running from right click
          
          root = node.path;
        } else {
          root = config.homeDirectory;
        }

        const fullName = await vscode.window.showInputBox({
          prompt: `Path of new folder`,
          value: root
        });

        if (fullName) {

          try {
            await connection.paseCommand(`mkdir "${fullName}"`);

            if (Configuration.get(`autoRefresh`)) this.refresh();

          } catch (e) {
            vscode.window.showErrorMessage(`Error creating new directory! ${e}`);
          }
        }
      }),

      vscode.commands.registerCommand(`code-for-ibmi.createStreamfile`, async (node) => {
        const connection = instance.getConnection();
        const config = instance.getConfig();
        let root;

        if (node) {
          //Running from right click
          
          root = node.path;
        } else {
          root = config.homeDirectory;
        }
        
        const fullName = await vscode.window.showInputBox({
          prompt: `Name of new streamfile`,
          value: root
        });

        if (fullName) {
          const connection = instance.getConnection();

          try {
            vscode.window.showInformationMessage(`Creating streamfile ${fullName}.`);

            await connection.paseCommand(`echo "" > "${fullName}"`);

            vscode.commands.executeCommand(`code-for-ibmi.openEditable`, fullName);

            if (Configuration.get(`autoRefresh`)) this.refresh();

          } catch (e) {
            vscode.window.showErrorMessage(`Error creating new streamfile! ${e}`);
          }
        }
      }),

      vscode.commands.registerCommand(`code-for-ibmi.uploadStreamfile`, async (node) => {
        const connection = instance.getConnection();
        const client = connection.client;
        const config = instance.getConfig();

        let root;

        if (node && node.path) {
          //Running from right click
          root = node.path;
        } else {
          root = config.homeDirectory;
        }

        const chosenFiles = await vscode.window.showOpenDialog({ defaultUri: vscode.Uri.file(os.homedir()), canSelectMany: true });

        /** @type {{local: string, remote: string}[]} */
        const uploads = [];
        
        chosenFiles.forEach(uri => {
          uploads.push({
            local: uri.fsPath,
            remote: path.posix.join(root, path.basename(uri.fsPath))
          })
        });

        if (uploads.length > 0) {
          client.putFiles(uploads, {
            concurrency: 5,
          }).then(() => {
            if (Configuration.get(`autoRefresh`)) this.refresh();
            vscode.window.showInformationMessage(`Uploaded files.`);
          }).catch(err => {
            vscode.window.showInformationMessage(`Uploaded files.`);
          });
        } else {
          vscode.window.showInformationMessage(`No files selected.`);
        }
      }),

      vscode.commands.registerCommand(`code-for-ibmi.deleteIFS`, async (node) => {

        if (node) {
          //Running from right click
          let result = await vscode.window.showWarningMessage(`Are you sure you want to delete ${node.path}?`, `Yes`, `Cancel`);

          if (result === `Yes`) {
            const connection = instance.getConnection();

            try {
              await connection.paseCommand(`rm -rf "${node.path}"`)

              vscode.window.showInformationMessage(`Deleted ${node.path}.`);

              if (Configuration.get(`autoRefresh`)) this.refresh();
            } catch (e) {
              vscode.window.showErrorMessage(`Error deleting streamfile! ${e}`);
            }
          }
        } else {
          //Running from command.
        }
      }),

      vscode.commands.registerCommand(`code-for-ibmi.moveIFS`, async (node) => {
        if (node) {
          //Running from right click
          
          const fullName = await vscode.window.showInputBox({
            prompt: `Name of new path`,
            value: node.path
          });

          if (fullName) {
            const connection = instance.getConnection();

            try {
              await connection.paseCommand(`mv "${node.path}" "${fullName}"`);
              if (Configuration.get(`autoRefresh`)) this.refresh();

            } catch (e) {
              vscode.window.showErrorMessage(`Error moving streamfile! ${e}`);
            }
          }

        } else {
          //Running from command
          console.log(this);
        }
      }),
      vscode.commands.registerCommand(`code-for-ibmi.copyIFS`, async (node) => {
        if (node) {
          //Running from right click
          
          const fullName = await vscode.window.showInputBox({
            prompt: `Name of new path`,
            value: node.path
          });

          if (fullName) {
            const connection = instance.getConnection();

            try {
              await connection.paseCommand(`cp "${node.path}" "${fullName}"`);
              if (Configuration.get(`autoRefresh`)) this.refresh();

            } catch (e) {
              vscode.window.showErrorMessage(`Error moving streamfile! ${e}`);
            }
          }

        } else {
          //Running from command
          console.log(this);
        }
      }),
      
      vscode.commands.registerCommand(`code-for-ibmi.searchIFS`, async (node) => {
        const connection = instance.getConnection();
        const config = instance.getConfig();

        if (connection.remoteFeatures.grep) {

          let path;
          if (node)
            path = node.path;
          else
            path = config.homeDirectory;

          let searchTerm = await vscode.window.showInputBox({
            prompt: `Search ${path}.`
          });

          if (searchTerm) {
            try {
              await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Searching`,
              }, async progress => {
                progress.report({
                  message: `'${searchTerm}' in ${path}.`
                });

                const results = await Search.searchIFS(instance, path, searchTerm);

                if (results.length > 0) {

                  instance.setSearchResults(searchTerm, results);

                } else {
                  vscode.window.showInformationMessage(`No results found.`);
                }
              });

            } catch (e) {
              vscode.window.showErrorMessage(`Error searching streamfiles.`);
            }
          }

        } else {
          vscode.window.showErrorMessage(`grep must be installed on the remote system for the IFS search.`);
        }
      }),

      vscode.commands.registerCommand(`code-for-ibmi.downloadStreamfile`, async (node) => {
        const connection = instance.getConnection();
        const client = connection.client;
        const content = instance.getContent();

        if (node) {
          //Get filename from path on server
          const filename = path.basename(node.path);

          const remoteFilepath = path.join(os.homedir(), filename);

          let localFilepath = await vscode.window.showSaveDialog({defaultUri: vscode.Uri.file(remoteFilepath)});

          if (localFilepath) {
            let localPath = localFilepath.path;
            if (process.platform === `win32`) {
              //Issue with getFile not working propertly on Windows
              //when there was a / at the start.
              if (localPath[0] === `/`) localPath = localPath.substring(1);
            }

            try {
              await client.getFile(localPath, node.path);
              vscode.window.showInformationMessage(`File was downloaded.`);
            } catch (e) {
              vscode.window.showErrorMessage(`Error downloading streamfile! ${e}`);
            }
          }

        } else {
          //Running from command.
        }
      })
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
   * @param {Object?} element
   * @returns {Promise<vscode.TreeItem[]>};
   */
  async getChildren(element) {
    const connection = instance.getConnection();
    const content = instance.getContent();
    let items = [], item;

    if (connection) {
      const config = instance.getConfig();
      
      if (element) { //Chosen directory
        //Fetch members
        console.log(element.path);

        try {
          const objects = await content.getFileList(element.path);

          items = objects.filter(o => o.type === `directory`)
            .concat(objects.filter(o => o.type === `streamfile`))
            .map(object => new Object(object.type, object.name, object.path));
          await this.storeIFSList(element.path, objects.filter(o => o.type === `streamfile`).map(o => o.name));

        } catch (e) {
          console.log(e);
          item = new vscode.TreeItem(`Error loading members.`);
          vscode.window.showErrorMessage(e);
          items = [item];
        }

      } else {
        items = config.ifsShortcuts.map(directory => new Object(`directory`, directory, directory));
        // const objects = await content.getFileList(config.homeDirectory);

        // for (let object of objects) {
        //   items.push(new Object(object.type, object.name, object.path));
        // }
      }
    }

    return items;
  }

  /**
   * 
   * @param {string} path 
   * @param {string[]} list 
   */
  storeIFSList(path, list) {
    const storage = instance.getStorage();
    const existingDirs = storage.get(`sourceList`) || {};

    existingDirs[path] = list;

    return storage.set(`sourceList`, existingDirs);
  }
}

class Object extends vscode.TreeItem {
  /**
   * @param {"directory"|"streamfile"} type 
   * @param {string} label 
   * @param {string} path
   */
  constructor(type, label, path) {
    super(label);

    this.contextValue = type;
    this.path = path;

    if (type === `directory`) {
      this.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
    } else {
      this.resourceUri = vscode.Uri.parse(path).with({scheme: `streamfile`});
      this.command = {
        command: `code-for-ibmi.openEditable`,
        title: `Open Streamfile`,
        arguments: [path]
      };
    }
  }
}
