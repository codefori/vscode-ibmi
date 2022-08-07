
import * as vscode from 'vscode';
import * as path from 'path';

import Configuration from './api/configuration';
import IBMi from './api/connection';
import Storage from './api/storage';

import { CustomUI, Field } from './api/customUI'; 

const IBMiContent = require(`./api/IBMiContent`);
const CompileTools = require(`./api/CompileTools`);
const Tools = require(`./api/Tools`);

const Terminal = require(`./api/terminal`);
const Deployment = require(`./api/Deployment`);

const searchView = require(`./views/searchView`);

let selectedForCompare: vscode.Uri;

let searchViewContext: searchView;

export default class Instance {
  connection?: IBMi;
  content: undefined;
  storage?: Storage;

  reconnectBarItem: vscode.StatusBarItem;
  connectedBarItem: vscode.StatusBarItem;
  terminalBarItem: vscode.StatusBarItem;
  selectedForCompare?: vscode.Uri;
  searchViewContext: searchView;

  constructor(context: vscode.ExtensionContext) {
    this.reconnectBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 11);
    this.reconnectBarItem.tooltip = `Force reconnect to system.`;
    this.reconnectBarItem.text = `$(extensions-remote)`;
    context.subscriptions.push(this.reconnectBarItem);

    this.connectedBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10);
    this.connectedBarItem.command = {
      command: `code-for-ibmi.showAdditionalSettings`,
      title: `Show Additional Connection Settings`,
    };
    context.subscriptions.push(this.connectedBarItem);

    this.terminalBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
    this.terminalBarItem.command = {
      command: `code-for-ibmi.launchTerminalPicker`,
      title: `Launch Terminal Picker`
    };
    this.terminalBarItem.text = `$(terminal) Terminals`;

    context.subscriptions.push(this.terminalBarItem);
  }

  setConnection(conn: IBMi) {
    this.connection = conn;
    this.content = new IBMiContent(this.connection);

    vscode.commands.executeCommand(`setContext`, `code-for-ibmi:connected`, true);
  };

  getConnection() {return this.connection;};
  getConfig() {return this.connection ? this.connection.config : null;};
  getContent() {return this.content;};
  getStorage() {return this.storage;};

  setSearchResults(term: string, results) {
    searchViewContext.setResults(term, results);
  }

  /**
   * @returns {Promise<boolean>} Indicates whether it was disconnect succesfully or not.
   */
  async disconnect() {
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

      if (this.connection) {
        this.connection.subscriptions.forEach(subscription => subscription.dispose());
        this.connection.client.connection.removeAllListeners();
        this.connection.client.dispose();
        vscode.commands.executeCommand(`setContext`, `code-for-ibmi:connected`, false);
      }

      vscode.commands.executeCommand(`workbench.action.reloadWindow`);
    }

    return doDisconnect;
  }

  /**
   * We call this after we have made a connect to the IBM i to load the rest of the plugin in.
   */
  async loadAllofExtension(context: vscode.ExtensionContext) {
    const config = this.getConfig();

    const helpView = require(`./views/helpView`);

    const libraryListView = require(`./views/libraryListView`);
    const profilesView = require(`./views/profilesView`);

    const ifsBrowser = require(`./views/ifsBrowser`);
    const ifs = new (require(`./filesystems/ifs`));

    const objectBrowser = require(`./views/objectBrowser`);

    const actionsUI = require(`./webviews/actions`);
    const variablesUI = require(`./webviews/variables`);

    const CLCommands = require(`./languages/clle/clCommands`);

    const ColorProvider = require(`./languages/general/ColorProvider`);

    if (this.connection && config) {
      this.storage = new Storage(context, this.connection.currentConnectionName);

      CompileTools.register(context);

      if (Configuration.get(`showReconnectButton`)) {
        this.reconnectBarItem.command = {
          command: `code-for-ibmi.connectPrevious`,
          title: `Force Reconnect`,
          arguments: [this.connection.currentConnectionName]
        };
        this.reconnectBarItem.show();
      }

      this.connectedBarItem.text = `$(settings-gear) Settings: ${config.name}`;
      this.connectedBarItem.show();

      this.terminalBarItem.show();


      context.subscriptions.push(
        vscode.commands.registerCommand(`code-for-ibmi.disconnect`, async () => {
          if (this.connection) {
            this.connectedBarItem.hide();
            vscode.window.showInformationMessage(`Disconnecting from ${this.connection.currentHost}.`);
            this.disconnect();
          } else {
            vscode.window.showErrorMessage(`Not currently connected to any system.`);
          }
        }),
      );

      actionsUI.init(context);
      variablesUI.init(context);

      const deployment = new Deployment(context, this);

      //********* Help view */

      context.subscriptions.push(
        vscode.window.registerTreeDataProvider(
          `helpView`,
          new helpView()
        )
      );

      //********* Library list view */

      context.subscriptions.push(
        vscode.window.registerTreeDataProvider(
          `libraryListView`,
          new libraryListView(context)
        ),
        vscode.window.registerTreeDataProvider(
          `profilesView`,
          new profilesView(context)
        ),
      );

      let qsysFs, basicMemberSupport = true;

      if (this.connection.config.enableSourceDates) {
        if (this.connection.remoteFeatures[`QZDFMDB2.PGM`]) {
          basicMemberSupport = false;
          require(`./filesystems/qsys/complex/handler`).begin(context);
          qsysFs = new (require(`./filesystems/qsys/complex`));

          if (this.connection.qccsid === 65535) {
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
        //@ts-ignore
        vscode.workspace.registerFileSystemProvider(`member`, qsysFs, {
          isCaseSensitive: false
        })
      );

      //********* IFS Browser */

      context.subscriptions.push(
        vscode.window.registerTreeDataProvider(
          `ifsBrowser`,
          new ifsBrowser(context)
        )
      );

      context.subscriptions.push(
        //@ts-ignore
        vscode.workspace.registerFileSystemProvider(`streamfile`, ifs, {
          isCaseSensitive: false
        })
      );

      //********* Object Browser */

      context.subscriptions.push(
        vscode.window.registerTreeDataProvider(
          `objectBrowser`,
          new objectBrowser(context)
        )
      );

      //********* Search View */

      searchViewContext = new searchView(context);

      context.subscriptions.push(
        vscode.window.registerTreeDataProvider(
          `searchView`,
          searchViewContext
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
            if (line) {
              // If a line is provided, we have to do a specific open
              let doc = await vscode.workspace.openTextDocument(uri); // calls back into the provider
              const editor = await vscode.window.showTextDocument(doc, { preview: false });

              if (editor) {
                const selectedLine = editor.document.lineAt(line);
                editor.selection = new vscode.Selection(line, selectedLine.firstNonWhitespaceCharacterIndex, line, 100);
                editor.revealRange(selectedLine.range, vscode.TextEditorRevealType.InCenter);
              }

            } else {
              // Otherwise, do a generic open
              const res = await vscode.commands.executeCommand(`vscode.open`, uri);
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
          if (selectedForCompare) {
            let uri;
            if (node) {
              uri = node.resourceUri;
            } else {
              const activeEditor = vscode.window.activeTextEditor;

              const compareWith = await vscode.window.showInputBox({
                prompt: `Enter the path to compare selected with`,
                value: `${activeEditor ? activeEditor.document.uri.toString() : selectedForCompare.toString()}`,
                title: `Compare with`
              });

              if (compareWith)
              {
                uri = vscode.Uri.parse(compareWith);
              }
            }

            if (uri) {
              vscode.commands.executeCommand(`vscode.diff`, selectedForCompare, uri);
            } else {
              vscode.window.showErrorMessage(`No compare to path provided.`);
            }
          } else {
            vscode.window.showInformationMessage(`Nothing selected to compare.`);
          }
        })
      );

      context.subscriptions.push(
        vscode.commands.registerCommand(`code-for-ibmi.openFileByPath`, async () => {
          const searchFor = await vscode.window.showInputBox({
            prompt: `Enter file path (Format: LIB/SPF/NAME.ext or /home/xx/file.txt)`
          });

          if (searchFor && this.connection) {
            try {
              // If opening a source member, parse and validate the path.
              if (!searchFor.startsWith(`/`)) {
                this.connection.parserMemberPath(searchFor);
              }
              vscode.commands.executeCommand(`code-for-ibmi.openEditable`, searchFor);
            } catch (e) {
              vscode.window.showErrorMessage(e.message);
            }
          }
        }),

        vscode.commands.registerCommand(`code-for-ibmi.goToFile`, async () => {
          const storage = this.getStorage();
          if (storage) {
            const sources = storage.get(`sourceList`);
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
                    storage.set(`sourceList`, {});
                    vscode.window.showInformationMessage(`Cleared list.`);
                  } else {
                    vscode.commands.executeCommand(`code-for-ibmi.openEditable`, selection);
                  }
                }
              });
            } else {
              vscode.window.showErrorMessage(`No files to select from.`);
            } 
          }
        })
      );

      // ********* CL content assist */
      if (config.clContentAssistEnabled) {
        const clInstance = new CLCommands(context);
        clInstance.init();
      }

      // ********* Color provider */
      if (Configuration.get(`showSeuColors`)) {
        new ColorProvider(context);
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
            let willRun = false;

            if (editor) {
              const uri = editor.document.uri;

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
          }
        }),

        vscode.commands.registerCommand(`code-for-ibmi.openErrors`, async () => {
          const detail: {asp?: string, lib: string, object: string, ext?: string} = {
            lib: ``,
            object: ``,
          };

          let initialPath = ``, pathDetail;
          const editor = vscode.window.activeTextEditor;

          if (editor && this.connection) {
            const uri = editor.document.uri;

            if ([`member`, `streamfile`].includes(uri.scheme)) {

              switch (uri.scheme) {
              case `member`:
                const parsedPath = this.connection.parserMemberPath(uri.path);
                detail.asp = parsedPath.asp;
                detail.lib = parsedPath.library;
                break;
              case `streamfile`:
                detail.asp = (config.sourceASP && config.sourceASP.length > 0) ? config.sourceASP : undefined;
                detail.lib = config.currentLibrary || `QGPL`;
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
          });
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
        vscode.commands.registerCommand(`code-for-ibmi.launchUI`, (title: string, fields: Field[], callback) => {
          if (title && fields && callback) {
            const ui = new CustomUI();

            fields.forEach(field => {
              const uiField = new Field(field.type, field.id, field.label);
              uiField.from(field);
              ui.addField(uiField);
            });

            ui.loadPage(title, callback);
          }
        })
      );

      // Enable the profile view if profiles exist.
      const enableProfiles = config.connectionProfiles && config.connectionProfiles.length > 0;
      vscode.commands.executeCommand(`setContext`, `code-for-ibmi:hasProfiles`, enableProfiles);

      deployment.initialise(this);
    }
  }
};