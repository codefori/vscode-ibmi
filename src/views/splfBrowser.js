const vscode = require(`vscode`);
const fs = require(`fs`);
const os = require(`os`);
const util = require(`util`);
const path = require(`path`);

const writeFileAsync = util.promisify(fs.writeFile);

// const FiltersUI = require(`../webviews/filters`);

let { setSearchResults } = require(`../instantiate`);
const { GlobalConfiguration, ConnectionConfiguration } = require(`../api/Configuration`);
const { Search } = require(`../api/Search`);
const { getSpooledFileUri } = require(`../filesystems/qsys/SplfFs`);
// const { Tools } = require(`../api/Tools`);

function getInstance() {
  const { instance } = (require(`../instantiate`));
  return instance;
}

module.exports = class SPLFBrowser {
  /**
   * @param {vscode.ExtensionContext} context
   */
  constructor(context) {
    this.emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.emitter.event;
    this.treeViewer = vscode.window.createTreeView(
      `splfBrowser`,
      {
        treeDataProvider: this,
        showCollapseAll: true
      }
    );

    context.subscriptions.push(
      vscode.commands.registerCommand(`code-for-ibmi.sortSPLFSFilesByName`, (/** @type {Object} */ SpooledFiles) => {
        const spoolfile = SpooledFiles.parent ? SpooledFiles.parent : SpooledFiles;
        if (spoolfile.sort.order !== `name`) {
          spoolfile.sortBy({ order: `name`, ascending: true })
        }
        else {
          spoolfile.sort.ascending = !spoolfile.sort.ascending
          spoolfile.sortBy(spoolfile.sort);
        }

        this.treeViewer.reveal(spoolfile, { expand: true });
        this.refresh(spoolfile);
      }),
      vscode.commands.registerCommand(`code-for-ibmi.sortSPLFSFilesByDate`, (/** @type {Object} */ SpooledFiles) => {
        const spoolfile = SpooledFiles.parent ? SpooledFiles.parent : SpooledFiles;
        if (spoolfile.sort.order !== `date`) {
          spoolfile.sortBy({ order: `date`, ascending: true })
        }
        else {
          spoolfile.sort.ascending = !spoolfile.sort.ascending
          spoolfile.sortBy(spoolfile.sort);
        }

        this.treeViewer.reveal(spoolfile, { expand: true });
        this.refresh(spoolfile);
      }),
      vscode.commands.registerCommand(`code-for-ibmi.refreshSPLFBrowser`, async () => {
        this.refresh();
      }),

      vscode.commands.registerCommand(`code-for-ibmi.addUserSpooledFileFilter`, async (node) => {
        const config = getInstance().getConfig();
        const connection = getInstance().getConnection();

        let newUserSplfs;

        let usersSpooledFile = [];
        if (config.usersSpooledFile) {
          usersSpooledFile = config.usersSpooledFile;
        }
        // let autoSortusersSpooledFile = config.autoSortusersSpooledFile;

        newUserSplfs = await vscode.window.showInputBox({
          prompt: `User to show Spooled Files`,
          value: connection.currentUser
        });

        try {
          if (newUserSplfs) {
            newUserSplfs = newUserSplfs.trim().toUpperCase().toUpperCase();

            if (!usersSpooledFile.includes(newUserSplfs)) {
              usersSpooledFile.push(newUserSplfs);
              config.usersSpooledFile = usersSpooledFile;
              await ConnectionConfiguration.update(config);
              vscode.commands.executeCommand(`code-for-ibmi.sortUserSpooledFileFilter`);
              if (GlobalConfiguration.get(`autoRefresh`)) this.refresh();
            }
          }
        } catch (e) {
          console.log(e);
        }
      }),

      vscode.commands.registerCommand(`code-for-ibmi.deleteUserSpooledFileFilter`, async (node) => {
        const { instance } = (require(`../instantiate`));
        const config = getInstance().getConfig();

        let removeUser;

        let usersSpooledFile = config.usersSpooledFile;

        if (node) {
          removeUser = node.path;
        } else {
          removeUser = await vscode.window.showQuickPick(usersSpooledFile, {
            placeHolder: `Select filter name to remove`,
          });
        }

        try {
          if (removeUser) {
            removeUser = removeUser.trim();

            const inx = usersSpooledFile.indexOf(removeUser);

            if (inx >= 0) {
              usersSpooledFile.splice(inx, 1);
              config.usersSpooledFile = usersSpooledFile;
              await ConnectionConfiguration.update(config);
              if (GlobalConfiguration.get(`autoRefresh`)) this.refresh();
            }
          }
        } catch (e) {
          console.log(e);
        }
      }),

      vscode.commands.registerCommand(`code-for-ibmi.sortUserSpooledFileFilter`, async (node) => {
        /** @type {ConnectionConfiguration.Parameters} */
        const config = getInstance().getConfig();

        let usersSpooledFile = config.usersSpooledFile;

        try {

          usersSpooledFile.sort(function (a, b) {
            let x = a.toLowerCase();
            let y = b.toLowerCase();
            if (x < y) { return -1; }
            if (x > y) { return 1; }
            return 0;
          });
          config.usersSpooledFile = usersSpooledFile;
          await ConnectionConfiguration.update(config);
          if (GlobalConfiguration.get(`autoRefresh`)) this.refresh();
        } catch (e) {
          console.log(e);
        }
      }),

      vscode.commands.registerCommand(`code-for-ibmi.deleteSpooledFile`, async (node) => {
        if (node) {
          //Running from right click
          let deletionConfirmed = false;
          let result = await vscode.window.showWarningMessage(`Are you sure you want to delete spooled file ${node.path}?`, `Yes`, `Cancel`);

          if (result === `Yes`) {
            deletionConfirmed = true;

            if (deletionConfirmed) {
              const connection = getInstance().getConnection();

              try {
                await connection.runCommand({
                  command: `DLTSPLF FILE(${node.name}) JOB(${node.qualified_job_name}) SPLNBR(${node.number})`
                  , environment: `ile`
                });

                vscode.window.showInformationMessage(`Deleted ${node.path}.`);

                if (GlobalConfiguration.get(`autoRefresh`)) this.refresh();
              } catch (e) {
                vscode.window.showErrorMessage(`Error deleting user spooled file! ${e}`);
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
      vscode.commands.registerCommand(`code-for-ibmi.deleteNamedSpooledFiles`, async (node) => {
        if (node) {
          //Running from right click
          let deleteCount = 0;
          let deletionConfirmed = false;
          let result = await vscode.window.showWarningMessage(`Are you sure you want to delete ALL spooled files named ${node.name} for user ${node.user}?`, `Yes`, `Cancel`);

          if (result === `Yes`) {
            deletionConfirmed = true;

            if (deletionConfirmed) {
              const connection = getInstance().getConnection();
              const content = getInstance().getContent();

              const objects = await content.getUserSpooledFileFilter(node.user, node.sort, node.name);
              let commands = ``;
              let commandsNum = 0;
              objects.forEach(async function (object) {
                commands += (deleteCount >= 0 ? `\n` : ``) + `DLTSPLF FILE(${object.name}) JOB(${object.qualified_job_name}) SPLNBR(${object.number})`;
                deleteCount += 1;
              });
              let commands_fewer = []``;
              try {
                for (let index = 0; index < commands.length;) {
                  commands_fewer = commands.split(index, index + 20);
                  index += 20;
                }
                await connection.runCommand({
                  command: `${commands}`
                  , environment: `ile`
                });

                // vscode.window.showInformationMessage(`Deleted ${object.name}, ${object.qualified_job_name}.`);
                // deleteCount += 1;

              } catch (e) {
                vscode.window.showErrorMessage(`Error deleting user spooled file! ${e}`);
              }
              // });
            }
            else {
              vscode.window.showInformationMessage(`Deletion canceled.`);
            }
            if (deleteCount > 0) {
              if (GlobalConfiguration.get(`autoRefresh`)) this.refresh();
              vscode.window.showInformationMessage(`Deleted ${deleteCount} spooled files.`);
            }

          }
        } else {
          //Running from command.
        }
      }),
      vscode.commands.registerCommand(`code-for-ibmi.deleteUserSpooledFiles`, async (node) => {
        if (node) {
          //Running from right click
          let deletionConfirmed = false;
          let result = await vscode.window.showWarningMessage(`Are you sure you want to delete ALL spooled files for ${node.user}?`, `Yes`, `Cancel`);

          if (result === `Yes`) {
            deletionConfirmed = true;

            if (deletionConfirmed) {
              const connection = getInstance().getConnection();

              try {
                const commandResult = await connection.runCommand({
                  command: `DLTSPLF FILE(*SELECT) SELECT(*CURRENT)`
                  , environment: `ile`
                });
                if (commandResult) {
                  vscode.window.showInformationMessage(` ${commandResult.stdout}.`);
                  if (commandResult.code === 0 || commandResult.code === null) {
                  } else {
                  }
                }

                if (GlobalConfiguration.get(`autoRefresh`)) this.refresh();
              } catch (e) {
                vscode.window.showErrorMessage(`Error deleting user spooled files! ${e}`);
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

      vscode.commands.registerCommand(`code-for-ibmi.moveSpooledFile`, async (node) => {
        if (node) {
          //Running from right click

          const newQueue = await vscode.window.showInputBox({
            prompt: `Name of new OUTQ`,
            value: node.queue
          });

          if (newQueue) {
            const connection = getInstance().getConnection();

            try {
              await connection.runCommand({
                command: `CHGSPLFA FILE(${node.name}) JOB(${node.qualified_job_name}) SPLNBR(${node.number}) OUTQ(${newQueue})`
                , environment: `ile`
              });
              if (GlobalConfiguration.get(`autoRefresh`)) this.refresh();

            } catch (e) {
              vscode.window.showErrorMessage(`Error moving spooled file! ${e}`);
            }
          }

        } else {
          //Running from command
          console.log(this);
        }
      }),
      vscode.commands.registerCommand(`code-for-ibmi.copySpooledFile`, async (node) => {
        /** @type {ConnectionConfiguration.Parameters} */
        const config = getInstance().getConfig();
        const homeDirectory = config.homeDirectory;

        if (node) {
          //Running from right click

          let newName = await vscode.window.showInputBox({
            prompt: `Name of new spooled file name`,
            value: node.name
          });

          if (newName) {
            const connection = getInstance().getConnection();

            try {
              await connection.runCommand({
                command: `DUPSPLF FILE(${node.name}) JOB(${node.qualified_job_name}) SPLNBR(${node.number}) NEWSPLF(${newName})`
                , environment: `ile`
              });
              if (GlobalConfiguration.get(`autoRefresh`)) this.refresh();
              // vscode.window.showInformationMessage(`${node.path} was copied to ${newName}.`);
              // vscode.window.showInformationMessage(`${Tools.escapePath(node.path)} was copied to ${Tools.escapePath(newName)}.`);

            } catch (e) {
              vscode.window.showErrorMessage(`Error copying ${node.path}! ${e}`);
            }
          }

        } else {
          //Running from command
          console.log(this);
        }
      }),

      vscode.commands.registerCommand(`code-for-ibmi.searchSpooledFiles`, async (node) => {
        const connection = getInstance().getConnection();
        const content = getInstance().getContent();
        /** @type {ConnectionConfiguration.Parameters} */
        const config = getInstance().getConfig();

        let searchPath;
        if (node)
          searchPath = node.name;
        else {
          // searchPath = config.homeDirectory;
          // searchPath = await vscode.window.showInputBox({
          //   value: searchPath,
          //   prompt: `Enter user to search over`,
          //   title: `Search user spooled files`
          // })
          return;
        }

        if (!searchPath) return;

        let searchTerm = await vscode.window.showInputBox({
          prompt: `Search in spooled files named ${searchPath}.`
          // prompt: `Search ${searchPath}.`
        });

        if (searchTerm) {
          try {
            await vscode.window.withProgress({
              location: vscode.ProgressLocation.Notification,
              title: `Searching`,
            }, async progress => {
              progress.report({
                message: `'${searchTerm}' in ${node.user}, ${searchPath} spooled files.`
              });
              const splfnum = await content.getUserSpooledFileCount(node.user, searchPath);
              if (splfnum > 0) {
                // NOTE: if more messages are added, lower the timeout interval
                const timeoutInternal = 9000;
                const searchMessages = [
                  `'${searchTerm}' in ${node.path} spooled files.`,
                  `This is taking a while because there are ${splfnum} spooled files. Searching '${searchTerm}' in ${node.user} still.`,
                  `What's so special about '${searchTerm}' anyway?`,
                  `Still searching '${searchTerm}' in ${node.path}...`,
                  `Wow. This really is taking a while. Let's hope you get the result you want.`,
                  `How does one end up with ${splfnum} spooled files.  Ever heared of cleaning up?`,
                  `'${searchTerm}' in ${node.user}.`,
                ];
                let currentMessage = 0;
                const messageTimeout = setInterval(() => {
                  if (currentMessage < searchMessages.length) {
                    progress.report({
                      message: searchMessages[currentMessage]
                    });
                    currentMessage++;
                  } else {
                    clearInterval(messageTimeout);
                  }
                }, timeoutInternal);
                let results = await Search.searchUserSpooledFiles(getInstance(), searchTerm, node.user, searchPath);

                if (results.length > 0) {
                  const objectNamesLower = GlobalConfiguration.get(`ObjectBrowser.showNamesInLowercase`);

                  setSearchResults(searchTerm, results.sort((a, b) => a.path.localeCompare(b.path)));

                } else {
                  vscode.window.showInformationMessage(`No results found searching for '${searchTerm}' in ${searchPath}.`);
                }
              } else {
                vscode.window.showErrorMessage(`No spooled files to search.`);
              }
            });

          } catch (e) {
            vscode.window.showErrorMessage(`Error searching spooled files.`);
          }
        }

      }),

      vscode.commands.registerCommand(`code-for-ibmi.downloadSpooledfile`, async (node) => {
        const config = getInstance().getConfig();
        const contentApi = getInstance().getContent();
        const connection = getInstance().getConnection();
        const client = connection.client;

        if (node) {
          let fileExtension = await vscode.window.showInputBox({
            prompt: `Type of file to create, TXT, PDF, HTML`,
            value: `TXT`
          });
          if (!fileExtension) { return }
          fileExtension = fileExtension.toLowerCase()
          switch (fileExtension) {
          case `pdf`:
          case `html`:
          case `txt`:
            fileExtension.toLowerCase();
            break;
          default:
            fileExtension = `txt`;
          }

          const splfContent = await contentApi.downloadSpooledFileContent(node.path, node.name, node.qualified_job_name, node.number, fileExtension);
          const tmpExt = path.extname(node.path);
          const fileName = path.basename(node.path, tmpExt);
          // let localFilepath = os.homedir() +`\\` +extraFolder +`\\` +fileName +`.`+fileExtension; //FUTURE: in case we let user pick another download loc
          let localFilepath = os.homedir() + `\\` + fileName + `.` + fileExtension;
          localFilepath = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(localFilepath) });

          if (localFilepath) {
            let localPath = localFilepath.path;
            if (process.platform === `win32`) {
              //Issue with getFile not working propertly on Windows
              //when there was a / at the start.
              if (localPath[0] === `/`) localPath = localPath.substring(1);
            }
            try {
              let fileEncoding = `utf8`;
              switch (fileExtension.toLowerCase()) {
              case `pdf`:
                fileEncoding = ``;
                break;
              default:
              }
              await writeFileAsync(localPath, splfContent, fileEncoding);
              vscode.window.showInformationMessage(`Spooled File was downloaded.`);
            } catch (e) {
              vscode.window.showErrorMessage(`Error downloading Spoooled File! ${e}`);
            }
          }

        } else {
          //Running from command.
        }
      }),
    )

    // getInstance().onEvent(`connected`, () => this.refresh());
  }

  async moveFilterInList(filterName, filterMovement) {
    filterMovement = filterMovement.toUpperCase();
    if (![`TOP`, `UP`, `DOWN`, `BOTTOM`].includes(filterMovement)) throw `Illegal filter movement value specified`;

    /** @type {ConnectionConfiguration.Parameters} */
    const config = getInstance().getConfig();

    let usersSpooledFile = config.usersSpooledFile;
    const from = usersSpooledFile.findIndex(filter => filter.name === filterName);
    let to;

    if (from === -1) throw `Filter ${filterName} is not found in list`;
    if (from === 0 && [`TOP`, `UP`].includes(filterMovement)) throw `Filter ${filterName} is at top of list`;
    if (from === usersSpooledFile.length && [`DOWN`, `BOTTOM`].includes(filterMovement)) throw `Filter ${filterName} is at bottom of list`;

    switch (filterMovement) {
    case `TOP`:
      to = 0;
      break;
    case `UP`:
      to = from - 1;
      break;
    case `DOWN`:
      to = from + 1;
      break;
    case `BOTTOM`:
      to = usersSpooledFile.length;
      break;
    }

    const filter = usersSpooledFile[from];
    usersSpooledFile.splice(from, 1);
    usersSpooledFile.splice(to, 0, filter);
    config.usersSpooledFile = usersSpooledFile;
    await ConnectionConfiguration.update(config);
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
   * @param {vscode.TreeItem} element
   * @returns {Promise<vscode.TreeItem[]>};
   */
  async getChildren(element) {
    const items = [];
    const connection = getInstance().getConnection();
    if (connection) {
      const content = getInstance().getContent();
      const config = getInstance().getConfig();

      if (element) { //Chosen USER??
        // let filter;
        switch (element.contextValue.split(`_`)[0]) {
        case `splfuser`:
          //Fetch spooled files
          try {
            const objects = await content.getUserSpooledFileFilter(element.filter.userName, element.sort);
            // console.log(JSON.stringify(objects));
            items.push(...objects
              .map(object => new SPLF(`SPLF`, element, object, element.filter)));

          } catch (e) {
            console.log(e);
            vscode.window.showErrorMessage(e.message);
            items.push(new vscode.TreeItem(`Error loading user spooled files.`));
          }
        case `SPLF`:
          { }
          break;
        }

      } else { // no context exists in tree yet, get from settings
        items.push(...config.usersSpooledFile.map(
          theUser => new FilterItem(element, { userName: theUser, }, connection.currentUser)
        ));
      }
    }
    return items;
  }
  /** 
   * getParemt
   * required implementation for TreeDataProvider 
   * 
   */
  getParent(element) {
    return element.parent;
  }
}

class FilterItem extends vscode.TreeItem {
  /**
   * @param {vscode.TreeItem} parent
   * @param {import("../typings/IBMiSplfUser")} filter
   * @param {string} currentUser
   */
  constructor(parent, filter, currentUser) {
    super(filter, vscode.TreeItemCollapsibleState.Collapsed);
    const icon = objectIcons[`OUTQ`] || objectIcons[``];
    this.protected = filter.userName.toLocaleUpperCase() !== currentUser.toLocaleUpperCase() ? true : false;
    this.contextValue = `splfuser${this.protected ? `_readonly` : ``}`;
    this.path = filter.userName;
    this.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
    this.parent = parent;
    this.user = filter.userName;
    this.iconPath = new vscode.ThemeIcon(icon, (this.protected ? new vscode.ThemeColor(`list.errorForeground`) : undefined));

    this.name = filter.userName;
    this._description = `${filter.userName} ${this.protected ? `(readonly)` : ``}`;
    this.description = this._description;

    this.filter = filter;
    /** @type {import("../api/IBMiContent").SortOptions}*/
    this.sort = { order: `date` };
  }
  sortBy(/** @type {import("../api/IBMiContent").SortOptions}*/ sort) {
    this.sort = sort;
    this.description = `${this._description ? `${this._description} ` : ``}(sort: ${sort.order} ${sort.ascending ? `🔼` : `🔽`})`;
  }
}

class SPLF extends vscode.TreeItem {
  /**
   * @param {"SPLF"} type
   * @param {vscode.TreeItem} parent 
   * @param {import(`../typings`).IBMiSpooledFile} object
   * @param {ConnectionConfiguration.UserSplfFilters} filter 
   */
  constructor(type, parent, object, filter) {

    const icon = objectIcons[`${type}`] || objectIcons[``];
    super(`${object.name}.${type}`, vscode.TreeItemCollapsibleState.Collapsed);
    this.collapsibleState = vscode.TreeItemCollapsibleState.None;

    this.parent = parent;
    this.type = type;
    // Layout of IBMiSpooledFile
    this.user = parent.path;
    this.name = object.name
    this.number = object.number
    this.status = object.status
    this.creation_timestamp = object.creation_timestamp
    this.user_data = object.user_data
    this.size = object.size
    this.total_pages = object.total_pages
    this.qualified_job_name = object.qualified_job_name
    this.job_name = object.job_name
    this.job_user = object.job_user
    this.job_number = object.job_number
    this.form_type = object.form_type
    this.queue_library = object.queue_library
    this.queue = object.queue

    this.description = ` - ` + this.status + ` - Pages: ` + this.total_pages;
    this.iconPath = new vscode.ThemeIcon(icon);
    this.protected = parent.protected;
    this.contextValue = `spooledfile${parent.protected ? `_readonly` : ``}`;
    this.resourceUri = getSpooledFileUri(object, parent.protected ? { readonly: true } : undefined);
    this.path = this.resourceUri.path;
    this.tooltip = ``
      .concat(`${object.qualified_job_name ? `\nJob:\t\t\t ${object.qualified_job_name}` : ``}`)
      .concat(`${object.user_data != undefined ? `\nUser Data:\t ${object.user_data}` : ``}`)
      .concat(`${object.creation_timestamp ? `\nCreated:\t\t ${object.creation_timestamp}` : ``}`)
      .concat(`${object.size ? `\nSize in bytes:\t ${object.size}` : ``}`)
      .concat(`${object.form_type ? `\nForm Type:\t ${object.form_type}` : ``}`)
      .concat(`${object.queue ? `\nOutput Queue: ${object.queue_library}/${object.queue}` : ``}`)
    ;
    this.command = {
      command: `vscode.open`,
      title: `Open Spooled File`,
      arguments: [this.resourceUri]
    };
    this.iconPath = new vscode.ThemeIcon(icon, (this.protected ? new vscode.ThemeColor(`list.errorForeground`) : undefined));
  }
}

//https://code.visualstudio.com/api/references/icons-in-labels
const objectIcons = {
  'OUTQ': `server`,
  'SPLF': `file`,
  '': `circle-large-outline`
}
