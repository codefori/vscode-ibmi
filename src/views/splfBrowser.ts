import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as util from 'util';
import * as path from 'path';

const writeFileAsync = util.promisify(fs.writeFile);

import { IBMiSpooledFile, IBMiSplfUser } from '../typings';
import { instance, setSearchResults } from "../instantiate";
import { GlobalConfiguration, ConnectionConfiguration } from '../api/Configuration';
import { SplfSearch } from '../api/spooledFileSearch';
import { getSpooledFileUri } from '../filesystems/qsys/SplfFs';
import { Tools } from '../api/Tools';
import { t } from "../locale";


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
        const config = getConfig();
        const connection = getConnection();

        let newUserSplfs;

        let usersSpooledFile = [];
        if (config.usersSpooledFile) {
          usersSpooledFile = config.usersSpooledFile;
        }
        // let autoSortusersSpooledFile = config.autoSortusersSpooledFile;

        newUserSplfs = await vscode.window.showInputBox({
          // prompt: `User to show Spooled Files`,
          prompt: t(`splfBrowser.addUserSpooledFileFilter.prompt`),
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
        const config = getConfig();

        let removeUser;

        let usersSpooledFile = config.usersSpooledFile;

        if (node) {
          removeUser = node.path;
        } else {
          removeUser = await vscode.window.showQuickPick(usersSpooledFile, {
            // placeHolder: `Select filter name to remove`,
            placeHolder: t('splfBrowser.deleteUserSpooledFileFilter.placeHolder'),
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
        const config = getConfig();

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
          let result = await vscode.window.showWarningMessage(t(`splfBrowser.deleteSpooledFile.warningMessage`, node.path), t(`Yes`), t(`Cancel`));

          if (result === `Yes`) {

            const connection = getConnection();

            try {
              await connection.runCommand({
                command: `DLTSPLF FILE(${node.name}) JOB(${node.jobNumber}/${node.jobUser}/${node.jobName}) SPLNBR(${node.number})`
                , environment: `ile`
              });

              vscode.window.showInformationMessage(t(`splfBrowser.deleteSpooledFile.infoMessage `, node.path));

              if (GlobalConfiguration.get(`autoRefresh`)) this.refresh();
            } catch (e) {
              vscode.window.showErrorMessage(t(`splfBrowser.deleteSpooledFile.errorMessage`, e));
            }
            
          }
          else {
            vscode.window.showInformationMessage(t('splfBrowser.deleteSpooledFile.cancelled'));
          }
        } else {
          //Running from command.
        }
      }),
      vscode.commands.registerCommand(`code-for-ibmi.deleteNamedSpooledFiles`, async (node) => {
        // TODO: make this function delete based on name or active filter
        if (node) {
          //Running from right click
          let deleteCount = 0;
          let result = await vscode.window.showWarningMessage(t(`splfBrowser.deleteNamedSpooledFiles.warningMessage`,node.name), t(`Yes`), t(`Cancel`));
          
          if (result === `Yes`) {
            const connection = getConnection();
            const content = getContent();
            const TempFileName = Tools.makeid();
            const TempMbrName = Tools.makeid();
            const asp = ``;
            const tempLib = getConfig().tempLibrary;
            let objects: IBMiSpooledFile[] = [];

            if (result === `Yes`) {
              objects = await content.getUserSpooledFileFilter(node.user, node.sort, node.name);
            }
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
              vscode.window.showErrorMessage(t(`splfBrowser.deleteNamedSpooledFiles.errorMessage`, e));
            }
            if (deleteCount > 0) {
              if (GlobalConfiguration.get(`autoRefresh`)) this.refresh(node.parent);
              // vscode.window.showInformationMessage(`Deleted ${deleteCount} spooled files.`);
              vscode.window.showInformationMessage(t(`splfBrowser.deleteNamedSpooledFiles.infoMessage`,deleteCount));
              await connection.runCommand({
                command: `DLTF FILE(${tempLib}/${TempFileName}) `
                ,environment: `ile`
              });
            }
            
          }
          else {
            // vscode.window.showInformationMessage(`Deletion canceled.`);
            vscode.window.showInformationMessage(t('splfBrowser.deleteNamedSpooledFiles.cancelled'));
          }
        } else {
          //Running from command.
        }
      }),
      vscode.commands.registerCommand(`code-for-ibmi.deleteFilteredSpooledFiles`, async (node) => {
        // TODO: make this function delete based on name or active filter
        if (node) {
          //Running from right click
          let deleteCount = 0;
          let result = await vscode.window.showWarningMessage(t(`splfBrowser.deleteFilteredSpooledFiles.warningMessage`,node.name, node.parent.filter), t(`Yes`), t(`Cancel`));
          
          if (result === `Yes`) {
            const connection = getConnection();
            const content = getContent();
            const TempFileName = Tools.makeid();
            const TempMbrName = Tools.makeid();
            const asp = ``;
            const tempLib = getConfig().tempLibrary;
            let objects: IBMiSpooledFile[] = [];

            if (result === `Yes`) {
              objects = await content.getUserSpooledFileFilter(node.user, node.sort, undefined, node.parent.filter);
            }
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
              vscode.window.showErrorMessage(t(`splfBrowser.deleteFilteredSpooledFiles.errorMessage`, e));
            }
            if (deleteCount > 0) {
              if (GlobalConfiguration.get(`autoRefresh`)) this.refresh(node.parent);
              // vscode.window.showInformationMessage(`Deleted ${deleteCount} spooled files.`);
              vscode.window.showInformationMessage(t(`splfBrowser.deleteFilteredSpooledFiles.infoMessage`,deleteCount));
              await connection.runCommand({
                command: `DLTF FILE(${tempLib}/${TempFileName}) `
                ,environment: `ile`
              });
            }
            
          }
          else {
            // vscode.window.showInformationMessage(`Deletion canceled.`);
            vscode.window.showInformationMessage(t('splfBrowser.deleteFilteredSpooledFiles.cancelled'));
          }
        } else {
          //Running from command.
        }
      }),
      vscode.commands.registerCommand(`code-for-ibmi.deleteUserSpooledFiles`, async (node) => {
        if (node) {
          //Running from right click
          let result = await vscode.window.showWarningMessage(t(`splfBrowser.deleteUserSpooledFiles.warningMessage`,node.user), t(`Yes`), t(`Cancel`));

          if (result === `Yes`) {

            const connection = getConnection();

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
              vscode.window.showErrorMessage(t(`splfBrowser.deleteUserSpooledFiles.errorMessage`, e))
            }
            
          }
          else {
            // vscode.window.showInformationMessage(`Deletion canceled.`);
            vscode.window.showInformationMessage(t('splfBrowser.deleteUserSpooledFiles.cancelled'));
          }
        } else {
          //Running from command.
        }
      }),
      vscode.commands.registerCommand(`code-for-ibmi.moveSpooledFile`, async (node) => {
        if (node) {
          //Running from right click

          const newQueue = await vscode.window.showInputBox({
            // prompt: `Name of new OUTQ`,
            prompt: t(`splfBrowser.moveSpooledFile.prompt`),
            value: node.queue
          });

          if (newQueue) {
            const connection = getConnection();

            try {
              await connection.runCommand({
                command: `CHGSPLFA FILE(${node.name}) JOB(${node.qualified_job_name}) SPLNBR(${node.number}) OUTQ(${newQueue})`
                , environment: `ile`
              });
              if (GlobalConfiguration.get(`autoRefresh`)) this.refresh();

            } catch (e) {
              // vscode.window.showErrorMessage(`Error moving spooled file! ${e}`);
              vscode.window.showErrorMessage(t(`splfBrowser.moveSpooledFile.errorMessage`, e));
            }
          }

        } else {
          //Running from command
          // console.log(this);
        }
      }),
      vscode.commands.registerCommand(`code-for-ibmi.searchSpooledFiles`, async (node) => {
        const connection = getConnection();
        const content = getContent();
        /** @type {ConnectionConfiguration.Parameters} */
        const config = getConfig();

        let searchUser :any;
        let searchName :any;
        let searchTerm :any;
        let searchWord :string;
        if (node) {
          searchUser = node.user;
          searchName = node.name;
          searchWord = node.parent.filter;
        }
        else {
          searchUser = await vscode.window.showInputBox({
            value: config.currentLibrary,
            // prompt: `Enter user to search over`,
            prompt: t(`splfBrowser.searchSpooledFiles.promptUserName`),
            title: t(`splfBrowser.searchSpooledFiles.promptUserNameTitle`),
            // title: `Search user spooled files`
          })
          searchName = await vscode.window.showInputBox({
            value: ``,
            // prompt: `Enter spooled file name to search over`,
            // title: `Search in named spooled file`
            prompt: t(`splfBrowser.searchSpooledFiles.promptSplfName`),
            title: t(`splfBrowser.searchSpooledFiles.promptSplfNameTitle`),
          })
        }

        if (!searchName) return;

        searchTerm = await vscode.window.showInputBox({
          // prompt: `Search in spooled files named ${searchName}.`
          prompt: t(`splfBrowser.searchSpooledFiles.promptsearchTerm`,searchName)
        });

        if (searchTerm) {
          try {
            await vscode.window.withProgress({
              location: vscode.ProgressLocation.Notification,
              title: t(`splfBrowser.searchSpooledFiles.progressTitle`),
            }, async progress => {
              progress.report({
                message: t(`splfBrowser.searchSpooledFiles.progressMessage0`,[searchTerm],[searchUser],[searchName])
              });
              const splfnum = await content.getUserSpooledFileCount(searchUser, searchName);
              if (Number(splfnum) > 0) {
                // NOTE: if more messages are added, lower the timeout interval
                const timeoutInternal = 9000;
                const searchMessages = [
                  t('splfBrowser.searchSpooledFiles.progressMessage1',[searchTerm],[searchName]),
                  t('splfBrowser.searchSpooledFiles.progressMessage2',[splfnum],[searchTerm],[searchUser]),
                  t('splfBrowser.searchSpooledFiles.progressMessage3',[searchTerm]),
                  t('splfBrowser.searchSpooledFiles.progressMessage4',[searchTerm],[searchUser]),
                  t('splfBrowser.searchSpooledFiles.progressMessage5'),
                  t('splfBrowser.searchSpooledFiles.progressMessage6',[splfnum]),
                  t('splfBrowser.searchSpooledFiles.progressMessage7',[searchTerm],[searchUser]),
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
                let results = await SplfSearch.searchUserSpooledFiles(instance, searchTerm, searchUser, searchName, searchWord);

                if (results.length > 0) {

                  setSearchResults(searchTerm, results.sort((a, b) => a.path.localeCompare(b.path)));

                } else {
                  // vscode.window.showInformationMessage(`No results found searching for '${searchTerm}' in ${searchName}.`);
                  vscode.window.showInformationMessage(t(`splfBrowser.searchSpooledFiles.infoMessage`, [searchTerm],[searchName]));
                }
              } else {
                // vscode.window.showErrorMessage(`No spooled files to search.`);
                vscode.window.showErrorMessage(t(`splfBrowser.searchSpooledFiles.errorMessage0`));
              }
            });
            
          } catch (e) {
            console.log(e);
            // vscode.window.showErrorMessage(`Error searching spooled files.`);
            vscode.window.showErrorMessage(t(`splfBrowser.searchSpooledFiles.errorMessage1`));
          }
        }

      }),
      vscode.commands.registerCommand(`code-for-ibmi.filterSpooledFiles`, async (node) => {
        const content = getContent();

        let searchUser :any;
        let searchTerm :any;
        if (node) {
          searchUser = node.user;
        }

        if (!searchUser) return;

        searchTerm = await vscode.window.showInputBox({
          // prompt: `Filter ${searchUser}'s spooled files. Delete value to clear filter.`,
          prompt: t(`splfBrowser.filterSpooledFiles.prompt`, searchUser),
          value: `${node.contextValue == `spooledfile` ?node.parent.filter :node.filter}`
        });
        
        if (searchTerm) {
          try {
            await vscode.window.withProgress({
              location: vscode.ProgressLocation.Notification,
              // title: `Filtering list of spooled files`,
              title: t(`splfBrowser.filterSpooledFiles.messageTitle`),
            }, async progress => {
              progress.report({
                // message: `Filtering spooled files for ${searchUser}, using these words, ${searchTerm} spooled files.`
                message: t(`splfBrowser.filterSpooledFiles.message`, searchUser,searchTerm),
              });
              searchTerm = searchTerm.toLocaleUpperCase();
              const splfnum = await content.getUserSpooledFileCount(searchUser);
              if (Number(splfnum) > 0) {
                if (node.contextValue == `spooledfile`) {
                  node.parent.addFilter(searchTerm);
                  this.refresh(node.parent);
                } else {
                  node.addFilter(searchTerm);
                  this.refresh(node);
                }
              } else {
                // vscode.window.showErrorMessage(`No spooled files to filter.`);
                vscode.window.showErrorMessage(t(`splfBrowser.filterSpooledFiles.error1`));
              }
            });
            
          } catch (e) {
            console.log(e);
            // vscode.window.showErrorMessage(`Error searching spooled files.`);
            vscode.window.showErrorMessage(t(`splfBrowser.filterSpooledFiles.error2`,e));
          }
        }
        else {
          node.addFilter('');
          this.refresh(node);
        }

      }),
      vscode.commands.registerCommand(`code-for-ibmi.downloadSpooledfile`, async (node) => {
        const config = getConfig();
        const contentApi = getContent();
        const connection = getConnection();
        const client = connection.client;

        if (node) {
          let fileExtension = await vscode.window.showInputBox({
            // prompt: `Type of file to create, TXT, PDF`,
            prompt: t(`splfBrowser.downloadSpooledfile.prompt`),
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
              // vscode.window.showInformationMessage(`Spooled File was downloaded.`);
              vscode.window.showInformationMessage(t(`splfBrowser.downloadSpooledfile.infoMessage`));
            } catch (e) {
              // vscode.window.showErrorMessage(`Error downloading Spoooled File! ${e}`);
              vscode.window.showInformationMessage(t(`splfBrowser.downloadSpooledfile.error`,e));
            }
          }

        } else {
          //Running from command.
        }
      }),
    )

    // getInstance().onEvent(`connected`, () => this.refresh());
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
    const connection = getConnection();
    if (connection) {
      const content = getContent();
      const config = getConfig();

      if (element) { //Chosen USER??
        // let filter;
        switch (element.contextValue.split(`_`)[0]) {
        case `splfuser`:
          //Fetch spooled files
          try {
            const objects = await content.getUserSpooledFileFilter(element.user, element.sort, undefined ,element.filter );
            items.push(...objects
              .map((object: IBMiSpooledFile) => new SPLF(`SPLF`, element, object)));

          } catch (e: any) {
            // console.log(e);
            vscode.window.showErrorMessage(e.message);
            // items.push(new vscode.TreeItem(`Error loading user spooled files.`));
            items.push(new vscode.TreeItem(t(`splfBrowser.getChildern.errorMessage1`)));
          }
        case `SPLF`:
          { }
          break;
        }

      } else { // no context exists in tree yet, get from settings
        items.push(...config.usersSpooledFile.map(
          (theUser: any) => new UserSpooledFiles(element, { user: theUser, }, connection.currentUser)
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
  async resolveTreeItem(item :UserSpooledFiles, element :any, token :vscode.CancellationToken) :Promise<vscode.TreeItem>
  {
    const content = getContent();
    const splfNum = await content.getUserSpooledFileCount(item.user);
    const userText = await content.getUserProfileText(item.user);
    item.tooltip = ``
      .concat(userText ?  t(`splfBrowser.resolveTreeItem.toolTip1`,userText) :``)
      .concat(userText ?  t(`splfBrowser.resolveTreeItem.toolTip2`,splfNum) :``)
    return item;
  }
}

class UserSpooledFiles extends vscode.TreeItem {
  protected: boolean;
  path: string;
  parent: vscode.TreeItem;
  user: string;
  _description: string;
  description: string;
  filter: string; // reduces tree items to matching tokens
  sort: { order: string };
  /**
   * @param {vscode.TreeItem} parent
   * @param {import("../typings/IBMiSplfUser")} theUser
   * @param {string} currentUser
   */
  constructor(parent: vscode.TreeItem, theUser: IBMiSplfUser, currentUser: string) {
    super(theUser.user, vscode.TreeItemCollapsibleState.Collapsed);
    this.user = theUser.user;
    const icon = objectIcons[`OUTQ`] || objectIcons[``];
    this.protected = this.user.toLocaleUpperCase() !== currentUser.toLocaleUpperCase() ? true : false;
    this.contextValue = `splfuser${this.protected ? `_readonly` : ``}`;
    this.path = theUser.user;
    this.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
    this.parent = parent;
    this.iconPath = new vscode.ThemeIcon(icon, (this.protected ? new vscode.ThemeColor(`list.errorForeground`) : undefined));

    this._description = `${theUser.user} ${this.protected ? `(readonly)` : ``}`;
    this.description = this._description;

    this.filter = '';
    /** @type {import("../api/IBMiContent").SortOptions}*/
    this.sort = { order: `date` };
  }
  sortBy(/** @type {import("../api/IBMiContent").SortOptions}*/ sort: { order: any; ascending?: any; }) {
    this.sort = sort;
    this.description = `${this._description ? `${this._description} ` : ``}(sort: ${sort.order} ${sort.ascending ? `🔼` : `🔽`})`;
  }
  addFilter( filter: string ) {this.filter = filter;} 
}

class SPLF extends vscode.TreeItem {
  parent: UserSpooledFiles;
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
  constructor(type: string, parent: UserSpooledFiles, object: IBMiSpooledFile) {

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

    this.description = t(`splfBrowser.SPLF.description`,this.status ,this.totalPages ,this.creationTimestamp.substring(11));
    this.iconPath = new vscode.ThemeIcon(icon);
    this.protected = parent.protected;
    this.contextValue = `spooledfile${this.protected ? `_readonly` : ``}`;
    this.resourceUri = getSpooledFileUri(object, parent.protected ? { readonly: true } : undefined);
    this.path = this.resourceUri.path;
    this.tooltip = ``
      .concat(object.qualified_job_name  ?  t(`splfBrowser.SPLF.toolTipJob`,object.qualified_job_name ) :``)
      .concat(object.number  ?  t(`splfBrowser.SPLF.toolTipFileNum`,object.number ) :``)
      .concat(object.user_data  ?  t(`splfBrowser.SPLF.toolTipUserData`,object.user_data ) :``)
      .concat(object.creation_timestamp  ?  t(`splfBrowser.SPLF.toolTipCreated`,object.creation_timestamp ) :``)
      .concat(object.size  ?  t(`splfBrowser.SPLF.toolTipSize`,object.size ) :``)
      .concat(object.form_type  ?  t(`splfBrowser.SPLF.toolTipForm`,object.form_type ) :``)
      .concat(object.queue  ?  t(`splfBrowser.SPLF.toolTipOQ`,object.queue ) :``)
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
function getConfig() {
  const config = instance.getConfig();
  if (config) {
    return config;
  }
  else {
    throw new Error(t('not.connected'));
  }
}

function getConnection() {
  const connection = instance.getConnection();
  if (connection) {
    return connection;
  }
  else {
    throw new Error(t('not.connected'));
  }
}

function getContent() {
  const content = instance.getContent();
  if (content) {
    return content;
  }
  else {
    throw new Error(t('not.connected'));
  }
}