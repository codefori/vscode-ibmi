
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
    const libraryListView = require(`./views/libraryListView`);

    const memberBrowser = require(`./views/memberBrowser`);
    const qsysFs = new (require(`./views/qsysFs`));
    
    const ifsBrowser = require(`./views/ifsBrowser`);
    const ifs = new (require(`./views/ifs`));

    const objectBrowser = require(`./views/objectBrowser`);
    const databaseBrowser = require(`./views/databaseBrowser`);

    const settingsUI = require(`./webviews/settings`);
    const actionsUI = require(`./webviews/actions`);

    const rpgleLinter = require(`./languages/rpgle/linter`);

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
      
      connectedBarItem.text = `IBM i: ${instance.connection.currentHost}`;
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

        settingsUI.init(context);
        actionsUI.init(context);

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

        //********* Actions */

        context.subscriptions.push(
          vscode.commands.registerCommand(`code-for-ibmi.clearDiagnostics`, async () => {
            CompileTools.clearDiagnostics();
          })
        );

        context.subscriptions.push(
          vscode.commands.registerCommand(`code-for-ibmi.runAction`, async () => {
            const editor = vscode.window.activeTextEditor;
            if (editor) {
              if (editor.document.isDirty)
                vscode.window.showInformationMessage(`Cannot run action while file is not saved.`);
              else
                CompileTools.RunAction(this, editor.document.uri);
            }
          })
        );
        
        context.subscriptions.push(
          vscode.commands.registerCommand(`code-for-ibmi.runActionFromView`, async (node) => {
            CompileTools.RunAction(this, node.resourceUri);
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