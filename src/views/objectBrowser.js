
const vscode = require(`vscode`);
const fs = require(`fs`);
const os = require(`os`);
const util = require(`util`);

const writeFileAsync = util.promisify(fs.writeFile);

const FiltersUI = require(`../webviews/filters`);

let instance = require(`../Instance`);
const Configuration = require(`../api/Configuration`);
const Search = require(`../api/Search`);

module.exports = class objectBrowserTwoProvider {
  /**
   * @param {vscode.ExtensionContext} context
   */
  constructor(context) {
    this.selections = undefined;
    this.emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.emitter.event;

    context.subscriptions.push(
      vscode.commands.registerCommand(`code-for-ibmi.maintainFilter`, async (node) => {
        await FiltersUI.init(node ? node.filter : undefined);
        this.refresh();
      }),

      vscode.commands.registerCommand(`code-for-ibmi.importFilters`, async () => {
        const config = instance.getConfig();

        config.objectFilters = config.sourceFileList.map(fullPath => {
          const path = fullPath.split(`/`);
          return {
            name: fullPath,
            library: path[0],
            object: path[1],
            types: [`*SRCPF`],
            member: `*`
          }
        });

        config.set(`objectFilters`, config.objectFilters);
        
        this.refresh();
      }),

      vscode.commands.registerCommand(`code-for-ibmi.deleteFilter`, async (node) => {
        if (node) {
          const config = instance.getConfig();
          const filterName = node.filter;

          vscode.window.showInformationMessage(`Delete filter ${filterName}?`, `Yes`, `No`).then(async (value) => {
            if (value === `Yes`) {
              const index = config.objectFilters.findIndex(filter => filter.name === filterName);

              if (index > -1) {
                config.objectFilters.splice(index, 1);
                config.set(`objectFilters`, config.objectFilters);
                this.refresh();
              }
            }
          });
        }
      }),

      vscode.commands.registerCommand(`code-for-ibmi.refreshObjectBrowser`, async () => {
        this.refresh();
      }),

      vscode.commands.registerCommand(`code-for-ibmi.createMember`, async (node) => {
        if (node) {
          let fullName;
          let path = node.path.split(`/`);
          const requiresSPF = path[1] === `*ALL`;

          //Running from right click
          fullName = await vscode.window.showInputBox({
            prompt: `Name of new source member (${requiresSPF ? `file/member.ext` : `member.ext`})`
          });

          if (fullName) {
            if (requiresSPF) {
              const spfSplit = fullName.indexOf(`/`);

              if (spfSplit > 0) {
                path[1] = fullName.substring(0, spfSplit).trim().toUpperCase();
                fullName = fullName.substring(spfSplit + 1);

                if (path[1].length === 0) {
                  vscode.window.showErrorMessage(`Source file required in path.`);
                  return;
                }
              } else {
                vscode.window.showErrorMessage(`Source file required in path.`);
                return;
              }
            }

            const connection = instance.getConnection();
            const [name, extension] = fullName.split(`.`);

            if (extension !== undefined && extension.length > 0) {
              try {
                const uriPath = `${path[0]}/${path[1]}/${name}.${extension}`.toUpperCase();

                vscode.window.showInformationMessage(`Creating and opening member ${uriPath}.`);

                await connection.remoteCommand(
                  `ADDPFM FILE(${path[0]}/${path[1]}) MBR(${name}) SRCTYPE(${extension})`
                );

                vscode.commands.executeCommand(`code-for-ibmi.openEditable`, uriPath);

                if (Configuration.get(`autoRefresh`)) {
                  this.refresh();
                }
              } catch (e) {
                vscode.window.showErrorMessage(`Error creating new member! ${e}`);
              }
            } else {
              vscode.window.showErrorMessage(`Extension must be provided when creating a member.`);
            }
          }

        } else {
          //Running from command
          console.log(this);
        }
      }),

      vscode.commands.registerCommand(`code-for-ibmi.copyMember`, async (node) => {
        if (node) {
          //Running from right click
          let fullPath = await vscode.window.showInputBox({
            prompt: `New path for copy of source member`,
            value: node.path
          });

          if (fullPath) {
            fullPath = fullPath.toUpperCase();

            const connection = instance.getConnection();
            const oldPath = node.path.split(`/`);
            const oldName = oldPath[2].substring(0, oldPath[2].lastIndexOf(`.`));
            const newPath = fullPath.split(`/`);

            if (newPath.length === 3) {
              const newName = newPath[2].substring(0, newPath[2].lastIndexOf(`.`));

              try {
                vscode.window.showInformationMessage(`Creating and opening member ${fullPath}.`);

                await connection.remoteCommand(
                  `CPYSRCF FROMFILE(${oldPath[0]}/${oldPath[1]}) TOFILE(${newPath[0]}/${newPath[1]}) FROMMBR(${oldName}) TOMBR(${newName}) MBROPT(*REPLACE)`,
                )

                vscode.commands.executeCommand(`code-for-ibmi.openEditable`, fullPath);

                if (Configuration.get(`autoRefresh`)) {
                  this.refresh();
                  this.refresh();
                }
              } catch (e) {
                vscode.window.showErrorMessage(`Error creating new member! ${e}`);
              }
            } else {
              vscode.window.showErrorMessage(`Extension must be provided when creating a member.`);
            }
          }

        } else {
          //Running from command. Perhaps get active editor?
        }
      }),
      vscode.commands.registerCommand(`code-for-ibmi.deleteMember`, async (node) => {

        if (node) {
          //Running from right click
          let result = await vscode.window.showWarningMessage(`Are you sure you want to delete ${node.path}?`, `Yes`, `Cancel`);

          if (result === `Yes`) {
            const connection = instance.getConnection();
            const path = node.path.split(`/`);
            const name = path[2].substring(0, path[2].lastIndexOf(`.`));

            try {
              await connection.remoteCommand(
                `RMVM FILE(${path[0]}/${path[1]}) MBR(${name})`,
              );

              vscode.window.showInformationMessage(`Deleted ${node.path}.`);

              if (Configuration.get(`autoRefresh`)) {
                this.refresh();
              }
            } catch (e) {
              vscode.window.showErrorMessage(`Error deleting member! ${e}`);
            }

            //Not sure how to remove the item from the list. Must refresh - but that might be slow?
          }
        } else {
          //Running from command.
        }
      }),
      vscode.commands.registerCommand(`code-for-ibmi.updateMemberText`, async (node) => {
        const path = node.path.split(`/`);
        const name = path[2].substring(0, path[2].lastIndexOf(`.`));

        if (node) {
          const newText = await vscode.window.showInputBox({
            value: node.description,
            prompt: `Update ${name} text`
          });

          if (newText && newText !== node.description) {
            const connection = instance.getConnection();

            try {
              await connection.remoteCommand(
                `CHGPFM FILE(${path[0]}/${path[1]}) MBR(${name}) TEXT('${newText}')`,
              );

              if (Configuration.get(`autoRefresh`)) {
                this.refresh();
              }
            } catch (e) {
              vscode.window.showErrorMessage(`Error changing member text! ${e}`);
            }
          }
        } else {
          //Running from command.
        }
      }),
      vscode.commands.registerCommand(`code-for-ibmi.renameMember`, async (node) => {
        const path = node.path.split(`/`);

        const oldName = path[2].substring(0, path[2].lastIndexOf(`.`));
        const oldExtension = path[2].substring(path[2].lastIndexOf(`.`)+1);

        if (node) {
          let newName = await vscode.window.showInputBox({
            value: path[2],
            prompt: `Rename ${path[2]}`
          });

          newName = newName.toUpperCase();
  
          if (newName && newName.toUpperCase() !== path[2]) {
            const connection = instance.getConnection();
            const newNameParts = newName.split(`.`);
            let renameHappened = false;

            if (newNameParts.length === 2) {
              try {

                if (newNameParts[0] !== oldName) {
                  await connection.remoteCommand(
                    `RNMM FILE(${path[0]}/${path[1]}) MBR(${oldName}) NEWMBR(${newNameParts[0]})`,
                  );

                  renameHappened = true;
                }

                if (newNameParts[1] !== oldExtension) {
                  await connection.remoteCommand(
                    `CHGPFM FILE(${path[0]}/${path[1]}) MBR(${renameHappened ? newNameParts[0] : oldName}) SRCTYPE(${newNameParts[1]})`,
                  );
                }
    
                if (Configuration.get(`autoRefresh`)) {
                  this.refresh();
                }
                else vscode.window.showInformationMessage(`Renamed member. Reload required.`);
              } catch (e) {
                vscode.window.showErrorMessage(`Error renaming member! ${e}`);
              }
            } else {
              vscode.window.showErrorMessage(`New name format incorrect. 'NAME.EXTENTION' required.`);
            }
          }

          
        } else {
          //Running from command.
        }
      }),

      vscode.commands.registerCommand(`code-for-ibmi.uploadAndReplaceMemberAsFile`, async (node) => {
        const contentApi = instance.getContent();

        let originPath = await vscode.window.showOpenDialog({ defaultUri: vscode.Uri.file(os.homedir()) });
 
        if (originPath) {
          const path = node.path.split(`/`);
          let asp, lib, file, fullName;
      
          if (path.length === 3) {
            lib = path[0];
            file = path[1];
            fullName = path[2];
          } else {
            asp = path[0];
            lib = path[1];
            file = path[2];
            fullName = path[3];
          }

          const name = fullName.substring(0, fullName.lastIndexOf(`.`));

          const data = fs.readFileSync(originPath[0].fsPath, `utf8`);
          
          try {
            contentApi.uploadMemberContent(asp, lib, file, name, data);
            vscode.window.showInformationMessage(`Member was uploaded.`);
          } catch (e) {
            vscode.window.showErrorMessage(`Error uploading content to member! ${e}`);
          }
        }
  
      }),

      vscode.commands.registerCommand(`code-for-ibmi.downloadMemberAsFile`, async (node) => {
        const contentApi = instance.getContent();

        const path = node.path.split(`/`);
        let asp, lib, file, fullName;
    
        if (path.length === 3) {
          lib = path[0];
          file = path[1];
          fullName = path[2];
        } else {
          asp = path[0];
          lib = path[1];
          file = path[2];
          fullName = path[3];
        }
    
        const name = fullName.substring(0, fullName.lastIndexOf(`.`));
        const memberContent = await contentApi.downloadMemberContent(asp, lib, file, name);

        if (node) {
          let localFilepath = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(os.homedir() + `/` + fullName) });

          if (localFilepath) {
            let localPath = localFilepath.path;
            if (process.platform === `win32`) {
              //Issue with getFile not working propertly on Windows
              //when there was a / at the start.
              if (localPath[0] === `/`) localPath = localPath.substr(1);
            }

            try {
              await writeFileAsync(localPath, memberContent, `utf8`);
              vscode.window.showInformationMessage(`Member was downloaded.`);
            } catch (e) {
              vscode.window.showErrorMessage(`Error downloading member! ${e}`);
            }
          }

        } else {
          //Running from command.
        }
      }),

      vscode.commands.registerCommand(`code-for-ibmi.searchSourceFile`, async (node) => {
        if (node) {
          const config = instance.getConfig();
          const content = instance.getContent();

          const path = node.path.split(`/`);

          if (path[1] !== `*ALL`) {
            const aspText = ((config.sourceASP && config.sourceASP.length > 0) ? `(in ASP ${config.sourceASP}` : ``);

            let searchTerm = await vscode.window.showInputBox({
              prompt: `Search ${node.path}. ${aspText}`
            });

            if (searchTerm) {
              try {
                let members = [];

                await vscode.window.withProgress({
                  location: vscode.ProgressLocation.Notification,
                  title: `Searching`,
                }, async progress => {
                  progress.report({
                    message: `Fetching member list for ${node.path}.`
                  });

                  members = await content.getMemberList(path[0], path[1]);

                  if (members.length > 0) {
                    progress.report({
                      message: `'${searchTerm}' in ${node.path}.`
                    });

                    const results = await Search.searchMembers(instance, path[0], path[1], searchTerm);

                    if (results.length > 0) {

                      results.forEach(result => {
                        const resultPath = result.path.split(`/`);
                        const resultName = resultPath[resultPath.length-1];
                        result.path += `.${members.find(member => member.name === resultName).extension.toLowerCase()}`;
                      });

                      const resultDoc = Search.generateDocument(`member`, results);
  
                      const textDoc = await vscode.workspace.openTextDocument(vscode.Uri.parse(`untitled:` + `Result`));
                      const editor = await vscode.window.showTextDocument(textDoc);
                      editor.edit(edit => {
                        edit.insert(new vscode.Position(0, 0), resultDoc);
                      });

                    } else {
                      vscode.window.showInformationMessage(`No results found.`);
                    }

                  } else {
                    vscode.window.showErrorMessage(`No members to search.`);
                  }

                });

              } catch (e) {
                vscode.window.showErrorMessage(`Error searching source members: ` + e);
              }
            }
          } else {
            vscode.window.showErrorMessage(`Cannot search listings using *ALL.`);
          }

        } else {
          //Running from command.
        }
      }),

      vscode.commands.registerCommand(`code-for-ibmi.createLibrary`, async () => {
        const config = instance.getConfig();
        const connection = instance.getConnection();

        const newLibrary = await vscode.window.showInputBox({
          prompt: `Name of new library`
        });

        if (!newLibrary) return; 

        let filters = config.objectFilters;

        try {
          await connection.remoteCommand(
            `CRTLIB LIB(${newLibrary})`
          );
        } catch (e) {
          vscode.window.showErrorMessage(`Cannot create library "${newLibrary}": ${e}`);
          return;
        }
        
        if (newLibrary.length <= 10) {
          filters.push({
            name: newLibrary,
            library: newLibrary,
            object: `*ALL`,
            types: [`*ALL`],
            member: `*`
          });

          await config.set(`objectFilters`, filters);
          if (Configuration.get(`autoRefresh`)) this.refresh();
        } else {
          vscode.window.showErrorMessage(`Library name too long.`);
        }
      }),

      vscode.commands.registerCommand(`code-for-ibmi.createSourceFile`, async (node) => {
        if (node) {
          const config = instance.getConfig();
          const filter = config.objectFilters.find(filter => filter.name === node.filter);

          //Running from right click
          const fileName = await vscode.window.showInputBox({
            prompt: `Name of new source file`
          });

          if (fileName) {
            const connection = instance.getConnection();
     
            if (fileName !== undefined && fileName.length > 0 && fileName.length <= 10) {
              try {
                const library = filter.library;
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
        
        if (filters.length > 0) {
          items = filters.map(filter => new Filter(filter));
        } else {
          items = [getNewFilter()]
        }
      }
    }
    return items;
  }
}

class Filter extends vscode.TreeItem {
  /**
   * @param {{name: string, library: string, object: string, types: string[], member: string}} filter
   */
  constructor(filter) {
    super(filter.name, vscode.TreeItemCollapsibleState.Collapsed);

    this.contextValue = `filter`;
    this.description = `${filter.library}/${filter.object}/${filter.member} (${filter.types.join(`, `)})`;
    this.filter = filter.name;
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

const getNewFilter = () => {
  const item = new vscode.TreeItem(`Create new filter..`);

  item.iconPath = new vscode.ThemeIcon(`add`);
  item.command = {
    command: `code-for-ibmi.maintainFilter`,
    title: `Create new filter`
  };

  return item;
}

//https://code.visualstudio.com/api/references/icons-in-labels
const objectIcons = {
  'FILE': `database`,
  'CMD': `terminal`,
  'MODULE': `extensions`,
  'PGM': `file-binary`,
  '': `circle-large-outline`
}