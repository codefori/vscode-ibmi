import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as util from 'util';
import * as path from 'path';

const writeFileAsync = util.promisify(fs.writeFile);

import { CommandResult, IBMiError, IBMiFile, IBMiMember, IBMiObject, IFSFile, QsysPath, IBMiSpooledFile, IBMiSplfUser } from '../typings';
import { setSearchResults } from '../instantiate';
import { GlobalConfiguration, ConnectionConfiguration } from '../api/Configuration';
import { Search } from '../api/Search';
import { getSpooledFileUri } from '../filesystems/qsys/SplfFs';
import { Tools } from '../api/Tools';

function getInstance() {
  const { instance } = (require(`../instantiate`));
  return instance;
}

export default class SPLFBrowser implements vscode.TreeDataProvider<any> {
  private emitter: vscode.EventEmitter<any>;
  private treeViewer: vscode.TreeView<any>;
  public onDidChangeTreeData: vscode.Event<any>;

  constructor(private context: vscode.ExtensionContext) {
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
          // console.log(e);
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
          // console.log(e);
        }
      }),
      vscode.commands.registerCommand(`code-for-ibmi.sortUserSpooledFileFilter`, async (node) => {
        /** @type {ConnectionConfiguration.Parameters} */
        const config = getInstance().getConfig();

        let usersSpooledFile = config.usersSpooledFile;

        try {

          usersSpooledFile.sort(function (a: string, b: string): number {
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
          // console.log(e);
        }
      }),
      vscode.commands.registerCommand(`code-for-ibmi.deleteSpooledFile`, async (node) => {
        if (node) {
          //Running from right click
          let result = await vscode.window.showWarningMessage(`Are you sure you want to delete spooled file ${node.path}?`, `Yes`, `Cancel`);

          if (result === `Yes`) {

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
        } else {
          //Running from command.
        }
      }),
      vscode.commands.registerCommand(`code-for-ibmi.deleteNamedSpooledFiles`, async (node) => {
        if (node) {
          //Running from right click
          let deleteCount = 0;
          let result = await vscode.window.showWarningMessage(`Are you sure you want to delete ALL spooled files named ${node.name} for user ${node.user}?`, `Yes`, `Cancel`);
          
          if (result === `Yes`) {
            const connection = getInstance().getConnection();
            const content = getInstance().getContent();
            const TempFileName = Tools.makeid();
            const TempMbrName = Tools.makeid();
            const asp = ``;
            const tempLib = content.config.tempLibrary;
            let commandResult = ``;
            

            const objects = await content.getUserSpooledFileFilter(node.user, node.sort, node.name);
            try {
              let commands = objects.map((o: any) => (
                `DLTSPLF FILE(${o.name}) JOB(${o.qualified_job_name}) SPLNBR(${o.number})`              
              )); 
              deleteCount = commands.length;
              let dltCmdSrc = `// BCHJOB  JOB(DLTSPLFS) JOBQ(QUSRNOMAX)\n` +commands.join(`\n`) +`\n// ENDBCHJOB`;
              await connection.runCommand({
                command: `CRTSRCPF FILE(${tempLib}/${TempFileName}) MBR(${TempMbrName}) RCDLEN(112)`
                ,environment: `ile`
              });
              await content.uploadMemberContent(asp, tempLib, TempFileName, TempMbrName, dltCmdSrc)
              let dltCommands = `SBMDBJOB FILE(${tempLib}/${TempFileName}) MBR(${TempMbrName}) JOBQ(QUSRNOMAX)`;
              const commandResult = await connection.runCommand({
                command: dltCommands
                ,environment: `ile`
              });
              if (commandResult) {
                // vscode.window.showInformationMessage(` ${commandResult.stdout}.`);
                if (commandResult.code === 0 || commandResult.code === null) {
                } else {
                }
              }
                
            } catch (e) {
              vscode.window.showErrorMessage(`Error deleting user spooled file! ${e}`);
            }
            if (deleteCount > 0) {
              if (GlobalConfiguration.get(`autoRefresh`)) this.refresh();
              vscode.window.showInformationMessage(`Deleted ${deleteCount} spooled files.`);
              await connection.runCommand({
                command: `DLTF FILE(${tempLib}/${TempFileName}) `
                ,environment: `ile`
              });
            }
            
          }
          else {
            vscode.window.showInformationMessage(`Deletion canceled.`);
          }
        } else {
          //Running from command.
        }
      }),
      vscode.commands.registerCommand(`code-for-ibmi.deleteUserSpooledFiles`, async (node) => {
        if (node) {
          //Running from right click
          let result = await vscode.window.showWarningMessage(`Are you sure you want to delete ALL spooled files for ${node.user}?`, `Yes`, `Cancel`);

          if (result === `Yes`) {

            const connection = getInstance().getConnection();

            try {
              const commandResult = await connection.runCommand({
                command: `DLTSPLF FILE(*SELECT) SELECT(*CURRENT)`
                , environment: `ile`
              });
              if (commandResult) {
                // vscode.window.showInformationMessage(` ${commandResult.stdout}.`);
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
          // console.log(this);
        }
      }),
      vscode.commands.registerCommand(`code-for-ibmi.searchSpooledFiles`, async (node) => {
        const connection = getInstance().getConnection();
        const content = getInstance().getContent();
        /** @type {ConnectionConfiguration.Parameters} */
        const config = getInstance().getConfig();

        let searchUser :any;
        let searchName :any;
        if (node) {
          searchUser = node.user;
          searchName = node.name;
        }
        else {
          searchUser = await vscode.window.showInputBox({
            value: config.currentLibrary,
            prompt: `Enter user to search over`,
            title: `Search user spooled files`
          })
          searchName = await vscode.window.showInputBox({
            value: ``,
            prompt: `Enter spooled file name to search over`,
            title: `Search in named spooled file`
          })
        }

        if (!searchName) return;

        let searchTerm :any = await vscode.window.showInputBox({
          prompt: `Search in spooled files named ${searchName}.`
          // prompt: `Search ${searchPath}.`
        });

        if (searchTerm) {
          try {
            await vscode.window.withProgress({
              location: vscode.ProgressLocation.Notification,
              title: `Searching`,
            }, async progress => {
              progress.report({
                message: `'${searchTerm}' in ${searchUser}, ${searchName} spooled files.`
              });
              const splfnum = await content.getUserSpooledFileCount(searchUser, searchName);
              if (splfnum > 0) {
                // NOTE: if more messages are added, lower the timeout interval
                const timeoutInternal = 9000;
                const searchMessages = [
                  `'${searchTerm}' in ${searchUser} spooled files.`,
                  `This is taking a while because there are ${splfnum} spooled files. Searching '${searchTerm}' in ${searchUser} still.`,
                  `What's so special about '${searchTerm}' anyway?`,
                  `Still searching '${searchTerm}' in ${searchUser}...`,
                  `Wow. This really is taking a while. Let's hope you get the result you want.`,
                  `How does one end up with ${splfnum} spooled files.  Ever heared of cleaning up?`,
                  `'${searchTerm}' in ${searchUser}.`,
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
                let results = await Search.searchUserSpooledFiles(getInstance(), searchTerm, searchUser, searchName);

                if (results.length > 0) {
                  const objectNamesLower = GlobalConfiguration.get(`ObjectBrowser.showNamesInLowercase`);

                  setSearchResults(searchTerm, results.sort((a, b) => a.path.localeCompare(b.path)));

                } else {
                  vscode.window.showInformationMessage(`No results found searching for '${searchTerm}' in ${searchName}.`);
                }
              } else {
                vscode.window.showErrorMessage(`No spooled files to search.`);
              }
            });

          } catch (e) {
            console.log(e);
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
            prompt: `Type of file to create, TXT, PDF`,
            value: `TXT`
          });
          if (!fileExtension) { return }
          fileExtension = fileExtension.toLowerCase()
          switch (fileExtension) {
          case `pdf`:
          // case `html`:
          case `txt`:
            fileExtension.toLowerCase();
            break;
          default:
            fileExtension = `txt`;
          }

          const splfContent = await contentApi.downloadSpooledFileContent(node.path, node.name, node.qualified_job_name, node.number, fileExtension);
          const tmpExt = path.extname(node.path);
          const fileName = path.basename(node.path, tmpExt);
          // let localFilePathBase = os.homedir() +`\\` +extraFolder +`\\` +fileName +`.`+fileExtension; //FUTURE: in case we let user pick another download loc
          let localFilePathBase = os.homedir() + `\\` + fileName + `.` + fileExtension;
          const localFile = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(localFilePathBase) });

          if (localFile) {
            let localPath = localFile.path;
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

  async moveFilterInList(filterName: string, filterMovement: string) {
    filterMovement = filterMovement.toUpperCase();
    if (![`TOP`, `UP`, `DOWN`, `BOTTOM`].includes(filterMovement)) throw `Illegal filter movement value specified`;

    /** @type {ConnectionConfiguration.Parameters} */
    const config = getInstance().getConfig();

    let usersSpooledFile = config.usersSpooledFile;
    const from = usersSpooledFile.findIndex((filter: { name: string; }) => filter.name === filterName);
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

  refresh(target? :any) {
    this.emitter.fire(target);
  }

  /**
   * @param {vscode.TreeItem} element
   * @returns {vscode.TreeItem};
   */
  getTreeItem(element :vscode.TreeItem) {
    return element;
  }

  /**
   * @param {vscode.TreeItem} element
   * @returns {Promise<vscode.TreeItem[]>};
   */
  async getChildren(element :any) {
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
            const objects = await content.getUserSpooledFileFilter(element.filter.user, element.sort);
            items.push(...objects
              .map((object: IBMiSpooledFile) => new SPLF(`SPLF`, element, object, element.filter)));

          } catch (e: any) {
            // console.log(e);
            vscode.window.showErrorMessage(e.message);
            items.push(new vscode.TreeItem(`Error loading user spooled files.`));
          }
        case `SPLF`:
          { }
          break;
        }

      } else { // no context exists in tree yet, get from settings
        items.push(...config.usersSpooledFile.map(
          (theUser: any) => new FilterItem(element, { user: theUser, }, connection.currentUser)
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
  getParent(element :any) {
    return element.parent;
  }
  /**
   * Called on hover to resolve the {@link TreeItem.tooltip TreeItem} property if it is undefined.
   * Called on tree item click/open to resolve the {@link TreeItem.command TreeItem} property if it is undefined.
   * Only properties that were undefined can be resolved in `resolveTreeItem`.
   * Functionality may be expanded later to include being called to resolve other missing
   * properties on selection and/or on open.
   *
   * Will only ever be called once per TreeItem.
   *
   * onDidChangeTreeData should not be triggered from within resolveTreeItem.
   *
   * *Note* that this function is called when tree items are already showing in the UI.
   * Because of that, no property that changes the presentation (label, description, etc.)
   * can be changed.
   *
   * @param item Undefined properties of `item` should be set then `item` should be returned.
   * @param element The object associated with the TreeItem.
   * @param token A cancellation token.
   * @return The resolved tree item or a thenable that resolves to such. It is OK to return the given
   * `item`. When no result is returned, the given `item` will be used.
   * @param {vscode.TreeItem} item
   * @param {vscode.TreeDataProvider<T>} element 
   * @param {vscode.CancellationToken} token
   * @returns {ProviderResult<TreeItem>};
   */
  async resolveTreeItem(item :SPLF, element :any, token :vscode.CancellationToken) :Promise<vscode.TreeItem>
  {
    const content = getInstance().getContent();
    const splfNum = await content.getUserSpooledFileCount(item.name);
    const userText = await content.getUserProfileText(item.name);
    item.tooltip = ``
      .concat(`${userText ? `User Text:\t\t\t  ${userText}` : ``}`)
      .concat(`${splfNum  ? `\nSpooled Fiile Count: ${splfNum}` : ``}`)
    return item;
  }
}

class FilterItem extends vscode.TreeItem {
  protected: boolean;
  path: string;
  parent: vscode.TreeItem;
  user: string;
  name: string;
  _description: string;
  description: string;
  filter: IBMiSplfUser;
  sort: { order: string };
  /**
   * @param {vscode.TreeItem} parent
   * @param {import("../typings/IBMiSplfUser")} filter
   * @param {string} currentUser
   */
  constructor(parent: vscode.TreeItem, filter: IBMiSplfUser, currentUser: string) {
    super(filter.user, vscode.TreeItemCollapsibleState.Collapsed);
    const icon = objectIcons[`OUTQ`] || objectIcons[``];
    this.protected = filter.user.toLocaleUpperCase() !== currentUser.toLocaleUpperCase() ? true : false;
    this.contextValue = `splfuser${this.protected ? `_readonly` : ``}`;
    this.path = filter.user;
    this.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
    this.parent = parent;
    this.user = filter.user;
    this.iconPath = new vscode.ThemeIcon(icon, (this.protected ? new vscode.ThemeColor(`list.errorForeground`) : undefined));

    this.name = filter.user;
    this._description = `${filter.user} ${this.protected ? `(readonly)` : ``}`;
    this.description = this._description;

    this.filter = filter;
    /** @type {import("../api/IBMiContent").SortOptions}*/
    this.sort = { order: `date` };
  }
  sortBy(/** @type {import("../api/IBMiContent").SortOptions}*/ sort: { order: any; ascending?: any; }) {
    this.sort = sort;
    this.description = `${this._description ? `${this._description} ` : ``}(sort: ${sort.order} ${sort.ascending ? `🔼` : `🔽`})`;
  }
}

class SPLF extends vscode.TreeItem {
  parent: FilterItem;
  type: string;
  user: string;
  name: string;
  number: number;
  status: string;
  creationTimestamp: string;
  userData: string;
  size: number;
  totalPages: number;
  qualifiedJobName: string;
  jobName: string;
  jobUser: string;
  jobNumber: string;
  formType: string;
  queueLibrary: string;
  queue: string;
  protected: boolean;
  path: string;
  /**
   * @param {"SPLF"} type
   * @param {vscode.TreeItem} parent 
   * @param {import(`../typings`).IBMiSpooledFile} object
   * @param {ConnectionConfiguration.UserSplfFilters} filter 
   */
  constructor(type: string, parent: FilterItem, object: IBMiSpooledFile, filter: FilterItem) {

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
    this.creationTimestamp = object.creation_timestamp
    this.userData = object.user_data
    this.size = object.size
    this.totalPages = object.total_pages
    this.qualifiedJobName = object.qualified_job_name
    this.jobName = object.job_name
    this.jobUser = object.job_user
    this.jobNumber = object.job_number
    this.formType = object.form_type
    this.queueLibrary = object.queue_library
    this.queue = object.queue

    this.description = ` - ` + this.status 
                      +` - Pages: ` + this.totalPages
                      +`, Time: `+this.creationTimestamp.substring(11)
    ;
    this.iconPath = new vscode.ThemeIcon(icon);
    this.protected = parent.protected;
    this.contextValue = `spooledfile${parent.protected ? `_readonly` : ``}`;
    this.resourceUri = getSpooledFileUri(object, parent.protected ? { readonly: true } : undefined);
    this.path = this.resourceUri.path;
    this.tooltip = ``
      .concat(`${object.qualified_job_name ? `Job:\t\t\t ${object.qualified_job_name}` : ``}`)
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

const objectIcons: Record<string, string> = {
  'OUTQ': 'server',
  'SPLF': 'file',
  '': 'circle-large-outline'
}