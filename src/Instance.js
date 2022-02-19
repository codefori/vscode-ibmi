
const vscode = require(`vscode`);
const path = require(`path`);

const IBMi = require(`./api/IBMi`);
const IBMiContent = require(`./api/IBMiContent`);
const CompileTools = require(`./api/CompileTools`);
const Configuration = require(`./api/Configuration`);
const Storage = require(`./api/Storage`);

const Terminal = require(`./api/terminal`);
const Deployment = require(`./api/Deployment`);

const Disposable = require(`./api/Disposable`);
const { CustomUI, Field } = require(`./api/CustomUI`);

const searchView = require(`./views/searchView`);

/** @type {vscode.StatusBarItem} */
let reconnectBarItem;

/** @type {vscode.StatusBarItem} */
let connectedBarItem;

/** @type {vscode.StatusBarItem} */
let terminalBarItem;

let initialisedBefore = false;

/** @type {vscode.Uri} */
let selectedForCompare;

/** @type {searchView} */
let searchViewContext;

module.exports = class Instance {
  static setupEmitter() {
    instance.emitter = new vscode.EventEmitter();
    instance.events = [];

    instance.emitter.event(e => {
      const runEvents = instance.events.filter(event => event.event === e);
      runEvents.forEach(event => event.func());
    })
  }

  /** 
   * @param {IBMi} conn
   */
  static setConnection(conn) {
    instance.connection = conn;
    instance.content = new IBMiContent(instance.connection);

    vscode.commands.executeCommand(`setContext`, `code-for-ibmi:connected`, true);
  };
  
  static getConnection() {return instance.connection};
  static getConfig() {return instance.connection.config};
  static getContent() {return instance.content};
  static getStorage() {return instance.storage};

  static setSearchResults(term, results) {
    searchViewContext.setResults(term, results);
  }

  /**
   * @returns {Promise<boolean>} Indicates whether it was disconnect succesfully or not.
   */
  static async disconnect() {
    let doDisconnect = true;

    for (const document of vscode.workspace.textDocuments) {
      console.log(document);
      if (!document.isClosed && [`member`, `streamfile`].includes(document.uri.scheme)) {
        if (document.isDirty) {
          if (doDisconnect) {
            await Promise.all([
              vscode.window.showErrorMessage(`Cannot disconnect while files have not been saved.`),
              vscode.window.showTextDocument(document)
            ]);

            doDisconnect = false;
          }

        } else {
          await vscode.window.showTextDocument(document); 
          await vscode.commands.executeCommand(`workbench.action.closeActiveEditor`);
        }
      }
    }

    if (doDisconnect) {
      //Dispose of any vscode related internals.
      instance.connection.subscriptions.forEach(subscription => subscription.dispose());

      if (instance.connection) {
        instance.connection.client.connection.removeAllListeners();
        instance.connection.client.dispose();
        instance.connection = undefined;
        vscode.commands.executeCommand(`setContext`, `code-for-ibmi:connected`, false);
      }

      vscode.commands.executeCommand(`workbench.action.reloadWindow`);
    }

    return doDisconnect;
  }

  /**
   * We call this after we have made a connect to the IBM i to load the rest of the plugin in.
   * @param {vscode.ExtensionContext} context
   */
  static async loadAllofExtension(context) {
    const connection = this.getConnection();
    const config = this.getConfig();

    const libraryListView = require(`./views/libraryListView`);
    
    const ifsBrowser = require(`./views/ifsBrowser`);
    const ifs = new (require(`./filesystems/ifs`));

    const objectBrowser = require(`./views/objectBrowser`);
    const databaseBrowser = require(`./views/databaseBrowser`);

    const actionsUI = require(`./webviews/actions`);
    const variablesUI = require(`./webviews/variables`);

    const CLCommands = require(`./languages/clle/clCommands`);

    if (instance.connection) {
      instance.storage = new Storage(context, instance.connection.currentConnectionName);

      CompileTools.register(context);

      if (!reconnectBarItem) {
        reconnectBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 11);
        reconnectBarItem.command = {
          command: `code-for-ibmi.connectPrevious`,
          title: `Force Reconnect`,
          arguments: [instance.connection.currentConnectionName]
        };
        context.subscriptions.push(reconnectBarItem);
      }
      
      if (Configuration.get(`showReconnectButton`)) {
        reconnectBarItem.tooltip = `Force reconnect to system.`;
        reconnectBarItem.text = `$(extensions-remote)`;
        reconnectBarItem.show();
      }

      if (!connectedBarItem) {
        connectedBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10);
        connectedBarItem.command = {
          command: `code-for-ibmi.showAdditionalSettings`,
          title: `Show Additional Connection Settings`,
        };
        context.subscriptions.push(connectedBarItem);
      }
      
      connectedBarItem.text = `$(settings-gear) Settings: ${config.name}`;
      connectedBarItem.show();

      if (!terminalBarItem) {
        terminalBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
        terminalBarItem.command = {
          command: `code-for-ibmi.launchTerminalPicker`,
          title: `Launch Terminal Picker`
        }
        context.subscriptions.push(terminalBarItem);

        terminalBarItem.text = `$(terminal) Terminals`;
      }

      terminalBarItem.show();

      //Update the status bar and that's that.
      if (initialisedBefore) {
        await Promise.all([
          vscode.commands.executeCommand(`code-for-ibmi.refreshLibraryListView`),
          vscode.commands.executeCommand(`code-for-ibmi.refreshIFSBrowser`),
          vscode.commands.executeCommand(`code-for-ibmi.refreshObjectBrowser`),
          vscode.commands.executeCommand(`code-for-ibmi.refreshDatabaseBrowser`)
        ]);
        return;

      } else {

        context.subscriptions.push(
          vscode.commands.registerCommand(`code-for-ibmi.disconnect`, async () => {
            if (instance.connection) {
              connectedBarItem.hide();
              vscode.window.showInformationMessage(`Disconnecting from ${instance.connection.currentHost}.`);
              this.disconnect();
            } else {
              vscode.window.showErrorMessage(`Not currently connected to any system.`);
            }
          }),
        );

        actionsUI.init(context);
        variablesUI.init(context);

        const deployment = new Deployment(context, this);

        //********* Library list view */

        context.subscriptions.push(
          Disposable(`libraryListView`, 
            vscode.window.registerTreeDataProvider(
              `libraryListView`,
              new libraryListView(context)
            )
          )
        );

        let qsysFs, basicMemberSupport = true;

        if (config.enableSourceDates) {
          if (connection.remoteFeatures[`QZDFMDB2.PGM`]) {
            basicMemberSupport = false;
            require(`./filesystems/qsys/complex/handler`).begin(context);
            qsysFs = new (require(`./filesystems/qsys/complex`));

            if (connection.qccsid === 65535) {
              vscode.window.showWarningMessage(`Source date support is enabled, but QCCSID is 65535. If you encounter problems with source date support, please disable it in the settings.`);
            } 
          } else {
            vscode.window.showErrorMessage(`Source date support is enabled, but the remote system does not support SQL. Source date support will be disabled.`);
          }
        }

        if (basicMemberSupport) {
          qsysFs = new (require(`./filesystems/qsys/basic`));
        }

        context.subscriptions.push(
          Disposable(`member`,
            //@ts-ignore
            vscode.workspace.registerFileSystemProvider(`member`, qsysFs, { 
              isCaseSensitive: false
            })
          )
        );

        //********* IFS Browser */

        context.subscriptions.push(
          Disposable(`ifsBrowser`,
            vscode.window.registerTreeDataProvider(
              `ifsBrowser`,
              new ifsBrowser(context)
            )
          )
        );
  
        context.subscriptions.push(
          Disposable(`streamfile`,
            //@ts-ignore
            vscode.workspace.registerFileSystemProvider(`streamfile`, ifs, { 
              isCaseSensitive: false
            })
          )
        );

        //********* Object Browser */
        
        context.subscriptions.push(
          Disposable(`objectBrowser`,
            vscode.window.registerTreeDataProvider(
              `objectBrowser`,
              new objectBrowser(context)
            )
          )
        );
        
        context.subscriptions.push(
          Disposable(`databaseBrowser`, 
            vscode.window.registerTreeDataProvider(
              `databaseBrowser`,
              new databaseBrowser(context)
            )
          )
        );

        //********* Search View */

        searchViewContext = new searchView(context);

        context.subscriptions.push(
          Disposable(`libraryListView`, 
            vscode.window.registerTreeDataProvider(
              `searchView`,
              searchViewContext
            )
          )
        );

        //********* General editing */
  
        context.subscriptions.push(
          vscode.commands.registerCommand(`code-for-ibmi.openEditable`, async (path, line) => {
            console.log(path);
            let uri;
            if (path.startsWith(`/`)) {
              //IFS
              uri = vscode.Uri.parse(path).with({scheme: `streamfile`, path});
            } else {
              uri = vscode.Uri.parse(path).with({scheme: `member`, path: `/${path}`});
            }
  
            try {
              let doc = await vscode.workspace.openTextDocument(uri); // calls back into the provider
              const editor = await vscode.window.showTextDocument(doc, { preview: false });

              if (editor && line) {
                const selectedLine = editor.document.lineAt(line);
                editor.selection = new vscode.Selection(line, selectedLine.firstNonWhitespaceCharacterIndex, line, 100);
                editor.revealRange(selectedLine.range, vscode.TextEditorRevealType.InCenter);
              }

              return true;
            } catch (e) {
              console.log(e);

              return false;
            }
          }),

          vscode.commands.registerCommand(`code-for-ibmi.selectForCompare`, async (node) => {
            if (node) {
              selectedForCompare = node.resourceUri;
              vscode.window.showInformationMessage(`Selected ${node.path} for compare.`);
            }
          }),
          vscode.commands.registerCommand(`code-for-ibmi.compareWithSelected`, async (node) => {
            if (node) {
              if (selectedForCompare) {
                vscode.commands.executeCommand(`vscode.diff`, selectedForCompare, node.resourceUri);
              } else {
                vscode.window.showInformationMessage(`Nothing selected to compare.`);
              }
            }
          })
        );

        context.subscriptions.push(
          vscode.commands.registerCommand(`code-for-ibmi.openFileByPath`, async () => {
            const searchFor = await vscode.window.showInputBox({
              prompt: `Enter file path (Format: LIB/SPF/NAME.ext or /home/xx/file.txt)`
            });

            if (searchFor) {
              let isValid = true;

              if (!searchFor.startsWith(`/`)) {
                try { //The reason for the try is because match throws an error.
                  const [path] = searchFor.match(/\w+\/\w+\/\w+\.\w+/);
                  if (path) isValid = true;
                } catch (e) {
                  isValid = false;
                }
              }

              if (isValid) {
                vscode.commands.executeCommand(`code-for-ibmi.openEditable`, searchFor);
              } else {
                vscode.window.showErrorMessage(`Format incorrect. Use LIB/SPF/NAME.ext`);
              }
            }
          }),

          vscode.commands.registerCommand(`code-for-ibmi.goToFile`, async () => {
            const sources = instance.storage.get(`sourceList`);
            const dirs = Object.keys(sources);
            let list = [];

            dirs.forEach(dir => {
              sources[dir].forEach(source => {
                list.push(`${dir}${dir.endsWith(`/`) ? `` : `/`}${source}`);
              });
            });

            if (list.length > 0) {
              list.push(`Clear list`);

              vscode.window.showQuickPick(list, {
                placeHolder: `Go to file..`
              }).then(async (selection) => {
                if (selection) {
                  if (selection === `Clear list`) {
                    instance.storage.set(`sourceList`, {});
                    vscode.window.showInformationMessage(`Cleared list.`);
                  } else {
                    vscode.commands.executeCommand(`code-for-ibmi.openEditable`, selection);
                  }
                }
              })
            } else {
              vscode.window.showErrorMessage(`No files to select from.`);
            }
          })
        )

        if (config.clContentAssistEnabled) {
          const clInstance = new CLCommands(context);
          clInstance.init();
        }

        //********* Actions */

        context.subscriptions.push(
          vscode.commands.registerCommand(`code-for-ibmi.clearDiagnostics`, async () => {
            CompileTools.clearDiagnostics();
          })
        );

        context.subscriptions.push(
          vscode.commands.registerCommand(`code-for-ibmi.runAction`, async (node) => {
            if (node) {
              const uri = node.resourceUri || node;

              CompileTools.RunAction(this, uri);

            } else {
              const editor = vscode.window.activeTextEditor;
              const uri = editor.document.uri;
              let willRun = false;

              if (editor) {
                willRun = true;
                if (config.autoSaveBeforeAction) {
                  await editor.document.save();
                } else {
                  if (editor.document.isDirty) {
                    let result = await vscode.window.showWarningMessage(`The file must be saved to run Actions.`, `Save`, `Save automatically`, `Cancel`);
                    
                    switch (result) {
                    case `Save`: 
                      await editor.document.save();
                      willRun = true;
                      break;
                    case `Save automatically`:
                      config.set(`autoSaveBeforeAction`, true);
                      await editor.document.save();
                      willRun = true;
                      break;
                    default:
                      willRun = false;
                      break;
                    }
                  }
                }
              }

              if (willRun) {
                const scheme = uri.scheme;
                switch (scheme) {
                case `member`:
                case `streamfile`:
                case `file`:
                  CompileTools.RunAction(this, uri);
                  break;
                }
              }
            }
          }),

          vscode.commands.registerCommand(`code-for-ibmi.openErrors`, async () => {
            const detail = {
              asp: undefined,
              lib: ``,
              object: ``,
              ext: undefined
            };

            let initialPath = ``, pathDetail;
            const editor = vscode.window.activeTextEditor;

            if (editor) {
              const uri = editor.document.uri;
              
              if ([`member`, `streamfile`].includes(uri.scheme)) {

                switch (uri.scheme) {
                case `member`:
                  const memberPath = uri.path.split(`/`);
                  if (memberPath.length === 4) {
                    detail.lib = memberPath[1];
                  } else if (memberPath.length === 5) {
                    detail.asp = memberPath[1];
                    detail.lib = memberPath[2];
                  }
                  break;
                case `streamfile`:
                  detail.asp = (config.sourceASP && config.sourceASP.length > 0) ? config.sourceASP : undefined;
                  detail.lib = config.currentLibrary;
                  break;
                }

                pathDetail = path.parse(editor.document.uri.path);
                detail.object = pathDetail.name;
                detail.ext = pathDetail.ext.substring(1);

                initialPath = `${detail.lib}/${detail.object}`;
              }
            }

            vscode.window.showInputBox({
              prompt: `Enter object path (LIB/OBJECT)`,
              value: initialPath
            }).then(async (selection) => {
              if (selection) {
                const [lib, object] = selection.split(`/`);
                if (lib && object) {
                  detail.lib = lib;
                  detail.object = object;
                  CompileTools.refreshDiagnostics(this, detail);
                } else {
                  vscode.window.showErrorMessage(`Format incorrect. Use LIB/OBJECT`);
                }
              }
            })
          }),

          vscode.commands.registerCommand(`code-for-ibmi.launchTerminalPicker`, () => {
            Terminal.select(this);
          }),

          vscode.commands.registerCommand(`code-for-ibmi.runCommand`, (detail) => {
            if (detail && detail.command) {
              return CompileTools.runCommand(this, detail);
            } else {
              return null;
            }
          }),
          vscode.commands.registerCommand(`code-for-ibmi.runQuery`, (statement) => {
            if (statement) {
              return instance.content.runSQL(statement);
            } else {
              return null;
            }
          }),
        );

        context.subscriptions.push(
          vscode.commands.registerCommand(`code-for-ibmi.launchUI`, (title, fields, callback) => {
            if (title && fields && callback) {
              const ui = new CustomUI();

              fields.forEach(field => {
                const uiField = new Field(field.type, field.id, field.label);
                Object.keys(field).forEach(key => {
                  uiField[key] = field[key];
                });

                ui.addField(uiField);
              });

              ui.loadPage(title, callback);
            }
          })
        );
        
        initialisedBefore = true;
      }
    }

    instance.emitter.fire(`connected`);
  }

  /**
   * Register event
   * @param {string} event 
   * @param {Function} func 
   */
  static on(event, func) {
    instance.events.push({
      event,
      func
    });
  }
};

let instance = {
  /** @type {IBMi} */
  connection: undefined,
  /** @type {IBMiContent} */
  content: undefined, //IBM,
  /** @type {Storage} */
  storage: undefined,
  /** @type {vscode.EventEmitter} */
  emitter: undefined,
  /** @type {{event: string, func: Function}[]} */
  events: []
};