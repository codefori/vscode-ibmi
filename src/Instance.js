
const vscode = require(`vscode`);

const IBMi = require(`./api/IBMi`);
const IBMiContent = require(`./api/IBMiContent`);
const CompileTools = require(`./api/CompileTools`);

const Disposable = require(`./api/Disposable`);

/** @type {vscode.StatusBarItem} */
let connectedBarItem;

/** @type {vscode.StatusBarItem} */
let actionsBarItem;

let initialisedBefore = false;

/** @type {vscode.Uri} */
let selectedForCompare;

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

    const memberBrowser = require(`./views/memberBrowser`);
    
    const ifsBrowser = require(`./views/ifsBrowser`);
    const ifs = new (require(`./filesystems/ifs`));

    const objectBrowser = require(`./views/objectBrowser`);
    const objectBrowserTwo = require(`./views/objectBrowserNew`);
    const databaseBrowser = require(`./views/databaseBrowser`);

    const actionsUI = require(`./webviews/actions`);
    const variablesUI = require(`./webviews/variables`);

    const rpgleLinter = require(`./languages/rpgle/linter`);
    const CLCommands = require(`./languages/clle/clCommands`);

    if (instance.connection) {
      CompileTools.register(context);

      if (!connectedBarItem) {
        connectedBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
        connectedBarItem.command = {
          command: `code-for-ibmi.showAdditionalSettings`,
          title: `Show Additional Connection Settings`,
        };
        context.subscriptions.push(connectedBarItem);
      }
      
      connectedBarItem.text = `Settings: ${config.name}`;
      connectedBarItem.show();

      if (!actionsBarItem) {
        actionsBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
        actionsBarItem.command = {
          command: `code-for-ibmi.showActionsMaintenance`,
          title: `Show IBM i Actions`,
        };
        context.subscriptions.push(actionsBarItem);

        actionsBarItem.text = `Actions`;
      }

      actionsBarItem.show();

      //Update the status bar and that's that.
      if (initialisedBefore) {
        await Promise.all([
          vscode.commands.executeCommand(`code-for-ibmi.refreshLibraryListView`),
          vscode.commands.executeCommand(`code-for-ibmi.refreshMemberBrowser`),
          vscode.commands.executeCommand(`code-for-ibmi.refreshIFSBrowser`),
          vscode.commands.executeCommand(`code-for-ibmi.refreshObjectList`),
          vscode.commands.executeCommand(`code-for-ibmi.refreshDatabaseBrowser`)
        ]);
        return;

      } else {

        context.subscriptions.push(
          vscode.commands.registerCommand(`code-for-ibmi.disconnect`, async () => {
            if (instance.connection) {
              connectedBarItem.hide();
              actionsBarItem.hide();
              vscode.window.showInformationMessage(`Disconnecting from ${instance.connection.currentHost}.`);
              this.disconnect();
            } else {
              vscode.window.showErrorMessage(`Not currently connected to any system.`);
            }
          })
        );

        actionsUI.init(context);
        variablesUI.init(context);

        //********* Library list view */

        context.subscriptions.push(
          Disposable(`libraryListView`, 
            vscode.window.registerTreeDataProvider(
              `libraryListView`,
              new libraryListView(context)
            )
          )
        );

        //********* Member Browser */

        context.subscriptions.push(
          Disposable(`memberBrowser`,
            vscode.window.registerTreeDataProvider(
              `memberBrowser`,
              new memberBrowser(context)
            )
          )
        );

        let qsysFs, basicMemberEditing = true;
        if (config.enableSourceDates) {
          if (connection.remoteFeatures.db2util) {
            basicMemberEditing = false;
            require(`./filesystems/qsys/complex/handler`).begin(context);
            qsysFs = new (require(`./filesystems/qsys/complex`));
          } else {
            vscode.window.showWarningMessage(`Source date support is disabled. SQL must be enabled.`);
          }
        }

        if (basicMemberEditing) {
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

        // Optional feature
        vscode.commands.executeCommand(`setContext`, `code-for-ibmi:objectBrowserTwo`, config.enableObjectBrowserTwo === true);
        
        context.subscriptions.push(
          Disposable(`objectBrowserTwo`,
            vscode.window.registerTreeDataProvider(
              `objectBrowserTwo`,
              new objectBrowserTwo(context)
            )
          )
        );
        
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

        //********* General editing */
  
        context.subscriptions.push(
          vscode.commands.registerCommand(`code-for-ibmi.openEditable`, async (path) => {
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
              await vscode.window.showTextDocument(doc, { preview: false });
            } catch (e) {
              console.log(e);
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
          })
        )

        context.subscriptions.push(
          vscode.commands.registerCommand(`code-for-ibmi.changeCurrentLibrary`, async () => {
            const config = this.getConfig();
            const currentLibrary = config.currentLibrary.toUpperCase();
    
            const newLibrary = await vscode.window.showInputBox({
              prompt: `Changing current library`,
              value: currentLibrary
            });
    
            try {
              if (newLibrary && newLibrary !== currentLibrary) {
                await config.set(`currentLibrary`, newLibrary);
              }
            } catch (e) {
              console.log(e);
            }
          })
        );
        
        new rpgleLinter(context);

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
                  CompileTools.RunAction(this, uri);
                  break;
                }
              }
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
  /** @type {vscode.EventEmitter} */
  emitter: undefined,
  /** @type {{event: string, func: Function}[]} */
  events: []
};