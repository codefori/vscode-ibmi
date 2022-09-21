
const vscode = require(`vscode`);
const fs = require(`fs`);
const os = require(`os`);
const util = require(`util`);

const writeFileAsync = util.promisify(fs.writeFile);

const FiltersUI = require(`../webviews/filters`);

let {instance, setSearchResults} = require(`../Instance`);
const Configuration = require(`../api/Configuration`);

const Search = require(`../api/Search`);
const Tools = require(`../api/Tools`);

module.exports = class objectBrowserTwoProvider {
  /**
   * @param {vscode.ExtensionContext} context
   */
  constructor(context) {
    this.selections = undefined;
    this.emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.emitter.event;

    context.subscriptions.push(
      vscode.commands.registerCommand(`code-for-ibmi.createFilter`, async (node) => {
        await FiltersUI.init(undefined);
        this.refresh();
      }),

      vscode.commands.registerCommand(`code-for-ibmi.maintainFilter`, async (node) => {
        await FiltersUI.init(node ? node.filter : undefined);
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

      vscode.commands.registerCommand(`code-for-ibmi.moveFilterUp`, async (node) => {
        if (node) {
          try {
            await this.moveFilterInList(node.filter, `UP`);
            if (Configuration.get(`autoRefresh`)) this.refresh();
          } catch(e) {
            console.log(e);
          };
        }
      }),

      vscode.commands.registerCommand(`code-for-ibmi.moveFilterDown`, async (node) => {
        if (node) {
          try {
            await this.moveFilterInList(node.filter, `DOWN`);
            if (Configuration.get(`autoRefresh`)) this.refresh();
          } catch(e) {
            console.log(e);
          };
        }
      }),

      vscode.commands.registerCommand(`code-for-ibmi.moveFilterToTop`, async (node) => {
        if (node) {
          try {
            await this.moveFilterInList(node.filter, `TOP`);
            if (Configuration.get(`autoRefresh`)) this.refresh();
          } catch(e) {
            console.log(e);
          };
        }
      }),

      vscode.commands.registerCommand(`code-for-ibmi.moveFilterToBottom`, async (node) => {
        if (node) {
          try {
            await this.moveFilterInList(node.filter, `BOTTOM`);
            if (Configuration.get(`autoRefresh`)) this.refresh();
          } catch(e) {
            console.log(e);
          };
        }
      }),

      vscode.commands.registerCommand(`code-for-ibmi.sortFilters`, async (node) => {
        const config = instance.getConfig();

        let objectFilters = config.objectFilters;

        objectFilters.sort(function(a, b){
          const x = a.name.toLowerCase();
          const y = b.name.toLowerCase();
          if (x < y) {return -1;}
          if (x > y) {return 1;}
          return 0;
        });

        await config.set(`objectFilters`, objectFilters);
        if (Configuration.get(`autoRefresh`)) this.refresh();
      }),

      vscode.commands.registerCommand(`code-for-ibmi.refreshObjectBrowser`, async () => {
        this.refresh();
      }),

      vscode.commands.registerCommand(`code-for-ibmi.createMember`, async (node) => {
        if (node) {
          let path = node.path.split(`/`);
          
          //Running from right click
          
          const connection = instance.getConnection();
          let fullPath;
          let fullName = ``;
          let newData;
          let newNameOK;

          do {
            fullName = await vscode.window.showInputBox({
              prompt: `Name of new source member (member.ext)`,
              value: fullName
            });

            if (fullName) {
              fullName = fullName.toUpperCase();
              try {
                newNameOK = true;
                fullPath = `${node.path}/${fullName}`;
                newData = connection.parserMemberPath(fullPath);
              } catch (e) {
                newNameOK = false;
                vscode.window.showErrorMessage(`${e}`);
              }
            }

            if (fullName && newNameOK) {
              try {
                fullPath = fullPath.toUpperCase();
                vscode.window.showInformationMessage(`Creating and opening member ${fullPath}.`);

                await connection.remoteCommand(
                  `ADDPFM FILE(${newData.library}/${newData.file}) MBR(${newData.member}) SRCTYPE(${newData.extension.length > 0 ? newData.extension : `*NONE`})`
                )

                if (Configuration.get(`autoOpenFile`)) {
                  vscode.commands.executeCommand(`code-for-ibmi.openEditable`, fullPath);
                }

                if (Configuration.get(`autoRefresh`)) {
                  this.refresh();
                }
              } catch (e) {
                newNameOK = false;
                vscode.window.showErrorMessage(`Error creating member ${fullPath}! ${e}`);
              }
            }
          } while(fullName && !newNameOK)

        } else {
          //Running from command
          console.log(this);
        }
      }),

      vscode.commands.registerCommand(`code-for-ibmi.copyMember`, async (node) => {
        if (node) {
          //Running from right click

          const connection = instance.getConnection();
          const oldData = connection.parserMemberPath(node.path);
          let fullPath = node.path;
          let fullName = ``;
          let newData;
          let newNameOK;

          do {
            fullPath = await vscode.window.showInputBox({
              prompt: `New path for copy of source member`,
              value: fullPath
            });

            if (fullPath) {
              fullPath = fullPath.toUpperCase();
              try {
                newNameOK = true;
                newData = connection.parserMemberPath(fullPath);
              } catch (e) {
                newNameOK = false;
                vscode.window.showErrorMessage(`${e}`);
              }
            }

            if (fullPath && newNameOK) {
              if (newData.library === oldData.library && newData.file === oldData.file && newData.member === oldData.member) {
                newNameOK = false;
                vscode.window.showErrorMessage(`Cannot copy member to itself!`);
              }
            }

            if (fullPath && newNameOK) {
              vscode.window.showInformationMessage(`Creating and opening member ${fullPath}.`);

              try {
                let newMemberExists = true;
                try {
                  await connection.remoteCommand(
                    `CHKOBJ OBJ(${newData.library}/${newData.file}) OBJTYPE(*FILE) MBR(${newData.member})`,
                  )
                } catch (e) {
                  if (String(e).includes(`CPF9815`)) {
                    newMemberExists = false;
                  }
                }

                if (newMemberExists) {
                  const result = await vscode.window.showInformationMessage(`Are you sure you want overwrite member ${newData.member}?`, { modal:true }, `Yes`, `No`)
                  if (result === `Yes`) {
                    await connection.remoteCommand(
                      `RMVM FILE(${newData.library}/${newData.file}) MBR(${newData.member})`,
                    )
                  } else {
                    throw `Member ${newData.member} already exists!`
                  }
                }

                try {
                  await connection.remoteCommand(
                    `CPYSRCF FROMFILE(${oldData.library}/${oldData.file}) TOFILE(${newData.library}/${newData.file}) FROMMBR(${oldData.member}) TOMBR(${newData.member}) MBROPT(*REPLACE)`,
                  )
                } catch (e) {
                  // Ignore CPF2869 Empty member is not copied.
                  if (!String(e).includes(`CPF2869`)) {
                    throw (e)
                  }
                }

                if (oldData.extension !== newData.extension) {
                  await connection.remoteCommand(
                    `CHGPFM FILE(${newData.library}/${newData.file}) MBR(${newData.member}) SRCTYPE(${newData.extension.length > 0 ? newData.extension : `*NONE`})`,
                  );
                }

                if (Configuration.get(`autoOpenFile`)) {
                  vscode.commands.executeCommand(`code-for-ibmi.openEditable`, fullPath);
                }

                if (Configuration.get(`autoRefresh`)) {
                  this.refresh();
                }
              } catch (e) {
                newNameOK = false;
                vscode.window.showErrorMessage(`Error creating new member! ${e}`);
              }
              
            }
          } while(fullPath && !newNameOK)

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
            const {library, file, member} = connection.parserMemberPath(node.path);

            try {
              await connection.remoteCommand(
                `RMVM FILE(${library}/${file}) MBR(${member})`,
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
        if (node) {
          const connection = instance.getConnection();
          const {library, file, member, basename} = connection.parserMemberPath(node.path);

          const newText = await vscode.window.showInputBox({
            value: node.description,
            prompt: `Update ${basename} text`
          });

          if (newText && newText !== node.description) {
            const escapedText = newText.replace(/'/g, `''`);
            const connection = instance.getConnection();

            try {
              await connection.remoteCommand(
                `CHGPFM FILE(${library}/${file}) MBR(${member}) TEXT('${escapedText}')`,
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
        if (node) {
          const connection = instance.getConnection();
          const oldMember = connection.parserMemberPath(node.path);
          const lib = oldMember.library;
          const spf = oldMember.file;
          let fullPath = node.path;
          let newBasename = oldMember.basename;
          let newMember;
          let newNameOK;

          do {
            newBasename = await vscode.window.showInputBox({
              value: newBasename,
              prompt: `Rename ${oldMember.basename}`
            });

            if (newBasename) {
              try {
                newNameOK = true;
                newMember = connection.parserMemberPath(lib + `/` + spf + `/` + newBasename);
              } catch (e) {
                newNameOK = false;
                vscode.window.showErrorMessage(`${e}`);
              }
            }

            if (newBasename) {
              if (newBasename.toUpperCase() === oldMember.basename) {
                newNameOK = false;
              } else {
                try {
                  if (oldMember.member !== newMember.member) {
                    await connection.remoteCommand(
                      `RNMM FILE(${lib}/${spf}) MBR(${oldMember.member}) NEWMBR(${newMember.member})`,
                    );
                  }
                  if (oldMember.extension !== newMember.extension) {
                    await connection.remoteCommand(
                      `CHGPFM FILE(${lib}/${spf}) MBR(${newMember.member}) SRCTYPE(${newMember.extension.length > 0 ? newMember.extension : `*NONE`})`,
                    );
                  }
                  if (Configuration.get(`autoRefresh`)) {
                    this.refresh();
                  }
                  else vscode.window.showInformationMessage(`Renamed member. Refresh object browser.`);
                } catch(e) {
                  newNameOK = false;
                  vscode.window.showErrorMessage(`Error renaming member! ${e}`);
                }
              }
            }
          } while(newBasename && !newNameOK)
        } else {
          //Running from command.
        }
      }),

      vscode.commands.registerCommand(`code-for-ibmi.uploadAndReplaceMemberAsFile`, async (node) => {
        const contentApi = instance.getContent();

        let originPath = await vscode.window.showOpenDialog({ defaultUri: vscode.Uri.file(os.homedir()) });

        if (originPath) {
          const connection = instance.getConnection();
          const {asp, library, file, member} = connection.parserMemberPath(node.path);
          const data = fs.readFileSync(originPath[0].fsPath, `utf8`);

          try {
            contentApi.uploadMemberContent(asp, library, file, member, data);
            vscode.window.showInformationMessage(`Member was uploaded.`);
          } catch (e) {
            vscode.window.showErrorMessage(`Error uploading content to member! ${e}`);
          }
        }

      }),

      vscode.commands.registerCommand(`code-for-ibmi.downloadMemberAsFile`, async (node) => {
        const contentApi = instance.getContent();
        const connection = instance.getConnection();

        const {asp, library, file, member, basename} = connection.parserMemberPath(node.path);

        const memberContent = await contentApi.downloadMemberContent(asp, library, file, member);

        if (node) {
          let localFilepath = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(os.homedir() + `/` + basename) });

          if (localFilepath) {
            let localPath = localFilepath.path;
            if (process.platform === `win32`) {
              //Issue with getFile not working propertly on Windows
              //when there was a / at the start.
              if (localPath[0] === `/`) localPath = localPath.substring(1);
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

                  members = await content.getMemberList(path[0], path[1], node.memberFilter);

                  if (members.length > 0) {
                    // NOTE: if more messages are added, lower the timeout interval
                    const timeoutInternal = 9000;
                    const searchMessages = [
                      `'${searchTerm}' in ${node.path}.`,
                      `This is taking a while because there are ${members.length} members. Searching '${searchTerm}' in ${node.path} still.`,
                      `What's so special about '${searchTerm}' anyway?`,
                      `Still searching '${searchTerm}' in ${node.path}...`,
                      `While you wait, why not make some tea?`,
                      `Wow. This really is taking a while. Let's hope you get the result you want.`,
                      `Why was six afraid of seven?`,
                      `How does one end up with ${members.length} members?`,
                      `'${searchTerm}' in ${node.path}.`,
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

                    let results = await Search.searchMembers(instance, path[0], path[1], `${node.memberFilter}.MBR`, searchTerm);

                    // Filter search result by member type filter.
                    if (results.length > 0 && node.memberTypeFilter) {
                      const patternExt = new RegExp(`^` + node.memberTypeFilter.replace(/[*]/g, `.*`).replace(/[$]/g, `\\$`) + `$`);
                      results = results.filter(result => {
                        const resultPath = result.path.split(`/`);
                        const resultName = resultPath[resultPath.length-1];
                        const member = members.find(member => member.name === resultName);
                        return (member && patternExt.test(member.extension));
                      })
                    }

                    if (results.length > 0) {

                      // Format result to include member type.
                      results.forEach(result => {
                        const resultPath = result.path.split(`/`);
                        const resultName = resultPath[resultPath.length-1];
                        result.path += `.${members.find(member => member.name === resultName).extension}`;
                        result.path = result.path.toLowerCase();
                      });

                      results = results.sort((a, b) => {
                        return a.path.localeCompare(b.path);
                      });
                  
                      setSearchResults(searchTerm, results);

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
            member: `*`,
            memberType: `*`
          });

          await config.set(`objectFilters`, filters);
          if (Configuration.get(`autoRefresh`)) this.refresh();

          // Add to library list ?
          await vscode.window.showInformationMessage(`Would you like to add the new library to the library list?`, `Yes`, `No`)
            .then(async result => {
              switch (result) {
              case `Yes`:
                await vscode.commands.executeCommand(`code-for-ibmi.addToLibraryList`,newLibrary);
                if (Configuration.get(`autoRefresh`)) vscode.commands.executeCommand(`code-for-ibmi.refreshLibraryListView`);

                break;
              }
            });

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
      }),

      vscode.commands.registerCommand(`code-for-ibmi.changeObjectDesc`, async (node) => {
        if (node) {
          let newText = node.text;
          let newTextOK;
          do {
            newText = await vscode.window.showInputBox({
              prompt: `Change object description for ${node.path}, *BLANK for no description`,
              value: newText,
              validateInput: newText => {
                return newText.length <= 50 ? null : `Object description must be 50 chars or less.`;
              }
            });

            if (newText) {
              const escapedText = newText.replace(/'/g, `''`).replace(/`/g, `\\\``);
              const connection = instance.getConnection();

              try {
                newTextOK = true;
                await connection.remoteCommand(
                  `CHGOBJD OBJ(${node.path}) OBJTYPE(*${node.type}) TEXT(${newText.toUpperCase() !== `*BLANK` ? `'${escapedText}'` : `*BLANK`})`
                );
                if (Configuration.get(`autoRefresh`)) {
                  vscode.window.showInformationMessage(`Changed object description for ${node.path} *${node.type}.`);
                  this.refresh();
                } else {
                  vscode.window.showInformationMessage(`Changed object description. Refresh object browser.`);
                }
              } catch (e) {
                vscode.window.showErrorMessage(`Error changing description for ${node.path}! ${e}`);
                newTextOK = false;
              }
            }
          } while(newText && !newTextOK)
        } else {
          //Running from command
          console.log(this);
        }
      })

    )
  }

  async moveFilterInList(filterName, filterMovement) {
    filterMovement = filterMovement.toUpperCase();
    if (![`TOP`, `UP`, `DOWN`, `BOTTOM`].includes(filterMovement)) throw `Illegal filter movement value specified`;

    const config = instance.getConfig();

    let objectFilters = config.objectFilters;
    const from = objectFilters.findIndex(filter => filter.name === filterName);
    let to;

    if (from === -1) throw `Filter ${filterName} is not found in list`;
    if (from === 0 && [`TOP`, `UP`].includes(filterMovement)) throw `Filter ${filterName} is at top of list`;
    if (from === objectFilters.length && [`DOWN`, `BOTTOM`].includes(filterMovement)) throw `Filter ${filterName} is at bottom of list`;

    switch(filterMovement) {
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
      to = objectFilters.length;
      break;
    }

    const filter = objectFilters[from];
    objectFilters.splice(from, 1);
    objectFilters.splice(to, 0, filter);
    await config.set(`objectFilters`, objectFilters);
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
   * @param {vscode.TreeItem|Filter|ILEObject?} element
   * @returns {Promise<vscode.TreeItem[]>};
   */
  async getChildren(element) {
    const content = instance.getContent();
    const config = instance.getConfig();
    const objectNamesLower = Configuration.get(`ObjectBrowser.showNamesInLowercase`);
    let items = [], item;

    if (element) {
      let filter;

      switch (element.contextValue) {
      case `filter`:
        /** @type {ILEObject} */ //@ts-ignore We know what is it based on contextValue.
        const obj = element;

        filter = config.objectFilters.find(filter => filter.name === obj.filter);
        let objects = await content.getObjectList(filter);
        if (objectNamesLower === true) {
          objects = objects.map(object => {
            object.name = object.name.toLocaleLowerCase();
            object.type = object.type.toLocaleLowerCase();
            object.attribute = object.attribute.toLocaleLowerCase();
            return object;
          })
        };
        items = objects.map(object =>
          object.attribute.toLocaleUpperCase() === `*PHY` ? new SPF(filter.name, object, filter.member, filter.memberType) : new ILEObject(filter.name, object)
        );
        break;

      case `SPF`:
        /** @type {SPF} */ //@ts-ignore We know what is it based on contextValue.
        const spf = element;

        filter = config.objectFilters.find(filter => filter.name === spf.filter);
        const path = spf.path.split(`/`);

        try {
          let members = await content.getMemberList(path[0], path[1], filter.member, filter.memberType);
          if (objectNamesLower === true) {
            members = members.map(member => {
              member.file = member.file.toLocaleLowerCase();
              member.name = member.name.toLocaleLowerCase();
              member.extension = member.extension.toLocaleLowerCase();
              return member;
            })
          };
          items = members.map(member => new Member(member));

          await this.storeMemberList(spf.path, members.map(member => `${member.name}.${member.extension}`));
        } catch (e) {
          console.log(e);

          // Work around since we can't get the member list if the users QCCSID is not setup.
          if (config.enableSQL) {
            if (e && e.message && e.message.includes(`CCSID`)) {
              vscode.window.showErrorMessage(`Error getting member list. Disabling SQL and refreshing. It is recommended you reload. ${e.message}`, `Reload`).then(async (value) => {
                if (value === `Reload`) {
                  await vscode.commands.executeCommand(`workbench.action.reloadWindow`);
                }
              });

              config.set(`enableSQL`, false);
              this.refresh();
            }
          } else {
            throw e;
          }
        }

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

  /**
   *
   * @param {string} path
   * @param {string[]} list
   */
  storeMemberList(path, list) {
    const storage = instance.getStorage();
    const existingDirs = storage.get(`sourceList`);

    existingDirs[path] = list;

    return storage.set(`sourceList`, existingDirs);
  }
}

class Filter extends vscode.TreeItem {
  /**
   * @param {{name: string, library: string, object: string, types: string[], member: string, memberType: string}} filter
   */
  constructor(filter) {
    super(filter.name, vscode.TreeItemCollapsibleState.Collapsed);

    this.contextValue = `filter`;
    this.description = `${filter.library}/${filter.object}/${filter.member}.${filter.memberType||`*`} (${filter.types.join(`, `)})`;
    this.library = filter.library;
    this.filter = filter.name;
  }
}

class SPF extends vscode.TreeItem {
  /**
   * @param {string} filter Filter name
   * @param {{library: string, name: string, text: string, attribute?: string}} detail
   * @param {string} memberFilter Member filter string
   * @param {string} memberTypeFilter Member type filter string
   */
  constructor(filter, detail, memberFilter, memberTypeFilter) {
    super(detail.name, vscode.TreeItemCollapsibleState.Collapsed);

    this.filter = filter;
    this.memberFilter = memberFilter;
    this.memberTypeFilter = memberTypeFilter;

    this.contextValue = `SPF`;
    this.path = [detail.library, detail.name].join(`/`);
    this.description = detail.text;

    this.iconPath = new vscode.ThemeIcon(`file-directory`);
  }
}

class ILEObject extends vscode.TreeItem {
  /**
   * @param {string} filter Filter name
   * @param {{library: string, name: string, type: string, text: string, attribute?: string}} objectInfo
   */
  constructor(filter, {library, name, type, text, attribute}) {
    if (type.startsWith(`*`)) type = type.substring(1);

    const icon = objectIcons[type] || objectIcons[``];

    super(`${name}.${type}`);

    this.filter = filter;

    this.contextValue = `object`;
    this.path = `${library}/${name}`;
    this.type = type;
    this.description = text + (attribute ? ` (${attribute})` : ``);
    this.iconPath = new vscode.ThemeIcon(icon);
    this.text = text;

    this.resourceUri = vscode.Uri.from({
      scheme: `object`,
      path: `/${library}/${name}.${type}`,
      fragment: attribute ? attribute : undefined
    });
  }
}

class Member extends vscode.TreeItem {
  constructor(member) {
    const path = `${member.asp ? `${member.asp}/` : ``}${member.library}/${member.file}/${member.name}.${member.extension}`;

    super(`${member.name}.${member.extension}`);

    this.contextValue = `member`;
    this.description = member.text;
    this.path = path;
    this.resourceUri = vscode.Uri.from({
      scheme: `member`,
      path: `/${path}`
    })
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
  'DTAARA': `clippy`,
  'DTAQ': `list-ordered`,
  'JOBQ': `checklist`,
  'LIB': `library`,
  'MEDDFN': `save-all`,
  'OUTQ': `symbol-enum`,
  'PNLGRP': `book`,
  'SBSD': `server-process`,
  'SRVPGM': `file-submodule`,
  'USRSPC': `chrome-maximize`,
  '': `circle-large-outline`
}