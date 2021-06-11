
const vscode = require(`vscode`);

let instance = require(`../Instance`);
const Configuration = require(`../api/Configuration`);
const Search = require(`../api/Search`);

module.exports = class memberBrowserProvider {
  /**
   * @param {vscode.ExtensionContext} context
   */
  constructor(context) {
    this.selections = undefined;
    this.emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.emitter.event;

    // used for targeted member list refreshes
    this.targetLib = `*ALL`;
    this.targetSpf = `*ALL`;
    
    /** @type {{[path: string]: any[]}} */
    this.refreshCache = {};

    context.subscriptions.push(
      vscode.commands.registerCommand(`code-for-ibmi.refreshMemberBrowser`, async () => {
        this.refresh();
      }),

      vscode.commands.registerCommand(`code-for-ibmi.addSourceFile`, async () => {
        const connection = instance.getConnection();
        const config = instance.getConfig();

        let sourceFiles = config.sourceFileList;

        const newSourceFile = await vscode.window.showInputBox({
          prompt: `Source file to add (Format: LIB/FILE)`
        });

        if (newSourceFile) {
          if (newSourceFile.includes(`/`)) {
            sourceFiles.push(newSourceFile.toUpperCase());
            await config.set(`sourceFileList`, sourceFiles);
            if (Configuration.get(`autoRefresh`)) this.refresh();
          } else {
            vscode.window.showErrorMessage(`Format incorrect. Use LIB/FILE.`);
          }
        }
      }),

      vscode.commands.registerCommand(`code-for-ibmi.removeSourceFile`, async (node) => {
        if (node) {
          //Running from right click
          const connection = instance.getConnection();
          const config = instance.getConfig();

          let sourceFiles = config.sourceFileList;

          let index = sourceFiles.findIndex(file => file.toUpperCase() === node.path)
          if (index >= 0) {
            sourceFiles.splice(index, 1);
          }

          await config.set(`sourceFileList`, sourceFiles);
          if (Configuration.get(`autoRefresh`)) this.refresh();
        }
      }),

      vscode.commands.registerCommand(`code-for-ibmi.refreshSourceFile`, async (node) => {
        if (node) {
          // Running from right click on Source File
          const path = node.path.split(`/`);  // LIB/SPF
          this.refresh(path[0], path[1]);
        } else { 
          // Running from command
        }
      }),
      
      vscode.commands.registerCommand(`code-for-ibmi.createMember`, async (node) => {
        if (node) {
          //Running from right click
          const fullName = await vscode.window.showInputBox({
            prompt: `Name of new source member`
          });

          if (fullName) {
            const connection = instance.getConnection();
            const path = node.path.split(`/`);
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
                  this.refresh(path[0], path[1]);
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
                  this.refresh(oldPath[0], oldPath[1]);
                  this.refresh(newPath[0], newPath[1]);
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
          const isStillOpen = vscode.workspace.textDocuments.find(document => document.uri.path === `/` + node.path);

          if (isStillOpen) {
            //Since there is no easy way to close a file.
            vscode.window.showInformationMessage(`Cannot delete member while it is open.`);

          } else {
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
                  this.refresh(path[0], path[1]);
                }
              } catch (e) {
                vscode.window.showErrorMessage(`Error deleting member! ${e}`);
              }

              //Not sure how to remove the item from the list. Must refresh - but that might be slow?
            }

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
            prompt: `Update ${path[3]} text`
          });

          if (newText && newText !== node.description) {
            const connection = instance.getConnection();

            try {
              await connection.remoteCommand(
                `CHGPFM FILE(${path[0]}/${path[1]}) MBR(${name}) TEXT('${newText}')`,
              );

              if (Configuration.get(`autoRefresh`)) {
                this.refresh(path[0], path[1]);
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
          const isStillOpen = vscode.workspace.textDocuments.find(document => document.uri.path === `/` + node.path);
          if (isStillOpen) {
            vscode.window.showInformationMessage(`Cannot rename member while it is open.`);
          } else {

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
                    this.refresh(path[0], path[1]);
                  }
                  else vscode.window.showInformationMessage(`Renamed member. Reload required.`);
                } catch (e) {
                  vscode.window.showErrorMessage(`Error renaming member! ${e}`);
                }
              } else {
                vscode.window.showErrorMessage(`New name format incorrect. 'NAME.EXTENTION' required.`);
              }
            }
          }

          
        } else {
          //Running from command.
        }
      }),

      vscode.commands.registerCommand(`code-for-ibmi.searchSourceFile`, async (node) => {
        if (node) {
          const content = instance.getContent();

          const path = node.path.split(`/`);

          let searchTerm = await vscode.window.showInputBox({
            prompt: `Search ${node.path}.`
          });

          if (searchTerm) {
            vscode.window.showInformationMessage(`Starting search for '${searchTerm}' in ${node.path}..`);
            
            try {
              let members = [];

              if (!(node.path in this.refreshCache)) {
                this.refreshCache[node.path] = await content.getMemberList(path[0], path[1]);
              }

              members = this.refreshCache[node.path];

              if (members.length > 0) {
                const results = await Search.searchMembers(instance, path[0], path[1], searchTerm);

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
                })

              } else {
                vscode.window.showErrorMessage(`No members to search.`);
              }

            } catch (e) {
              vscode.window.showErrorMessage(`Error searching source members.`);
            }
          }

        } else {
          //Running from command.
        }
      })
    )
  }

  refresh(lib=`*ALL`, spf=`*ALL`) {
    this.targetLib = lib;
    this.targetSpf = spf;
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
   * @param {SPF?} element
   * @returns {Promise<vscode.TreeItem[]>};
   */
  async getChildren(element) {
    const content = instance.getContent();
    let items = [], item;

    if (element) { //Chosen SPF
      //Fetch members
      console.log(element.path);
      const [lib, spf] = element.path.split(`/`);

      // init cache entry if not exists
      let cacheExists = element.path in this.refreshCache;
      if(!cacheExists){
        this.refreshCache[element.path] = []; // init cache entry
      }

      // only refresh member list for specific target, all LIB/SPF, or if cache entry didn't exist
      if(!cacheExists || ([lib, `*ALL`].includes(this.targetLib) && [spf, `*ALL`].includes(this.targetSpf))){
        try {
          const members = await content.getMemberList(lib, spf);
          this.refreshCache[element.path] = members; // reset cache since we're getting new data

          items.push(...members.map(member => new Member(member)));

        } catch (e) {
          console.log(e);
          item = new vscode.TreeItem(`Error loading members.`);
          vscode.window.showErrorMessage(e);
          items = [item];
        }

      } else {
        // add cached items to tree
        const members = this.refreshCache[element.path];
        items.push(...members.map(member => new Member(member)));
      }
    } else {
      const connection = instance.getConnection();

      if (connection) {
        const config = instance.getConfig();
        const shortcuts = config.sourceFileList;

        for (let shortcut of shortcuts) {
          shortcut = shortcut.toUpperCase();
          items.push(new SPF(shortcut, shortcut));
        }
      }
    }
    return items;
  }
}

class SPF extends vscode.TreeItem {
  /**
   * @param {string} label 
   * @param {string} path
   */
  constructor(label, path) {
    super(label, vscode.TreeItemCollapsibleState.Collapsed);

    this.contextValue = `SPF`;
    this.path = path;
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