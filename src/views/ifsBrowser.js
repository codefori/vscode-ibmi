
const vscode = require(`vscode`);
const os = require(`os`);
const path = require(`path`);

const { setSearchResults } = require(`../instantiate`);
const { GlobalConfiguration, ConnectionConfiguration } = require(`../api/Configuration`);
const { Search } = require(`../api/Search`);
const { GlobalStorage } = require(`../api/Storage`);
const { Tools } = require(`../api/Tools`);
const { t } = require(`../locale`);

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
            prompt: t(`ifsBrowser.changeWorkingDirectory.prompt`),
            value: homeDirectory
          });
        }

        try {
          if (newDirectory && newDirectory !== homeDirectory) {
            config.homeDirectory = newDirectory;
            await ConnectionConfiguration.update(config);
            vscode.window.showInformationMessage(t(`ifsBrowser.changeWorkingDirectory.message`, newDirectory));
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
          prompt: t(`ifsBrowser.addIFSShortcut.prompt`),
          value: node ? node.path : undefined
        });

        try {
          if (newDirectory) {
            newDirectory = newDirectory.trim();

            if (await content.isDirectory(newDirectory) !== true) {
              throw(t(`ifsBrowser.addIFSShortcut.error`, newDirectory));
            } else if (!shortcuts.includes(newDirectory)) {
              shortcuts.push(newDirectory);
              config.ifsShortcuts = shortcuts;
              await ConnectionConfiguration.update(config);
              if (autoSortIFSShortcuts === true) vscode.commands.executeCommand(`code-for-ibmi.sortIFSShortcuts`);
              if (GlobalConfiguration.get(`autoRefresh`)) this.refresh();
            }
          }
        } catch (e) {
          vscode.window.showErrorMessage(t(`ifsBrowser.addIFSShortcut.errorMessage`, e));
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
            placeHolder: t(`ifsBrowser.removeIFSShortcut.placeHolder`),
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
          prompt: t(`ifsBrowser.createDirectory.prompt`),
          value: root
        });

        if (fullName) {

          try {
            await connection.paseCommand(`mkdir ${Tools.escapePath(fullName)}`);

            if (GlobalConfiguration.get(`autoRefresh`)) this.refresh();

          } catch (e) {
            vscode.window.showErrorMessage(t(`ifsBrowser.createDirectory.errorMessage`, e));
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
          prompt: t(`ifsBrowser.createStreamfile.prompt`),
          value: root
        });

        if (fullName) {
          const connection = getInstance().getConnection();

          try {
            vscode.window.showInformationMessage(t(`ifsBrowser.createStreamfile.infoMessage`, fullName));

            await connection.paseCommand(`echo "" > ${Tools.escapePath(fullName)}`);

            vscode.commands.executeCommand(`code-for-ibmi.openEditable`, fullName);

            if (GlobalConfiguration.get(`autoRefresh`)) this.refresh();

          } catch (e) {
            vscode.window.showErrorMessage(t(`ifsBrowser.createStreamfile.errorMessage`, e));
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
            vscode.window.showInformationMessage(t(`ifsBrowser.uploadStreamfile.uploadedFiles`));
          }).catch(err => {
            vscode.window.showErrorMessage(t(`ifsBrowser.uploadStreamfile.errorMessage`, err));
          });
        } else {
          vscode.window.showInformationMessage(t(`ifsBrowser.uploadStreamfile.noFilesSelected`));
        }
      }),

      vscode.commands.registerCommand(`code-for-ibmi.deleteIFS`, async (node) => {

        if (node) {
          if (node.path === `/`) {
            vscode.window.showErrorMessage(t(`ifsBrowser.deleteIFS.rootNotAllowed`));
            return;
          }

          //Running from right click
          let deletionConfirmed = false;
          let result = await vscode.window.showWarningMessage(t(`ifsBrowser.deleteIFS.warningMessage`, node.path), t(`Yes`), t(`Cancel`));

          if (result === t(`Yes`)) {
            if ((GlobalConfiguration.get(`safeDeleteMode`)) && node.contextValue === `directory`) { //Check if path is directory
              const dirName = path.basename(node.path)  //Get the name of the directory to be deleted

              const deletionPrompt = t(`ifsBrowser.deleteIFS.deletionPrompt`, dirName);
              const input = await vscode.window.showInputBox({
                placeHolder: dirName,
                prompt: deletionPrompt,
                validateInput: text => {
                  return (text === dirName) ? null : deletionPrompt + t(`ifsBrowser.deleteIFS.deletionPrompt2`);
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

                vscode.window.showInformationMessage(t(`ifsBrowser.deleteIFS.infoMessage`, node.path));

                if (GlobalConfiguration.get(`autoRefresh`)) this.refresh();
              } catch (e) {
                vscode.window.showErrorMessage(t(`ifsBrowser.deleteIFS.errorMessage`, e));
              }

            }
            else {
              vscode.window.showInformationMessage(t(`ifsBrowser.deleteIFS.cancelled`));
            }


          }
        } else {
          //Running from command.
        }
      }),

      vscode.commands.registerCommand(`code-for-ibmi.moveIFS`, async (node) => {
        /** @type {ConnectionConfiguration.Parameters} */
        const config = getInstance().getConfig();
        const homeDirectory = config.homeDirectory;

        if (node) {
          //Running from right click

          let fullName = await vscode.window.showInputBox({
            prompt: t(`ifsBrowser.moveIFS.prompt`),
            value: node.path
          });

          if (fullName) {
            fullName = path.posix.isAbsolute(fullName) ? fullName : path.posix.join(homeDirectory, fullName);
            const connection = getInstance().getConnection();

            try {
              await connection.paseCommand(`mv ${Tools.escapePath(node.path)} ${Tools.escapePath(fullName)}`);
              if (GlobalConfiguration.get(`autoRefresh`)) this.refresh();
              vscode.window.showInformationMessage(t(path.posix.dirname(node.path) === path.posix.dirname(fullName) ? `ifsBrowser.moveIFS.renamed` : `ifsBrowser.moveIFS.moved`,
                Tools.escapePath(node.path),
                Tools.escapePath(fullName)
              ));

            } catch (e) {
              vscode.window.showErrorMessage(t(`ifsBrowser.moveIFS.errorMessage`, t(node.contextValue), e));
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
            prompt: t(`ifsBrowser.copyIFS.prompt`),
            value: node.path.endsWith(`/`) ? node.path.substring(0, node.path.length - 1) : node.path
          });

          if (fullName) {
            fullName = fullName.startsWith(`/`) ? fullName : homeDirectory + `/` + fullName;
            const connection = getInstance().getConnection();

            try {
              await connection.paseCommand(`cp -r ${Tools.escapePath(node.path)} ${Tools.escapePath(fullName)}`);
              if (GlobalConfiguration.get(`autoRefresh`)) this.refresh();
              vscode.window.showInformationMessage(t(`ifsBrowser.copyIFS.infoMessage`, Tools.escapePath(node.path), Tools.escapePath(fullName)));

            } catch (e) {
              vscode.window.showErrorMessage(t(`ifsBrowser.copyIFS.errorMessage`, t(node.contextValue), e));
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
              prompt: t(`ifsBrowser.searchIFS.prompt`),
              title: t(`ifsBrowser.searchIFS.title`)
            })
          }

          if (!searchPath) return;

          let list = GlobalStorage.get().getPreviousSearchTerms();
          const listHeader = [
            { label: t(`ifsBrowser.searchIFS.previousSearches`), kind: vscode.QuickPickItemKind.Separator }
          ];
          const clearList = t(`clearList`);
          const clearListArray = [{ label: ``, kind: vscode.QuickPickItemKind.Separator }, { label: clearList }];

          const quickPick = vscode.window.createQuickPick();
          quickPick.items = list.length > 0 ? listHeader.concat(list.map(term => ({ label: term }))).concat(clearListArray) : [];
          quickPick.placeholder = list.length > 0 ? t(`ifsBrowser.searchIFS.placeholder`) : t(`ifsBrowser.searchIFS.placeholder2`);
          quickPick.title = t(`ifsBrowser.searchIFS.title2`, searchPath);

          quickPick.onDidChangeValue(() => {
            if (quickPick.value === ``) {
              quickPick.items = listHeader.concat(list.map(term => ({ label: term }))).concat(clearListArray);
            } else if (!list.includes(quickPick.value)) {
              quickPick.items = [{ label: quickPick.value }].concat(listHeader)
                .concat(list.map(term => ({ label: term })))
            }
          })

          quickPick.onDidAccept(async () => {
            const searchTerm = quickPick.activeItems[0].label;
            if (searchTerm) {
              if (searchTerm === clearList) {
                GlobalStorage.get().setPreviousSearchTerms([]);
                list = [];
                quickPick.items = [];
                quickPick.placeholder = t(`ifsBrowser.searchIFS.placeholder2`);
                vscode.window.showInformationMessage(t(`clearedList`));
                quickPick.show();
              } else {
                quickPick.hide();
                list = list.filter(term => term !== searchTerm);
                list.splice(0, 0, searchTerm);
                GlobalStorage.get().setPreviousSearchTerms(list);
                await this.doSearchInStreamfiles(searchTerm, searchPath);
              }
            }
          });
          
          quickPick.onDidHide(() => quickPick.dispose());
          quickPick.show();

        } else {
          vscode.window.showErrorMessage(t(`ifsBrowser.searchIFS.noGrep`));
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
              vscode.window.showInformationMessage(t(`ifsBrowser.downloadStreamfile.infoMessage`));
            } catch (e) {
              vscode.window.showErrorMessage(t(`ifsBrowser.downloadStreamfile.errorMessage`, t(node.contextValue), e));
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
          items.push(new vscode.TreeItem(t(`ifsBrowser.getChildren.errorMessage`)));
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
    vscode.window.showErrorMessage(t(`ifsBrowser.handleFileListErrors.errorMessage`, errors.length, errors.length > 1 ? t(`errors`) : t(`error`)));
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

  /**
   *
   * @param {string} searchTerm
   * @param {string} searchPath
   */
  async doSearchInStreamfiles(searchTerm, searchPath) {
    try {
      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: t(`ifsBrowser.doSearchInStreamfiles.title`),
      }, async progress => {
        progress.report({
          message: t(`ifsBrowser.doSearchInStreamfiles.progressMessage`, searchTerm, searchPath)
        });

        let results = (await Search.searchIFS(getInstance(), searchPath, searchTerm))
          .map(a => ({ ...a, label: path.posix.relative(searchPath, a.path) }))
          .sort((a, b) => a.path.localeCompare(b.path));

        if (results.length > 0) {
          setSearchResults(searchTerm, results);
        } else {
          vscode.window.showInformationMessage(t(`ifsBrowser.doSearchInStreamfiles.noResults`, searchTerm, searchPath));
        }
      });

    } catch (e) {
      vscode.window.showErrorMessage(t(`ifsBrowser.doSearchInStreamfiles.errorMessage`));
    }
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
      .concat(`${size !== undefined ? `\n` + t(`Size`) + `:\t\t${size}` : ``}`)
      .concat(`${modified ? `\n` + t(`Modified`) + `:\t${new Date(modified.getTime()-modified.getTimezoneOffset()*60*1000).toISOString().slice(0,19).replace(`T`, ` `)}` : ``}`)
      .concat(`${owner ? `\n` + t(`Owner`) + `:\t${owner.toUpperCase()}` : ``}`);
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