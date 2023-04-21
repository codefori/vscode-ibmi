
const vscode = require(`vscode`);
const fs = require(`fs`);
const os = require(`os`);
const util = require(`util`);

const writeFileAsync = util.promisify(fs.writeFile);

const FiltersUI = require(`../webviews/filters`);

let { setSearchResults } = require(`../instantiate`);
const { GlobalConfiguration, ConnectionConfiguration } = require(`../api/Configuration`);
const { Search } = require(`../api/Search`);
const { getMemberUri } = require(`../filesystems/qsys/QSysFs`);

function getInstance() {
  const { instance } = (require(`../instantiate`));
  return instance;
}

module.exports = class ObjectBrowser {
  /**
   * @param {vscode.ExtensionContext} context
   */
  constructor(context) {
    this.emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.emitter.event;
    this.treeViewer = vscode.window.createTreeView(
      `objectBrowser`, {
        treeDataProvider: this,
        showCollapseAll: true
      }
    );

    context.subscriptions.push(
      vscode.commands.registerCommand(`code-for-ibmi.sortMembersByName`, (/** @type {SPF|Member} */ spfOrMember) => {
        /** @type {SPF} */
        const spf = spfOrMember.contextValue === `SPF` ? spfOrMember : spfOrMember.parent;
        if (spf.sort.order !== `name`) {
          spf.sortBy({order: `name`, ascending:true});
        }
        else {
          spf.sort.ascending = !spf.sort.ascending
          spf.sortBy(spf.sort);
        }

        this.treeViewer.reveal(spf, {expand: true});
        this.refresh(spf);
      }),
      vscode.commands.registerCommand(`code-for-ibmi.sortMembersByDate`, (/** @type {SPF|Member} */spfOrMember) => {
        /** @type {SPF} */
        const spf = spfOrMember.contextValue === `SPF` ? spfOrMember : spfOrMember.parent;
        if (spf.sort.order !== `date`) {
          spf.sortBy({order: `date`, ascending:true})
        }
        else {
          spf.sort.ascending = !spf.sort.ascending
          spf.sortBy(spf.sort);
        }

        this.treeViewer.reveal(spf, {expand: true});
        this.refresh(spf);
      }),

      vscode.commands.registerCommand(`code-for-ibmi.createFilter`, async (node) => {
        await FiltersUI.init(undefined);
        this.refresh();
      }),

      vscode.commands.registerCommand(`code-for-ibmi.copyFilter`, async (node) => {
        if (node) {
          await FiltersUI.init(node.filter, true);
          this.refresh();
        }
      }),

      vscode.commands.registerCommand(`code-for-ibmi.maintainFilter`, async (node) => {
        await FiltersUI.init(node ? node.filter : undefined);
        this.refresh();
      }),

      vscode.commands.registerCommand(`code-for-ibmi.deleteFilter`, async (node) => {
        if (node) {
          /** @type {ConnectionConfiguration.Parameters} */
          const config = getInstance().getConfig();
          const filterName = node.filter;

          vscode.window.showInformationMessage(`Delete filter ${filterName}?`, `Yes`, `No`).then(async (value) => {
            if (value === `Yes`) {
              const index = config.objectFilters.findIndex(filter => filter.name === filterName);

              if (index > -1) {
                config.objectFilters.splice(index, 1);
                await ConnectionConfiguration.update(config);
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
            if (GlobalConfiguration.get(`autoRefresh`)) this.refresh();
          } catch (e) {
            console.log(e);
          };
        }
      }),

      vscode.commands.registerCommand(`code-for-ibmi.moveFilterDown`, async (node) => {
        if (node) {
          try {
            await this.moveFilterInList(node.filter, `DOWN`);
            if (GlobalConfiguration.get(`autoRefresh`)) this.refresh();
          } catch (e) {
            console.log(e);
          };
        }
      }),

      vscode.commands.registerCommand(`code-for-ibmi.moveFilterToTop`, async (node) => {
        if (node) {
          try {
            await this.moveFilterInList(node.filter, `TOP`);
            if (GlobalConfiguration.get(`autoRefresh`)) this.refresh();
          } catch (e) {
            console.log(e);
          };
        }
      }),

      vscode.commands.registerCommand(`code-for-ibmi.moveFilterToBottom`, async (node) => {
        if (node) {
          try {
            await this.moveFilterInList(node.filter, `BOTTOM`);
            if (GlobalConfiguration.get(`autoRefresh`)) this.refresh();
          } catch (e) {
            console.log(e);
          };
        }
      }),

      vscode.commands.registerCommand(`code-for-ibmi.sortFilters`, async (node) => {
        /** @type {ConnectionConfiguration.Parameters} */
        const config = getInstance().getConfig();

        let objectFilters = config.objectFilters;

        objectFilters.sort(function (a, b) {
          const x = a.name.toLowerCase();
          const y = b.name.toLowerCase();
          if (x < y) { return -1; }
          if (x > y) { return 1; }
          return 0;
        });

        config.objectFilters = objectFilters;
        await ConnectionConfiguration.update(config);
        if (GlobalConfiguration.get(`autoRefresh`)) this.refresh();
      }),

      vscode.commands.registerCommand(`code-for-ibmi.refreshObjectBrowser`, async () => {
        this.refresh();
      }),

      vscode.commands.registerCommand(`code-for-ibmi.createMember`, async (node, fullName) => {
        if (node) {
          //Running from right click

          const connection = getInstance().getConnection();
          let fullPath;
          let newData;

          fullName = await vscode.window.showInputBox({
            prompt: `Name of new source member (member.ext)`,
            value: fullName,
            validateInput: (value) =>{
              try {
                fullPath = `${node.path}/${value}`.toUpperCase();
                newData = connection.parserMemberPath(fullPath);
              } catch (e) {                
                return e.toString();
              }
            }
          });

          if(fullName){
            const error = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Creating member ${fullPath}...` }, async (progress) =>{
              try {
                await connection.remoteCommand(
                  `ADDPFM FILE(${newData.library}/${newData.file}) MBR(${newData.name}) SRCTYPE(${newData.extension.length > 0 ? newData.extension : `*NONE`})`
                )

                if (GlobalConfiguration.get(`autoOpenFile`)) {
                  vscode.commands.executeCommand(`vscode.open`, getMemberUri(newData));
                }

                if (GlobalConfiguration.get(`autoRefresh`)) {
                  this.refresh();
                }
              }
              catch (e) {
                return e;
              }
            });

            if(error){
              if(await vscode.window.showErrorMessage(`Error creating member ${fullPath}: ${error}`, `Retry`)){
                vscode.commands.executeCommand(`code-for-ibmi.createMember`, node, fullName);
              }
            }
          }          
        } else {
          //Running from command
          console.log(this);
        }
      }),

      vscode.commands.registerCommand(`code-for-ibmi.copyMember`, async (node, fullPath) => {
        if (node) {
          //Running from right click

          const connection = getInstance().getConnection();
          const oldData = connection.parserMemberPath(node.path);
          let newData;

          fullPath = await vscode.window.showInputBox({
            prompt: `New path for copy of source member`,
            value: node.path || fullPath,
            validateInput: (value) =>{
              try {
                newData = connection.parserMemberPath(value);
                if (newData.library === oldData.library && newData.file === oldData.file && newData.name === oldData.name) {
                  return `Cannot copy member to itself!`;
                }
              } catch (e) {
                return e.toString();
              }
            }
          });

          if (fullPath) {
            const error = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Creating member ${fullPath.toUpperCase()}...` }, async (progress) =>{            
              try {
                let newMemberExists = true;
                try {
                  await connection.remoteCommand(
                    `CHKOBJ OBJ(${newData.library}/${newData.file}) OBJTYPE(*FILE) MBR(${newData.name})`,
                  )
                } catch (e) {
                  if (String(e).includes(`CPF9815`)) {
                    newMemberExists = false;
                  }
                }

                if (newMemberExists) {
                  const result = await vscode.window.showInformationMessage(`Are you sure you want overwrite member ${newData.name}?`, { modal: true }, `Yes`, `No`)
                  if (result === `Yes`) {
                    await connection.remoteCommand(
                      `RMVM FILE(${newData.library}/${newData.file}) MBR(${newData.name})`,
                    )
                  } else {
                    throw `Member ${newData.name} already exists!`
                  }
                }

                try {
                  await connection.remoteCommand(
                    `CPYSRCF FROMFILE(${oldData.library}/${oldData.file}) TOFILE(${newData.library}/${newData.file}) FROMMBR(${oldData.name}) TOMBR(${newData.name}) MBROPT(*REPLACE)`,
                  )
                } catch (e) {
                  // Ignore CPF2869 Empty member is not copied.
                  if (!String(e).includes(`CPF2869`)) {
                    throw (e)
                  }
                }

                if (oldData.extension !== newData.extension) {
                  await connection.remoteCommand(
                    `CHGPFM FILE(${newData.library}/${newData.file}) MBR(${newData.name}) SRCTYPE(${newData.extension.length > 0 ? newData.extension : `*NONE`})`,
                  );
                }

                if (GlobalConfiguration.get(`autoOpenFile`)) {
                  vscode.commands.executeCommand(`vscode.open`, getMemberUri(newData));
                }

                if (GlobalConfiguration.get(`autoRefresh`)) {
                  this.refresh();
                }
              } catch (e) {
                return e;
              }
            });

            if(error){
              if(await vscode.window.showErrorMessage(`Error creating member ${fullPath}: ${error}`, `Retry`)){
                vscode.commands.executeCommand(`code-for-ibmi.copyMember`, node, fullPath);
              }
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
            const connection = getInstance().getConnection();
            const { library, file, name } = connection.parserMemberPath(node.path);

            try {
              await connection.remoteCommand(
                `RMVM FILE(${library}/${file}) MBR(${name})`,
              );

              vscode.window.showInformationMessage(`Deleted ${node.path}.`);

              if (GlobalConfiguration.get(`autoRefresh`)) {
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
          const connection = getInstance().getConnection();
          const { library, file, name, basename } = connection.parserMemberPath(node.path);

          const newText = await vscode.window.showInputBox({
            value: node.description,
            prompt: `Update ${basename} text`
          });

          if (newText && newText !== node.description) {
            const escapedText = newText.replace(/'/g, `''`);
            const connection = getInstance().getConnection();

            try {
              await connection.remoteCommand(
                `CHGPFM FILE(${library}/${file}) MBR(${name}) TEXT('${escapedText}')`,
              );

              if (GlobalConfiguration.get(`autoRefresh`)) {
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
          const connection = getInstance().getConnection();
          const oldMember = connection.parserMemberPath(node.path);
          const lib = oldMember.library;
          const spf = oldMember.file;
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
                  if (oldMember.name !== newMember.name) {
                    await connection.remoteCommand(
                      `RNMM FILE(${lib}/${spf}) MBR(${oldMember.name}) NEWMBR(${newMember.name})`,
                    );
                  }
                  if (oldMember.extension !== newMember.extension) {
                    await connection.remoteCommand(
                      `CHGPFM FILE(${lib}/${spf}) MBR(${newMember.name}) SRCTYPE(${newMember.extension.length > 0 ? newMember.extension : `*NONE`})`,
                    );
                  }
                  if (GlobalConfiguration.get(`autoRefresh`)) {
                    this.refresh();
                  }
                  else vscode.window.showInformationMessage(`Renamed member. Refresh object browser.`);
                } catch (e) {
                  newNameOK = false;
                  vscode.window.showErrorMessage(`Error renaming member! ${e}`);
                }
              }
            }
          } while (newBasename && !newNameOK)
        } else {
          //Running from command.
        }
      }),

      vscode.commands.registerCommand(`code-for-ibmi.uploadAndReplaceMemberAsFile`, async (node) => {
        const contentApi = getInstance().getContent();

        let originPath = await vscode.window.showOpenDialog({ defaultUri: vscode.Uri.file(os.homedir()) });

        if (originPath) {
          const connection = getInstance().getConnection();
          const { asp, library, file, name } = connection.parserMemberPath(node.path);
          const data = fs.readFileSync(originPath[0].fsPath, `utf8`);

          try {
            contentApi.uploadMemberContent(asp, library, file, name, data);
            vscode.window.showInformationMessage(`Member was uploaded.`);
          } catch (e) {
            vscode.window.showErrorMessage(`Error uploading content to member! ${e}`);
          }
        }

      }),

      vscode.commands.registerCommand(`code-for-ibmi.downloadMemberAsFile`, async (node) => {
        const contentApi = getInstance().getContent();
        const connection = getInstance().getConnection();

        const { asp, library, file, name: member, basename } = connection.parserMemberPath(node.path);

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
        if (!node) {
          const connection = getInstance().getConnection();
          await vscode.window.showInputBox({
            prompt: `Enter LIB/SPF/member.ext to search (member.ext is optional and can contain wildcards)`,
            title: `Search source file`,
            validateInput: (input) => {
              input = input.trim();
              const path = input.split(`/`);
              let checkPath;
              if (path.length > 3) {
                return `Please enter value in form LIB/SPF/member.ext`
              } else if (path.length > 2) {                 // Check member
                let checkMember = path[2].replace(/[*]/g, ``).split(`.`);
                checkMember[0] = checkMember[0] !== `` ? checkMember[0] : `a`;
                checkPath = path[0] + `/` + path[1] + `/` + checkMember[0] + `.` + (checkMember.length > 1 ? checkMember[1] : ``);
              } else if (path.length > 1) {                 // Check filename
                checkPath = input + (path[path.length - 1] === `` ? `a` : ``) + `/a.b`;
              } else {                                      // Check library
                checkPath = input + (path[path.length - 1] === `` ? `a` : ``) + `/a/a.a`;
              }
              if (checkPath) {
                try {
                  connection.parserMemberPath(checkPath);
                } catch (e) {
                  return e;
                }
              }
            }
          }).then(async input => {
            if (input) {
              const path = input.trim().toUpperCase().split(`/`);
              let member;
              if (path.length < 3 || path[2] === ``) {
                member = [`*`, `*`];
              } else if (!path[2].includes(`.`)) {
                member = [path[2], `*`];
              } else {
                member = path[2].split(`.`);
              }
              node = new SPF(undefined, ``, { library: path[0], name: path[1], text: undefined, attribute: undefined }, member[0], member[1]);
            }
          })
        };

        if (node) {
          /** @type {ConnectionConfiguration.Parameters} */
          const config = getInstance().getConfig();
          const content = getInstance().getContent();

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

                    let results = await Search.searchMembers(getInstance(), path[0], path[1], `${node.memberFilter || `*`}.MBR`, searchTerm, node.filter);

                    // Filter search result by member type filter.
                    if (results.length > 0 && node.memberTypeFilter) {
                      const patternExt = new RegExp(`^` + node.memberTypeFilter.replace(/[*]/g, `.*`).replace(/[$]/g, `\\$`) + `$`);
                      results = results.filter(result => {
                        const resultPath = result.path.split(`/`);
                        const resultName = resultPath[resultPath.length - 1];
                        const member = members.find(member => member.name === resultName);
                        return (member && patternExt.test(member.extension));
                      })
                    }

                    if (results.length > 0) {
                      const objectNamesLower = GlobalConfiguration.get(`ObjectBrowser.showNamesInLowercase`);

                      // Format result to include member type.
                      results.forEach(result => {
                        const resultPath = result.path.split(`/`);
                        const resultName = resultPath[resultPath.length - 1];
                        result.path += `.${members.find(member => member.name === resultName).extension}`;
                        if (objectNamesLower === true) {
                          result.path = result.path.toLowerCase();
                        }
                      });

                      results = results.sort((a, b) => {
                        return a.path.localeCompare(b.path);
                      });

                      setSearchResults(searchTerm, results);

                    } else {
                      vscode.window.showInformationMessage(`No results found searching for '${searchTerm}' in ${node.path}.`);
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
        /** @type {ConnectionConfiguration.Parameters} */
        const config = getInstance().getConfig();
        const connection = getInstance().getConnection();

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

          config.objectFilters = filters;
          ConnectionConfiguration.update(config);
          if (GlobalConfiguration.get(`autoRefresh`)) this.refresh();

          // Add to library list ?
          await vscode.window.showInformationMessage(`Would you like to add the new library to the library list?`, `Yes`, `No`)
            .then(async result => {
              switch (result) {
              case `Yes`:
                await vscode.commands.executeCommand(`code-for-ibmi.addToLibraryList`, newLibrary);
                if (GlobalConfiguration.get(`autoRefresh`)) vscode.commands.executeCommand(`code-for-ibmi.refreshLibraryListView`);
                break;
              }
            });

        } else {
          vscode.window.showErrorMessage(`Library name too long.`);
        }
      }),

      vscode.commands.registerCommand(`code-for-ibmi.createSourceFile`, async (node) => {
        if (node) {
          /** @type {ConnectionConfiguration.Parameters} */
          const config = getInstance().getConfig();
          const filter = config.objectFilters.find(filter => filter.name === node.filter);

          //Running from right click
          const fileName = await vscode.window.showInputBox({
            prompt: `Name of new source file`
          });

          if (fileName) {
            const connection = getInstance().getConnection();

            if (fileName !== undefined && fileName.length > 0 && fileName.length <= 10) {
              try {
                const library = filter.library;
                const uriPath = `${library}/${fileName.toUpperCase()}`

                vscode.window.showInformationMessage(`Creating source file ${uriPath}.`);

                await connection.remoteCommand(
                  `CRTSRCPF FILE(${uriPath}) RCDLEN(112)`
                );

                if (GlobalConfiguration.get(`autoRefresh`)) {
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
              const connection = getInstance().getConnection();

              try {
                newTextOK = true;
                await connection.remoteCommand(
                  `CHGOBJD OBJ(${node.path}) OBJTYPE(*${node.type}) TEXT(${newText.toUpperCase() !== `*BLANK` ? `'${escapedText}'` : `*BLANK`})`
                );
                if (GlobalConfiguration.get(`autoRefresh`)) {
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
          } while (newText && !newTextOK)
        } else {
          //Running from command
          console.log(this);
        }
      }),

      vscode.commands.registerCommand(`code-for-ibmi.copyObject`, async (node) => {
        if (node) {
          let newPath = node.path;
          let newPathOK;
          do {
            newPath = await vscode.window.showInputBox({
              prompt: `Create duplicate object to new library/object`,
              value: newPath,
              validateInput: newPath => {
                let splitPath = newPath.split(`/`);
                if (splitPath.length != 2) return `Invalid path: ${newPath}. Use format LIB/OBJ`;
                if (splitPath[0].length > 10) return `Library must be 10 chars or less.`;
                if (splitPath[1].length > 10) return `Object name must be 10 chars or less.`;
              }
            });

            if (newPath) {
              const [oldLibrary, oldObject] = node.path.split(`/`);
              const escapedPath = newPath.replace(/'/g, `''`).replace(/`/g, `\\\``);
              const [newLibrary, newObject] = escapedPath.split(`/`);
              const connection = getInstance().getConnection();

              try {
                newPathOK = true;
                await connection.remoteCommand(
                  `CRTDUPOBJ OBJ(${oldObject}) FROMLIB(${oldLibrary}) OBJTYPE(*${node.type}) TOLIB(${newLibrary}) NEWOBJ(${newObject})`
                );
                if (GlobalConfiguration.get(`autoRefresh`)) {
                  vscode.window.showInformationMessage(`Copied object ${node.path} *${node.type} to ${escapedPath}.`);
                  this.refresh();
                } else {
                  vscode.window.showInformationMessage(`Copied object ${node.path} *${node.type} to ${escapedPath}. Refresh object browser.`);
                }
              } catch (e) {
                vscode.window.showErrorMessage(`Error copying object ${node.path}! ${e}`);
                newPathOK = false;
              }
            }
          } while (newPath && !newPathOK)
        } else {
          //Running from command
          console.log(this);
        }
      }),

      vscode.commands.registerCommand(`code-for-ibmi.deleteObject`, async (node) => {

        if (node) {
          //Running from right click
          let result = await vscode.window.showWarningMessage(`Are you sure you want to delete ${node.path} *${node.type}?`, `Yes`, `Cancel`);

          if (result === `Yes`) {
            const connection = getInstance().getConnection();
            const [library, object] = node.path.split(`/`);

            try {
              await connection.remoteCommand(
                `DLTOBJ OBJ(${node.path}) OBJTYPE(*${node.type})`,
              );

              vscode.window.showInformationMessage(`Deleted ${node.path} *${node.type}.`);

              if (GlobalConfiguration.get(`autoRefresh`)) {
                this.refresh();
              }
            } catch (e) {
              vscode.window.showErrorMessage(`Error deleting object! ${e}`);
            }

          }
        } else {
          //Running from command
          console.log(this);
        }
      }),

      vscode.commands.registerCommand(`code-for-ibmi.renameObject`, async (node) => {
        if (node) {
          let [, newObject] = node.path.split(`/`);
          let newObjectOK;
          do {
            newObject = await vscode.window.showInputBox({
              prompt: `Rename object`,
              value: newObject,
              validateInput: newObject => {
                return newObject.length <= 10 ? null : `Object name must be 10 chars or less.`;
              }
            });

            if (newObject) {
              const escapedObject = newObject.replace(/'/g, `''`).replace(/`/g, `\\\``).split(`/`);
              const connection = getInstance().getConnection();

              try {
                newObjectOK = true;
                await connection.remoteCommand(
                  `RNMOBJ OBJ(${node.path}) OBJTYPE(*${node.type}) NEWOBJ(${escapedObject})`
                );
                if (GlobalConfiguration.get(`autoRefresh`)) {
                  vscode.window.showInformationMessage(`Renamed object ${node.path} *${node.type} to ${escapedObject}.`);
                  this.refresh();
                } else {
                  vscode.window.showInformationMessage(`Renamed object ${node.path} *${node.type} to ${escapedObject}. Refresh object browser.`);
                }
              } catch (e) {
                vscode.window.showErrorMessage(`Error renaming object ${node.path}! ${e}`);
                newObjectOK = false;
              }
            }
          } while (newObject && !newObjectOK)
        } else {
          //Running from command
          console.log(this);
        }
      }),

      vscode.commands.registerCommand(`code-for-ibmi.moveObject`, async (node) => {
        if (node) {
          let [newLibrary,] = node.path.split(`/`);
          let newLibraryOK;
          do {
            newLibrary = await vscode.window.showInputBox({
              prompt: `Move object to new library`,
              value: newLibrary,
              validateInput: newLibrary => {
                return newLibrary.length <= 10 ? null : `Library must be 10 chars or less.`;

              }
            });

            if (newLibrary) {
              const escapedLibrary = newLibrary.replace(/'/g, `''`).replace(/`/g, `\\\``);
              const connection = getInstance().getConnection();

              try {
                newLibraryOK = true;
                await connection.remoteCommand(
                  `MOVOBJ OBJ(${node.path}) OBJTYPE(*${node.type}) TOLIB(${newLibrary})`
                );
                if (GlobalConfiguration.get(`autoRefresh`)) {
                  vscode.window.showInformationMessage(`Moved object ${node.path} *${node.type} to ${escapedLibrary}.`);
                  this.refresh();
                } else {
                  vscode.window.showInformationMessage(`Moved object ${node.path} to ${escapedLibrary}. Refresh object browser.`);
                }
              } catch (e) {
                vscode.window.showErrorMessage(`Error moving object ${node.path}! ${e}`);
                newLibraryOK = false;
              }
            }
          } while (newLibrary && !newLibraryOK)
        } else {
          //Running from command
          console.log(this);
        }
      })
    )

    getInstance().onEvent(`connected`, () => this.refresh());
  }

  async moveFilterInList(filterName, filterMovement) {
    filterMovement = filterMovement.toUpperCase();
    if (![`TOP`, `UP`, `DOWN`, `BOTTOM`].includes(filterMovement)) throw `Illegal filter movement value specified`;

    /** @type {ConnectionConfiguration.Parameters} */
    const config = getInstance().getConfig();

    let objectFilters = config.objectFilters;
    const from = objectFilters.findIndex(filter => filter.name === filterName);
    let to;

    if (from === -1) throw `Filter ${filterName} is not found in list`;
    if (from === 0 && [`TOP`, `UP`].includes(filterMovement)) throw `Filter ${filterName} is at top of list`;
    if (from === objectFilters.length && [`DOWN`, `BOTTOM`].includes(filterMovement)) throw `Filter ${filterName} is at bottom of list`;

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
      to = objectFilters.length;
      break;
    }

    const filter = objectFilters[from];
    objectFilters.splice(from, 1);
    objectFilters.splice(to, 0, filter);
    config.objectFilters = objectFilters;
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
   * @param {vscode.TreeItem|FilterItem|ILEObject?} element
   * @returns {Promise<vscode.TreeItem[]>};
   */
  async getChildren(element) {
    const items = [];
    const connection = getInstance().getConnection();
    if (connection) {
      const content = getInstance().getContent();
      const config = getInstance().getConfig();
      const objectNamesLower = GlobalConfiguration.get(`ObjectBrowser.showNamesInLowercase`);
      const objectSortOrder = GlobalConfiguration.get(`ObjectBrowser.sortObjectsByName`) ? `name` : `type`;
      if (element) {
        /** @type {ConnectionConfiguration.ObjectFilters} */
        let filter;

        switch (element.contextValue.split(`_`)[0]) {
        case `filter`:
          /** @type {ILEObject} */ //@ts-ignore We know what is it based on contextValue.
          const obj = element;

          filter = config.objectFilters.find(filter => filter.name === obj.filter);
          let objects = await content.getObjectList(filter, objectSortOrder);
          if (objectNamesLower === true) {
            objects = objects.map(object => {
              object.name = object.name.toLocaleLowerCase();
              object.type = object.type.toLocaleLowerCase();
              object.attribute = object.attribute.toLocaleLowerCase();
              return object;
            })
          };
          items.push(...objects.map(object =>
            object.attribute.toLocaleUpperCase() === `*PHY` ? new SPF(element, filter, object) : new ILEObject(element, filter, object)
          ));
          break;

        case `SPF`:
          /** @type {SPF} */ //@ts-ignore We know what is it based on contextValue.
          const spf = element;

          filter = config.objectFilters.find(filter => filter.name === spf.filter);
          const path = spf.path.split(`/`);

          try {
            let members = await content.getMemberList(path[0], path[1], filter.member, filter.memberType, spf.sort);
            if (objectNamesLower === true) {
              members = members.map(member => {
                member.file = member.file.toLocaleLowerCase();
                member.name = member.name.toLocaleLowerCase();
                member.extension = member.extension.toLocaleLowerCase();
                return member;
              })
            };
            items.push(...members.map(member => new Member(spf, member, filter)));

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

                config.enableSQL = false;
                await ConnectionConfiguration.update(config);
                this.refresh();
              }
            } else {
              throw e;
            }
          }

          break;
        }

      } else {
        const filters = config.objectFilters;
        if (filters.length) {
          items.push(...filters.map(filter => new FilterItem(element, filter)));
        } else {
          items.push(getNewFilter());
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
    const storage = getInstance().getStorage();
    const existingDirs = storage.getSourceList();

    existingDirs[path] = list;

    return storage.setSourceList(existingDirs);
  }

  getParent(element){
    return element.parent;
  }
}

/** Implements @type {../typings/Filter} */
class FilterItem extends vscode.TreeItem {
  /**
   * @param {vscode.TreeItem} parent
   * @param {ConnectionConfiguration.ObjectFilters} filter
   */
  constructor(parent, filter) {
    super(filter.name, vscode.TreeItemCollapsibleState.Collapsed);
    
    this.parent = parent;
    this.protected = filter.protected;
    this.contextValue = `filter${this.protected ? `_readonly` : ``}`;
    this.description = `${filter.library}/${filter.object}/${filter.member}.${filter.memberType || `*`} (${filter.types.join(`, `)})`;
    this.library = filter.library;
    this.filter = filter.name;
    if (this.protected) {
      this.iconPath = new vscode.ThemeIcon(`lock-small`);
    }
  }
}

class SPF extends vscode.TreeItem {
  /**
   * @param {vscode.TreeItem} parent
   * @param {ConnectionConfiguration.ObjectFilters} filter
   * @param {{library: string, name: string, text: string, attribute?: string}} detail
   */
  constructor(parent, filter, detail) {
    super(detail.name, vscode.TreeItemCollapsibleState.Collapsed);

    this.parent = parent;
    this.filter = filter.name;
    this.protected = filter.protected;
    this.memberFilter = filter.member;
    this.memberTypeFilter = filter.memberType;

    this.contextValue = `SPF${filter.protected ? `_readonly` : ``}`;
    this.path = [detail.library, detail.name].join(`/`);
    this._description = detail.text;    
    this.iconPath = new vscode.ThemeIcon(`file-directory`);
    
    this.description = this._description;
    /** @type {import("../api/IBMiContent").SortOptions}*/
    this.sort = { order: `?` };
  }

  sortBy(/** @type {import("../api/IBMiContent").SortOptions}*/ sort) {
    this.sort = sort;
    this.description = `${this._description ? `${this._description} ` : ``}(sort: ${sort.order} ${sort.ascending ? `🔼` : `🔽`})`;
  }
}

//TODO Seb J.: once converted to TypeScript, this should implement IBMiObject
class ILEObject extends vscode.TreeItem {
  /**
   * @param {vscode.TreeItem} parent 
   * @param {ConnectionConfiguration.ObjectFilters} filter
   * @param {IBMiObject} object
   */
  constructor(parent, filter, object) {
    const type = object.type.startsWith(`*`) ? object.type.substring(1) : object.type;

    const icon = objectIcons[type.toUpperCase()] || objectIcons[``];

    super(`${object.name}.${type}`);

    this.parent = parent;
    this.filter = filter.name;

    this.library = object.library;
    this.name = object.name;
    this.attribute = object.attribute ? object.attribute.trim() : undefined;
    this.text = object.text.trim();
    this.path = `${object.library}/${object.name}`;
    this.type = type;
    this.description = this.text + (this.attribute ? ` (${this.attribute})` : ``);
    this.iconPath = new vscode.ThemeIcon(icon);

    this.contextValue = `object.${type.toLowerCase()}${this.attribute ? `.${this.attribute}` : ``}${filter.protected ? `_readonly` : ``}`;

    this.resourceUri = vscode.Uri.from({
      scheme: `object`,
      path: `/${this.library}/${this.name}.${type}`,
      fragment: this.attribute
    });

    this.command = {
      command: `vscode.open`,
      title: `Open`,
      arguments: [this.resourceUri]
    };
  }
}

class Member extends vscode.TreeItem {
  /**
   * 
   * @param {SPF} parent 
   * @param {import(`../typings`).IBMiMember} member 
   * @param {ConnectionConfiguration.ObjectFilters} filter 
   */
  constructor(parent, member, filter) {
    super(`${member.name}.${member.extension}`);
    this.parent = parent;
    this.contextValue = `member${filter.protected ? `_readonly` : ``}`;
    this.description = member.text;
    this.resourceUri = getMemberUri(member, filter.protected ? { readonly: true } : undefined);
    this.path = this.resourceUri.path;
    this.tooltip = `${this.resourceUri.path}`
      .concat(`${member.text ? `\nText: ${member.text}` : ``}`)
      .concat(`${member.lines ? `\nLines: ${member.lines}` : ``}`)
      .concat(`${member.created ? `\nCreated: ${member.created.toLocaleString()}` : ``}`)
      .concat(`${member.changed ? `\nChanged: ${member.changed.toLocaleString()}` : ``}`);
    this.command = {
      command: `vscode.open`,
      title: `Open Member`,
      arguments: [this.resourceUri]
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
