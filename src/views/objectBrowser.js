
const vscode = require(`vscode`);
const fs = require(`fs`);
const os = require(`os`);
const { t } = require(`../locale`);
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

      vscode.commands.registerCommand(`code-for-ibmi.createQuickFilter`, async () => {        
        /** @type {ConnectionConfiguration.Parameters} */
        const config = getInstance().getConfig();
        const objectFilters = config.objectFilters;

        const LIBRARY_REGEX = /^(?<lib>[^/.() ]+)\*$/;
        const FILTER_REGEX = /^(?<lib>[^/.() ]+)(\/(?<obj>[^/.() ]+))?(\/(?<mbr>[^/.() ]+))?(\.(?<mbrType>[^/.() ]+))?( \((?<objType>[^/.()]+)\))?$/;

        const newFilter = await vscode.window.showInputBox({
          prompt: `Enter filter as LIB* or LIB/OBJ/MBR.MBRTYPE (OBJTYPE) where each parameter is optional except the library`,
          value: ``,
          validateInput: newFilter => {
            const libraryRegex = LIBRARY_REGEX.exec(newFilter.toUpperCase());
            const filterRegex = FILTER_REGEX.exec(newFilter.toUpperCase());
            if (!libraryRegex && !filterRegex) return `Invalid filter: ${newFilter}. Use format LIB* or LIB/OBJ/MBR.MBRTYPE (OBJTYPE) where each parameter is optional except the library`;
          }
        });

        if(newFilter) {
          let regex = LIBRARY_REGEX.exec(newFilter.toUpperCase());

          if (regex) {
            const parsedFilter = regex.groups;
            const filter = {
              name: `Filter ${objectFilters.length + 1}`,
              library: `QSYS`,
              object: `${parsedFilter.lib}*`,
              types: [`*LIB`],
              member: `*`,
              memberType: `*`,
              protected: false
            }
            objectFilters.push(filter);
          } else {
            regex = FILTER_REGEX.exec(newFilter.toUpperCase());

            if(regex) {
              const parsedFilter = regex.groups;
              const filter = {
                name: `Filter ${objectFilters.length + 1}`,
                library: parsedFilter.lib || `QGPL`,
                object: parsedFilter.obj || `*`,
                types: [parsedFilter.objType || `*SRCPF`],
                member: parsedFilter.mbr || `*`,
                memberType: parsedFilter.mbrType || `*`,
                protected: false
              }
              objectFilters.push(filter);
            }
          }

          config.objectFilters = objectFilters;
          await ConnectionConfiguration.update(config);
          this.refresh();
        }
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

          vscode.window.showInformationMessage(t(`objectBrowser.deleteFilter.infoMessage`, filterName), t(`Yes`), t(`No`)).then(async (value) => {
            if (value === t(`Yes`)) {
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
            prompt: t(`objectBrowser.createMember.prompt`),
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
            const error = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: t(`objectBrowser.createMember.progressTitle`, fullPath)}, async (progress) =>{
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
              if(await vscode.window.showErrorMessage(t(`objectBrowser.createMember.errorMessage`, fullPath, error), t(`Retry`))){
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
            prompt: t(`objectBrowser.copyMember.prompt`),
            value: node.path || fullPath,
            validateInput: (value) =>{
              try {
                newData = connection.parserMemberPath(value);
                if (newData.library === oldData.library && newData.file === oldData.file && newData.name === oldData.name) {
                  return t(`objectBrowser.copyMember.errorMessage`);
                }
              } catch (e) {
                return e.toString();
              }
            }
          });

          if (fullPath) {
            const error = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: t(`objectBrowser.copyMember.progressTitle`, fullPath.toUpperCase()) }, async (progress) =>{            
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
                  const result = await vscode.window.showInformationMessage(t(`objectBrowser.copyMember.overwrite`, newData.name), { modal: true }, t(`Yes`), t(`No`))
                  if (result === t(`Yes`)) {
                    await connection.remoteCommand(
                      `RMVM FILE(${newData.library}/${newData.file}) MBR(${newData.name})`,
                    )
                  } else {
                    throw t(`objectBrowser.copyMember.errorMessage2`, newData.name)
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
              if(await vscode.window.showErrorMessage(t(`objectBrowser.copyMember.errorMessage3`, fullPath, error), t(`Retry`))){
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
          let result = await vscode.window.showWarningMessage(t(`objectBrowser.deleteMember.warningMessage`, node.path), t(`Yes`), t(`Cancel`));

          if (result === t(`Yes`)) {
            const connection = getInstance().getConnection();
            const { library, file, name } = connection.parserMemberPath(node.path);

            try {
              await connection.remoteCommand(
                `RMVM FILE(${library}/${file}) MBR(${name})`,
              );

              vscode.window.showInformationMessage(t(`objectBrowser.deleteMember.infoMessage`, node.path));

              if (GlobalConfiguration.get(`autoRefresh`)) {
                this.refresh();
              }
            } catch (e) {
              vscode.window.showErrorMessage(t(`objectBrowser.deleteMember.errorMessage`, e));
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
            prompt: t(`objectBrowser.updateMemberText.prompt`, basename)
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
              vscode.window.showErrorMessage(t(`objectBrowser.updateMemberText.errorMessage`, e));
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
              prompt: t(`objectBrowser.renameMember.prompt`, oldMember.basename)
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
                  else vscode.window.showInformationMessage(t(`objectBrowser.renameMember.refreshMessage`));
                } catch (e) {
                  newNameOK = false;
                  vscode.window.showErrorMessage(t(`objectBrowser.renameMember.errorMessage`, e));
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
            vscode.window.showInformationMessage(t(`objectBrowser.uploadAndReplaceMemberAsFile.infoMessage`));
          } catch (e) {
            vscode.window.showErrorMessage(t(`objectBrowser.uploadAndReplaceMemberAsFile.errorMessage`, e));
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
              vscode.window.showInformationMessage(t(`objectBrowser.downloadMemberContent.infoMessage`));
            } catch (e) {
              vscode.window.showErrorMessage(t(`objectBrowser.downloadMemberContent.errorMessage`, e));
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
            prompt: t(`objectBrowser.searchSourceFile.prompt`),
            title: t(`objectBrowser.searchSourceFile.title`),
            validateInput: (input) => {
              input = input.trim();
              const path = input.split(`/`);
              let checkPath;
              if (path.length > 3) {
                return t(`objectBrowser.searchSourceFile.invalidForm`)
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
            const aspText = ((config.sourceASP && config.sourceASP.length > 0) ? t(`objectBrowser.searchSourceFile.aspText`, config.sourceASP) : ``);

            let searchTerm = await vscode.window.showInputBox({
              prompt: t(`objectBrowser.searchSourceFile.prompt2`, node.path, aspText)
            });

            if (searchTerm) {
              try {
                let members = [];

                await vscode.window.withProgress({
                  location: vscode.ProgressLocation.Notification,
                  title: t(`objectBrowser.searchSourceFile.title2`),
                }, async progress => {
                  progress.report({
                    message: t(`objectBrowser.searchSourceFile.progressMessage`, node.path)
                  });

                  members = await content.getMemberList(path[0], path[1], node.memberFilter);

                  if (members.length > 0) {
                    // NOTE: if more messages are added, lower the timeout interval
                    const timeoutInternal = 9000;
                    const searchMessages = [
                      t(`objectBrowser.searchSourceFile.searchMessage1`, searchTerm, node.path),
                      t(`objectBrowser.searchSourceFile.searchMessage2`, members.length, searchTerm, node.path),
                      t(`objectBrowser.searchSourceFile.searchMessage3`, searchTerm),
                      t(`objectBrowser.searchSourceFile.searchMessage4`, searchTerm, node.path),
                      t(`objectBrowser.searchSourceFile.searchMessage5`),
                      t(`objectBrowser.searchSourceFile.searchMessage6`),
                      t(`objectBrowser.searchSourceFile.searchMessage7`),
                      t(`objectBrowser.searchSourceFile.searchMessage8`, members.length),
                      t(`objectBrowser.searchSourceFile.searchMessage9`, searchTerm, node.path),
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
                      vscode.window.showInformationMessage(t(`objectBrowser.searchSourceFile.notFound`, searchTerm, node.path));
                    }

                  } else {
                    vscode.window.showErrorMessage(t(`objectBrowser.searchSourceFile.noMembers`));
                  }

                });

              } catch (e) {
                vscode.window.showErrorMessage(t(`objectBrowser.searchSourceFile.errorMessage`, e));
              }
            }
          } else {
            vscode.window.showErrorMessage(t(`objectBrowser.searchSourceFile.errorMessage2`));
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
          prompt: t(`objectBrowser.createLibrary.prompt`)
        });

        if (!newLibrary) return;

        let filters = config.objectFilters;

        try {
          await connection.remoteCommand(
            `CRTLIB LIB(${newLibrary})`
          );
        } catch (e) {
          vscode.window.showErrorMessage(t(`objectBrowser.createLibrary.errorMessage`, newLibrary, e));
          return;
        }

        if (newLibrary.length <= 10) {
          filters.push({
            name: newLibrary,
            library: newLibrary,
            object: `*ALL`,
            types: [`*ALL`],
            member: `*`,
            memberType: `*`,
            protected: false
          });

          config.objectFilters = filters;
          ConnectionConfiguration.update(config);
          if (GlobalConfiguration.get(`autoRefresh`)) this.refresh();

          // Add to library list ?
          await vscode.window.showInformationMessage(t(`objectBrowser.createLibrary.infoMessage`), t(`Yes`), t(`No`))
            .then(async result => {
              switch (result) {
              case t(`Yes`):
                await vscode.commands.executeCommand(`code-for-ibmi.addToLibraryList`, newLibrary);
                if (GlobalConfiguration.get(`autoRefresh`)) vscode.commands.executeCommand(`code-for-ibmi.refreshLibraryListView`);
                break;
              }
            });

        } else {
          vscode.window.showErrorMessage(t(`objectBrowser.createLibrary.errorMessage2`));
        }
      }),

      vscode.commands.registerCommand(`code-for-ibmi.createSourceFile`, async (node) => {
        if (node) {
          /** @type {ConnectionConfiguration.Parameters} */
          const config = getInstance().getConfig();
          const filter = config.objectFilters.find(filter => filter.name === node.filter);

          //Running from right click
          const fileName = await vscode.window.showInputBox({
            prompt: t(`objectBrowser.createSourceFile.prompt`)
          });

          if (fileName) {
            const connection = getInstance().getConnection();

            if (fileName !== undefined && fileName.length > 0 && fileName.length <= 10) {
              try {
                const library = filter.library;
                const uriPath = `${library}/${fileName.toUpperCase()}`

                vscode.window.showInformationMessage(t(`objectBrowser.createSourceFile.infoMessage`, uriPath));

                await connection.remoteCommand(
                  `CRTSRCPF FILE(${uriPath}) RCDLEN(112)`
                );

                if (GlobalConfiguration.get(`autoRefresh`)) {
                  this.refresh();
                }
              } catch (e) {
                vscode.window.showErrorMessage(t(`objectBrowser.createSourceFile.errorMessage`, e));
              }
            } else {
              vscode.window.showErrorMessage(t(`Source filename must be 10 chars or less.`));
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
              prompt: t(`objectBrowser.changeObjectDesc.prompt`, node.path),
              value: newText,
              validateInput: newText => {
                return newText.length <= 50 ? null : t(`objectBrowser.changeObjectDesc.errorMessage`);
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
                  vscode.window.showInformationMessage(t(`objectBrowser.changeObjectDesc.infoMessage`, node.path, node.type));
                  this.refresh();
                } else {
                  vscode.window.showInformationMessage(t(`objectBrowser.changeObjectDesc.infoMessage2`));
                }
              } catch (e) {
                vscode.window.showErrorMessage(t(`objectBrowser.changeObjectDesc.errorMessage2`, node.path, e));
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
              prompt: t(`objectBrowser.copyObject.prompt`),
              value: newPath,
              validateInput: newPath => {
                let splitPath = newPath.split(`/`);
                if (splitPath.length != 2) return t(`objectBrowser.copyObject.errorMessage`, newPath);
                if (splitPath[0].length > 10) return t(`objectBrowser.copyObject.errorMessage2`);
                if (splitPath[1].length > 10) return t(`objectBrowser.copyObject.errorMessage3`);
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
                  node.type === `LIB` ?
                    `CPYLIB FROMLIB(${oldObject}) TOLIB(${newObject})` :
                    `CRTDUPOBJ OBJ(${oldObject}) FROMLIB(${oldLibrary}) OBJTYPE(*${node.type}) TOLIB(${newLibrary}) NEWOBJ(${newObject})`
                );
                if (GlobalConfiguration.get(`autoRefresh`)) {
                  vscode.window.showInformationMessage(t(`objectBrowser.copyObject.infoMessage`, node.path, node.type, escapedPath));
                  this.refresh();
                } else {
                  vscode.window.showInformationMessage(t(`objectBrowser.copyObject.infoMessage2`, node.path, node.type, escapedPath));
                }
              } catch (e) {
                vscode.window.showErrorMessage(t(`objectBrowser.copyObject.errorMessage4`, node.path, e));
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
          let result = await vscode.window.showWarningMessage(t(`objectBrowser.deleteObject.warningMessage`, node.path, node.type), t(`Yes`), t(`Cancel`));

          if (result === t(`Yes`)) {
            const connection = getInstance().getConnection();
            const [library, object] = node.path.split(`/`);

            try {
              // TODO: Progress message about deleting!
              await connection.remoteCommand(
                `DLTOBJ OBJ(${node.path}) OBJTYPE(*${node.type})`,
              );

              vscode.window.showInformationMessage(t(`objectBrowser.deleteObject.infoMessage`, node.path, node.type));

              if (GlobalConfiguration.get(`autoRefresh`)) {
                this.refresh();
              }
            } catch (e) {
              vscode.window.showErrorMessage(t(`objectBrowser.deleteObject.errorMessage`, e));
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
              prompt: t(`objectBrowser.renameObject.prompt`),
              value: newObject,
              validateInput: newObject => {
                return newObject.length <= 10 ? null : t(`objectBrowser.renameObject.errorMessage`);
              }
            });

            if (newObject) {
              const escapedObject = newObject.replace(/'/g, `''`).replace(/`/g, `\\\``).split(`/`);
              const connection = getInstance().getConnection();

              try {
                // TODO: Progress message about renaming!
                newObjectOK = true;
                await connection.remoteCommand(
                  `RNMOBJ OBJ(${node.path}) OBJTYPE(*${node.type}) NEWOBJ(${escapedObject})`
                );
                if (GlobalConfiguration.get(`autoRefresh`)) {
                  vscode.window.showInformationMessage(t(`objectBrowser.renameObject.infoMessage`, node.path, node.type, escapedObject));
                  this.refresh();
                } else {
                  vscode.window.showInformationMessage(t(`objectBrowser.renameObject.infoMessage2`, node.path, node.type, escapedObject));
                }
              } catch (e) {
                vscode.window.showErrorMessage(t(`objectBrowser.renameObject.errorMessage2`, node.path, e));
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
              prompt: t(`objectBrowser.moveObject.prompt`),
              value: newLibrary,
              validateInput: newLibrary => {
                return newLibrary.length <= 10 ? null : t(`objectBrowser.moveObject.errorMessage`);

              }
            });

            if (newLibrary) {
              const escapedLibrary = newLibrary.replace(/'/g, `''`).replace(/`/g, `\\\``);
              const connection = getInstance().getConnection();

              try {
                // TODO: Progress message about moving!
                newLibraryOK = true;
                await connection.remoteCommand(
                  `MOVOBJ OBJ(${node.path}) OBJTYPE(*${node.type}) TOLIB(${newLibrary})`
                );
                if (GlobalConfiguration.get(`autoRefresh`)) {
                  vscode.window.showInformationMessage(t(`objectBrowser.moveObject.infoMessage`, node.path, node.type, escapedLibrary));
                  this.refresh();
                } else {
                  vscode.window.showInformationMessage(t(`objectBrowser.moveObject.infoMessage2`, node.path, node.type, escapedLibrary));
                }
              } catch (e) {
                vscode.window.showErrorMessage(t(`objectBrowser.moveObject.errorMessage2`, node.path, e));
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
          const [library, file] = spf.path.split(`/`);

          const writable = await content.checkObject({library, name: file, type: `*FILE`}, `*UPD`);
          try {
            let members = await content.getMemberList(library, file, filter.member, filter.memberType, spf.sort);
            if (objectNamesLower === true) {
              members = members.map(member => {
                member.file = member.file.toLocaleLowerCase();
                member.name = member.name.toLocaleLowerCase();
                member.extension = member.extension.toLocaleLowerCase();
                return member;
              })
            };
            items.push(...members.map(member => new Member(spf, member, filter, writable)));

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
   * @param {boolean} writable
   */
  constructor(parent, member, filter, writable) {
    super(`${member.name}.${member.extension}`);
    const readOnly = filter.protected || !writable;
    this.parent = parent;
    this.member = member;
    this.contextValue = `member${readOnly ? `_readonly` : ``}`;
    this.description = member.text;
    this.resourceUri = getMemberUri(member, readOnly ? { readonly: true } : undefined);
    this.path = this.resourceUri.path;
    this.tooltip = `${this.resourceUri.path}`
      .concat(`${member.text ? `\nText:\t\t${member.text}` : ``}`)
      .concat(`${member.lines != undefined ? `\nLines:\t${member.lines}` : ``}`)
      .concat(`${member.created ? `\nCreated:\t${member.created.toISOString().slice(0,19).replace(`T`, ` `)}` : ``}`)
      .concat(`${member.changed ? `\nChanged:\t${member.changed.toISOString().slice(0,19).replace(`T`, ` `)}` : ``}`);
    this.command = {
      command: `vscode.open`,
      title: `Open Member`,
      arguments: [this.resourceUri]
    };
    this.iconPath = readOnly ? new vscode.ThemeIcon(`lock-small`) : undefined;
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
