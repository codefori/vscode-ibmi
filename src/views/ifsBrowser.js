
const vscode = require(`vscode`);
const os = require(`os`);
const path = require(`path`);

const { setSearchResults } = require(`../instantiate`);
const { GlobalConfiguration, ConnectionConfiguration } = require(`../api/Configuration`);
const { Search } = require(`../api/Search`);
const { Tools } = require(`../api/Tools`);

function getInstance() {
  const { instance } = (require(`../instantiate`));
  return instance;
}

module.exports = class IFSBrowser {
  /**
   * @param {vscode.ExtensionContext} context
   */
  constructor(context) {
    this.emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.emitter.event;
    this.treeViewer = vscode.window.createTreeView(
      `ifsBrowser`,
      {
        treeDataProvider: this,
        showCollapseAll: true
      }
    );

    context.subscriptions.push(
      vscode.commands.registerCommand(`code-for-ibmi.sortIFSFilesByName`, (/** @type {Object} */ directoryOrFile) => {
        const directory = directoryOrFile.parent ? directoryOrFile.parent : directoryOrFile;
        if (directory.sort.order !== `name`) {
          directory.sortBy({order: `name`, ascending:true})
        }
        else {
          directory.sort.ascending = !directory.sort.ascending
          directory.sortBy(directory.sort);
        }

        this.treeViewer.reveal(directory, { expand: true });
        this.refresh(directory);
      }),
      vscode.commands.registerCommand(`code-for-ibmi.sortIFSFilesByDate`, (/** @type {Object} */ directoryOrFile) => {
        const directory = directoryOrFile.parent ? directoryOrFile.parent : directoryOrFile;
        if (directory.sort.order !== `date`) {
          directory.sortBy({order: `date`, ascending:true})
        }
        else {
          directory.sort.ascending = !directory.sort.ascending
          directory.sortBy(directory.sort);
        }

        this.treeViewer.reveal(directory, { expand: true });
        this.refresh(directory);
      }),
      vscode.commands.registerCommand(`code-for-ibmi.refreshIFSBrowser`, async () => {
        this.refresh();
      }),

      vscode.commands.registerCommand(`code-for-ibmi.changeWorkingDirectory`, async (node) => {
        const config = getInstance().getConfig();
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
            config.homeDirectory = newDirectory;
            await ConnectionConfiguration.update(config);
            vscode.window.showInformationMessage(`Working directory changed to ${newDirectory}.`);
          }
        } catch (e) {
          console.log(e);
        }
      }),

      vscode.commands.registerCommand(`code-for-ibmi.addIFSShortcut`, async (node) => {
        const config = getInstance().getConfig();
        const content = getInstance().getContent();

        let newDirectory;

        let shortcuts = config.ifsShortcuts;
        let autoSortIFSShortcuts = config.autoSortIFSShortcuts;

        newDirectory = await vscode.window.showInputBox({
          prompt: `Path to IFS directory`,
          value: node ? node.path : undefined
        });

        try {
          if (newDirectory) {
            newDirectory = newDirectory.trim();

            if (await content.isDirectory(newDirectory) !== true) {
              throw(`${newDirectory} is not a directory.`);
            } else if (!shortcuts.includes(newDirectory)) {
              shortcuts.push(newDirectory);
              config.ifsShortcuts = shortcuts;
              await ConnectionConfiguration.update(config);
              if (autoSortIFSShortcuts === true) vscode.commands.executeCommand(`code-for-ibmi.sortIFSShortcuts`);
              if (GlobalConfiguration.get(`autoRefresh`)) this.refresh();
            }
          }
        } catch (e) {
          vscode.window.showErrorMessage(`Error creating IFS shortcut! ${e}`);
        }
      }),

      vscode.commands.registerCommand(`code-for-ibmi.removeIFSShortcut`, async (node) => {
        const { instance } = (require(`../instantiate`));
        const config = getInstance().getConfig();

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
              config.ifsShortcuts = shortcuts;
              await ConnectionConfiguration.update(config);
              if (GlobalConfiguration.get(`autoRefresh`)) this.refresh();
            }
          }
        } catch (e) {
          console.log(e);
        }
      }),

      vscode.commands.registerCommand(`code-for-ibmi.sortIFSShortcuts`, async (node) => {
        /** @type {ConnectionConfiguration.Parameters} */
        const config = getInstance().getConfig();

        let shortcuts = config.ifsShortcuts;

        try {

          shortcuts.sort(function (a, b) {
            let x = a.toLowerCase();
            let y = b.toLowerCase();
            if (x < y) { return -1; }
            if (x > y) { return 1; }
            return 0;
          });
          config.ifsShortcuts = shortcuts;
          await ConnectionConfiguration.update(config);
          if (GlobalConfiguration.get(`autoRefresh`)) this.refresh();
        } catch (e) {
          console.log(e);
        }
      }),

      vscode.commands.registerCommand(`code-for-ibmi.moveIFSShortcutDown`, async (node) => {
        /** @type {ConnectionConfiguration.Parameters} */
        const config = getInstance().getConfig();

        let shortcuts = config.ifsShortcuts;

        if (node) {
          const moveDir = node.path ? node.path.trim() : null;

          if (moveDir) {
            try {
              const inx = shortcuts.indexOf(moveDir);

              if (inx >= 0 && inx < shortcuts.length) {
                shortcuts.splice(inx, 1);
                shortcuts.splice(inx + 1, 0, moveDir);
                config.ifsShortcuts = shortcuts;
                await ConnectionConfiguration.update(config);
                if (GlobalConfiguration.get(`autoRefresh`)) this.refresh();
              }
            } catch (e) {
              console.log(e);
            }
          }
        }
      }),

      vscode.commands.registerCommand(`code-for-ibmi.moveIFSShortcutUp`, async (node) => {
        /** @type {ConnectionConfiguration.Parameters} */
        const config = getInstance().getConfig();

        let shortcuts = config.ifsShortcuts;

        if (node) {
          const moveDir = node.path ? node.path.trim() : null;

          if (moveDir) {
            try {
              const inx = shortcuts.indexOf(moveDir);

              if (inx >= 1 && inx < shortcuts.length) {
                shortcuts.splice(inx, 1);
                shortcuts.splice(inx - 1, 0, moveDir);
                config.ifsShortcuts = shortcuts;
                await ConnectionConfiguration.update(config);
                if (GlobalConfiguration.get(`autoRefresh`)) this.refresh();
              }
            } catch (e) {
              console.log(e);
            }
          }
        }
      }),

      vscode.commands.registerCommand(`code-for-ibmi.moveIFSShortcutToTop`, async (node) => {
        /** @type {ConnectionConfiguration.Parameters} */
        const config = getInstance().getConfig();

        let shortcuts = config.ifsShortcuts;

        if (node) {
          const moveDir = node.path ? node.path.trim() : null;

          if (moveDir) {
            try {
              const inx = shortcuts.indexOf(moveDir);

              if (inx >= 1 && inx < shortcuts.length) {
                shortcuts.splice(inx, 1);
                shortcuts.splice(0, 0, moveDir);
                config.ifsShortcuts = shortcuts;
                await ConnectionConfiguration.update(config);
                if (GlobalConfiguration.get(`autoRefresh`)) this.refresh();
              }
            } catch (e) {
              console.log(e);
            }
          }
        }
      }),

      vscode.commands.registerCommand(`code-for-ibmi.moveIFSShortcutToBottom`, async (node) => {
        /** @type {ConnectionConfiguration.Parameters} */
        const config = getInstance().getConfig();

        let shortcuts = config.ifsShortcuts;

        if (node) {
          const moveDir = node.path ? node.path.trim() : null;

          if (moveDir) {
            try {
              const inx = shortcuts.indexOf(moveDir);

              if (inx >= 0 && inx < shortcuts.length) {
                shortcuts.splice(inx, 1);
                shortcuts.splice(shortcuts.length, 0, moveDir);
                config.ifsShortcuts = shortcuts;
                await ConnectionConfiguration.update(config);
                if (GlobalConfiguration.get(`autoRefresh`)) this.refresh();
              }
            } catch (e) {
              console.log(e);
            }
          }
        }
      }),

      vscode.commands.registerCommand(`code-for-ibmi.createDirectory`, async (node) => {
        const connection = getInstance().getConnection();
        /** @type {ConnectionConfiguration.Parameters} */
        const config = getInstance().getConfig();
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
            await connection.paseCommand(`mkdir ${Tools.escapePath(fullName)}`);

            if (GlobalConfiguration.get(`autoRefresh`)) this.refresh();

          } catch (e) {
            vscode.window.showErrorMessage(`Error creating new directory! ${e}`);
          }
        }
      }),

      vscode.commands.registerCommand(`code-for-ibmi.createStreamfile`, async (node) => {
        /** @type {ConnectionConfiguration.Parameters} */
        const config = getInstance().getConfig();
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
          const connection = getInstance().getConnection();

          try {
            vscode.window.showInformationMessage(`Creating streamfile ${fullName}.`);

            await connection.paseCommand(`echo "" > ${Tools.escapePath(fullName)}`);

            vscode.commands.executeCommand(`code-for-ibmi.openEditable`, fullName);

            if (GlobalConfiguration.get(`autoRefresh`)) this.refresh();

          } catch (e) {
            vscode.window.showErrorMessage(`Error creating new streamfile! ${e}`);
          }
        }
      }),

      vscode.commands.registerCommand(`code-for-ibmi.uploadStreamfile`, async (node) => {
        const connection = getInstance().getConnection();
        const client = connection.client;
        /** @type {ConnectionConfiguration.Parameters} */
        const config = getInstance().getConfig();

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

        if (chosenFiles) {
          chosenFiles.forEach(uri => {
            uploads.push({
              local: uri.fsPath,
              remote: path.posix.join(root, path.basename(uri.fsPath))
            })
          });
        }

        if (uploads.length > 0) {
          client.putFiles(uploads, {
            concurrency: 5,
          }).then(() => {
            if (GlobalConfiguration.get(`autoRefresh`)) this.refresh();
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
          if (node.path === `/`) {
            vscode.window.showErrorMessage(`Unable to delete root (/) from the IFS Browser.`);
            return;
          }

          //Running from right click
          let deletionConfirmed = false;
          let result = await vscode.window.showWarningMessage(`Are you sure you want to delete ${node.path}?`, `Yes`, `Cancel`);

          if (result === `Yes`) {
            if ((GlobalConfiguration.get(`safeDeleteMode`)) && node.contextValue === `directory`) { //Check if path is directory
              const dirName = path.basename(node.path)  //Get the name of the directory to be deleted

              const deletionPrompt = `Once you delete the directory, it cannot be restored.\nPlease type \"` + dirName + `\" to confirm deletion.`;
              const input = await vscode.window.showInputBox({
                placeHolder: dirName,
                prompt: deletionPrompt,
                validateInput: text => {
                  return (text === dirName) ? null : deletionPrompt + ` (Press \'Escape\' to cancel)`;
                }
              });
              deletionConfirmed = (input === dirName);
            }
            else // If deleting a file rather than a directory, skip the name entry
              deletionConfirmed = true;

            if (deletionConfirmed) {
              const connection = getInstance().getConnection();

              try {
                await connection.paseCommand(`rm -rf ${Tools.escapePath(node.path)}`)

                vscode.window.showInformationMessage(`Deleted ${node.path}.`);

                if (GlobalConfiguration.get(`autoRefresh`)) this.refresh();
              } catch (e) {
                vscode.window.showErrorMessage(`Error deleting streamfile! ${e}`);
              }

            }
            else {
              vscode.window.showInformationMessage(`Deletion canceled.`);
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
            const connection = getInstance().getConnection();

            try {
              await connection.paseCommand(`mv ${Tools.escapePath(node.path)} ${Tools.escapePath(fullName)}`);
              if (GlobalConfiguration.get(`autoRefresh`)) this.refresh();

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
        /** @type {ConnectionConfiguration.Parameters} */
        const config = getInstance().getConfig();
        const homeDirectory = config.homeDirectory;

        if (node) {
          //Running from right click

          let fullName = await vscode.window.showInputBox({
            prompt: `Name of new path`,
            value: node.path.endsWith(`/`) ? node.path.substring(0, node.path.length - 1) : node.path
          });

          if (fullName) {
            fullName = fullName.startsWith(`/`) ? fullName : homeDirectory + `/` + fullName;
            const connection = getInstance().getConnection();

            try {
              await connection.paseCommand(`cp -r ${Tools.escapePath(node.path)} ${Tools.escapePath(fullName)}`);
              if (GlobalConfiguration.get(`autoRefresh`)) this.refresh();
              vscode.window.showInformationMessage(`${Tools.escapePath(node.path)} was copied to ${Tools.escapePath(fullName)}.`);

            } catch (e) {
              vscode.window.showErrorMessage(`Error copying ${node.contextValue}! ${e}`);
            }
          }

        } else {
          //Running from command
          console.log(this);
        }
      }),

      vscode.commands.registerCommand(`code-for-ibmi.searchIFS`, async (node) => {
        const connection = getInstance().getConnection();
        /** @type {ConnectionConfiguration.Parameters} */
        const config = getInstance().getConfig();

        if (connection.remoteFeatures.grep) {

          let searchPath;
          if (node)
            searchPath = node.path;
          else {
            searchPath = config.homeDirectory;
            searchPath = await vscode.window.showInputBox({
              value: searchPath,
              prompt: `Enter IFS directory to search`,
              title: `Search directory`
            })
          }

          if (!searchPath) return;

          let searchTerm = await vscode.window.showInputBox({
            prompt: `Search ${searchPath}.`
          });

          if (searchTerm) {
            try {
              await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Searching`,
              }, async progress => {
                progress.report({
                  message: `'${searchTerm}' in ${searchPath}.`
                });

                let results = await Search.searchIFS(getInstance(), searchPath, searchTerm);

                if (results.length > 0) {
                  results = results.map(a => ({ ...a, label: path.posix.relative(searchPath, a.path) }));
                  setSearchResults(searchTerm, results.sort((a, b) => a.path.localeCompare(b.path)));

                } else {
                  vscode.window.showInformationMessage(`No results found searching for '${searchTerm}' in ${searchPath}.`);
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
        const connection = getInstance().getConnection();
        const client = connection.client;

        if (node) {
          //Get filename from path on server
          const filename = path.basename(node.path);

          const remoteFilepath = path.join(os.homedir(), filename);

          let localFilepath = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(remoteFilepath) });

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
      }),

      vscode.commands.registerCommand(`code-for-ibmi.ifs.copyPath`, async (node) => {
        await vscode.env.clipboard.writeText(node.path);
      }),
    )

    getInstance().onEvent(`connected`, () => this.refresh());
  }

  refresh(target) {
    this.emitter.fire(target);
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
    const items = [];
    const connection = getInstance().getConnection();
    if (connection) {
      const content = getInstance().getContent();
      const config = getInstance().getConfig();

      if (element) { //Chosen directory
        //Fetch members
        try {
          const objects = await content.getFileList(element.path, element.sort, this.handleFileListErrors);
          items.push(...objects.filter(o => o.type === `directory`)
            .concat(objects.filter(o => o.type === `streamfile`))
            .map(object => new Object(object.type, object.name, object.path, object.size, object.modified, object.owner, object.type === `streamfile` ? element : undefined)));

          await this.storeIFSList(element.path, objects.filter(o => o.type === `streamfile`).map(o => o.name));

        } catch (e) {
          console.log(e);
          vscode.window.showErrorMessage(e.message);
          items.push(new vscode.TreeItem(`Error loading objects.`));
        }

      } else {
        items.push(...config.ifsShortcuts.map(directory => new Object(`shortcut`, directory, directory)));
      }
    }

    return items;
  }

  getParent(item) {
    return item.parent;
  }

  /**
   * 
   * @param {string[]} errors 
   */
  handleFileListErrors(errors) {
    errors.forEach(error => vscode.window.showErrorMessage(error));
    vscode.window.showErrorMessage(`${errors.length} error${errors.length > 1 ? `s` : ``} occurred while listing files.`);
  }

  /**
   *
   * @param {string} path
   * @param {string[]} list
   */
  storeIFSList(path, list) {
    const storage = getInstance().getStorage();
    const existingDirs = storage.getSourceList();

    existingDirs[path] = list;

    return storage.setSourceList(existingDirs);
  }
}

class Object extends vscode.TreeItem {
  /**
   * @param {"shortcut"|"directory"|"streamfile"} type
   * @param {string} label
   * @param {string} path
   * @param {number} [size]
   * @param {Date} [modified]
   * @param {string} [owner]
   * @param {Object?} parent
   */
  constructor(type, label, path, size, modified, owner, parent) {
    super(label);

    this.contextValue = type;
    this.path = path;
    this.tooltip = `${path}`
      .concat(`${size !== undefined ? `\nSize:\t\t${size}` : ``}`)
      .concat(`${modified ? `\nModifed:\t${new Date(modified.getTime()-modified.getTimezoneOffset()*60*1000).toISOString().slice(0,19).replace(`T`, ` `)}` : ``}`)
      .concat(`${owner ? `\nOwner:\t${owner.toUpperCase()}` : ``}`);
    this.parent = parent;

    if (type === `shortcut` || type === `directory`) {
      this.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
    } else {
      this.resourceUri = vscode.Uri.parse(path).with({ scheme: `streamfile` });
      this.command = {
        command: `code-for-ibmi.openEditable`,
        title: `Open Streamfile`,
        arguments: [path]
      };
    }

    /** @type {import("../api/IBMiContent").SortOptions}*/
    this.sort = { order: `?` };
  }

  sortBy(/** @type {import("../api/IBMiContent").SortOptions}*/ sort) {
    this.sort = sort;
    this.description = `(sort: ${sort.order} ${sort.ascending ? `🔼` : `🔽`})`;
  }
}