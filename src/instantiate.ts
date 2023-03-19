
import * as vscode from "vscode";
import Instance from "./api/Instance";
import IBMi from "./api/IBMi";
import IBMiContent from "./api/IBMiContent";
import { ConnectionStorage, GlobalStorage } from "./api/Storage";
import path from 'path';

import { CompileTools } from './api/CompileTools';

import { Terminal } from './api/Terminal';
import { Deployment } from './api/local/deployment';
import * as Debug from './api/debug';

import { CustomUI, Field, FieldType, Page } from './api/CustomUI';

import { SearchView } from "./views/searchView";
import { HelpView } from "./views/helpView";
import { ConnectionConfiguration, GlobalConfiguration } from "./api/Configuration";
import { Search } from "./api/Search";

import getComplexHandler from "./filesystems/qsys/complex/handlers";
import { ProfilesView } from "./views/ProfilesView";
import { SEUColorProvider } from "./languages/general/SEUColorProvider";
import { QsysFsOptions, RemoteCommand } from "./typings";
import { getMemberUri, getUriFromPath } from "./filesystems/qsys/QSysFs";

let reconnectBarItem: vscode.StatusBarItem;
let connectedBarItem: vscode.StatusBarItem;
let terminalBarItem: vscode.StatusBarItem;
let disconnectBarItem: vscode.StatusBarItem;
let actionsBarItem: vscode.StatusBarItem;
let outputBarItem: vscode.StatusBarItem;

let initialisedBefore = false;

let selectedForCompare: vscode.Uri;

let searchViewContext: SearchView;

export const instance = new Instance();

export function setupEmitter() {
  instance.emitter = new vscode.EventEmitter();
  instance.events = [];

  instance.emitter.event(e => {
    const runEvents = instance.events.filter(event => event.event === e);
    runEvents.forEach(event => event.func());
  })
}

export function setConnection(conn: IBMi) {
  instance.connection = conn;
  instance.content = new IBMiContent(instance.connection);

  vscode.commands.executeCommand(`setContext`, `code-for-ibmi:connected`, true);
};

export function setSearchResults(term: string, results: Search.Result[]) {
  searchViewContext.setResults(term, results);
}

export async function disconnect(): Promise<boolean> {
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
    // Do the disconnect
    if (instance.connection) {
      instance.connection.end();
      instance.connection = undefined;
    }
    
    instance.emitter?.fire(`disconnected`);

    // Close the tabs
    vscode.window.tabGroups.all.forEach(group => {
      vscode.window.tabGroups.close(group);
    });

    // Hide the bar items
    [
      reconnectBarItem, 
      disconnectBarItem, 
      connectedBarItem, 
      terminalBarItem,
      actionsBarItem,
      outputBarItem
    ].forEach(barItem => {
      if (barItem) barItem.hide();
    })

    vscode.commands.executeCommand(`setContext`, `code-for-ibmi:connected`, false);
  }

  return doDisconnect;
}

export async function loadAllofExtension(context: vscode.ExtensionContext) {
  const connection = instance.getConnection();
  const config = instance.getConfig();

  if (!connection) return;
  if (!config) return;

  const libraryListView = require(`./views/libraryListView`);
  const ifsBrowser = require(`./views/ifsBrowser`);
  const ifs = new (require(`./filesystems/ifs`));

  const objectBrowser = require(`./views/objectBrowser`);

  const actionsUI = require(`./webviews/actions`);
  const variablesUI = require(`./webviews/variables`);

  const CLCommands = require(`./languages/clle/clCommands`);

  if (instance.connection) {
    instance.storage = new ConnectionStorage(context, instance.connection.currentConnectionName);

    if (!reconnectBarItem) {
      reconnectBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 11);
      reconnectBarItem.command = {
        command: `code-for-ibmi.connectTo`,
        title: `Force Reconnect`,
        arguments: [instance.connection.currentConnectionName]
      };
      context.subscriptions.push(reconnectBarItem);
    }

    if (GlobalConfiguration.get<boolean>(`showConnectionButtons`)) {
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
      context.subscriptions.push(
        connectedBarItem,
        vscode.workspace.onDidChangeConfiguration(async event => {
          if (event.affectsConfiguration(`code-for-ibmi.connectionSettings`)) {
            connectedBarItem.text = `$(${config.readOnlyMode ? "lock" : "settings-gear"}) Settings: ${config.name}`;
          }
        }));
    }

    connectedBarItem.text = `$(${config.readOnlyMode ? "lock" : "settings-gear"}) Settings: ${config.name}`;
    connectedBarItem.show();

    if (!disconnectBarItem) {
      disconnectBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 12);
      disconnectBarItem.command = {
        command: `code-for-ibmi.disconnect`,
        title: `Disconnect from system`
      }
      context.subscriptions.push(disconnectBarItem);
    }

    if (GlobalConfiguration.get<boolean>(`showConnectionButtons`)) {
      disconnectBarItem.tooltip = `Disconnect from system.`;
      disconnectBarItem.text = `$(debug-disconnect)`;
      disconnectBarItem.show();
    }

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

    if (!actionsBarItem) {
      actionsBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
      actionsBarItem.command = {
        command: `code-for-ibmi.showActionsMaintenance`,
        title: `Show IBM i Actions`,
      };
      actionsBarItem.text = `$(file-binary) Actions`;
    }

    actionsBarItem.show();

    outputBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
    
    outputBarItem.command = {
      command: `code-for-ibmi.showOutputPanel`,
      title: `Show IBM i Output`,
    };
    outputBarItem.text = `$(three-bars) Output`;

    if (GlobalConfiguration.get<boolean>(`logCompileOutput`)) {
      outputBarItem.show();
    }

    //Update the status bar and that's that.
    if (initialisedBefore) {
      await Promise.all([
        vscode.commands.executeCommand(`code-for-ibmi.refreshLibraryListView`),
        vscode.commands.executeCommand(`code-for-ibmi.refreshIFSBrowser`),
        vscode.commands.executeCommand(`code-for-ibmi.refreshObjectBrowser`)
      ]);
      return;

    } else {
      CompileTools.register(context);
      Debug.initialise(instance, context);
      
      context.subscriptions.push(
        vscode.commands.registerCommand(`code-for-ibmi.disconnect`, async () => {
          if (instance.connection) {
            connectedBarItem.hide();
            vscode.window.showInformationMessage(`Disconnecting from ${instance.connection.currentHost}.`);
            disconnect();
          } else {
            vscode.window.showErrorMessage(`Not currently connected to any system.`);
          }
        }),
      );

      actionsUI.init(context);
      variablesUI.init(context);

      //********* Help view */

      context.subscriptions.push(
        vscode.window.registerTreeDataProvider(
          `helpView`,
          new HelpView()
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
          new ProfilesView(context)
        ),
      );

      let qsysFs, basicMemberSupport = true;

      if (config.enableSourceDates) {
        if (connection.remoteFeatures[`QZDFMDB2.PGM`]) {
          basicMemberSupport = false;
          getComplexHandler(context, config.sourceDateMode);
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
        //@ts-ignore
        vscode.workspace.registerFileSystemProvider(`member`, qsysFs, {
          isCaseSensitive: false
        })
      );

      // ********* CL content assist */
      const clExtension = vscode.extensions.getExtension(`IBM.vscode-clle`);
      if (clExtension) {
        CLCommands.init();
      }

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

      searchViewContext = new SearchView(context);

      context.subscriptions.push(
        vscode.window.registerTreeDataProvider(
          `searchView`,
          searchViewContext
        )
      );

      //********* General editing */

      context.subscriptions.push(
        vscode.commands.registerCommand(`code-for-ibmi.openEditable`, async (path: string, line?: number, options?: QsysFsOptions) => {
          console.log(path);
          const uri = getUriFromPath(path, options);
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
              await vscode.commands.executeCommand(`vscode.open`, uri);
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
              })

              if (compareWith)
                uri = vscode.Uri.parse(compareWith);
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

      vscode.commands.registerCommand(`code-for-ibmi.goToFileReadOnly`, async () => vscode.commands.executeCommand(`code-for-ibmi.goToFile`, true));
      vscode.commands.registerCommand(`code-for-ibmi.goToFile`, async (readonly?: boolean) => {
        const storage = instance.getStorage();
        if (!storage) return;

        const sources = storage.getSourceList();
        const dirs = Object.keys(sources);
        let list: string[] = [];

        dirs.forEach(dir => {
          sources[dir].forEach(source => {
            list.push(`${dir}${dir.endsWith(`/`) ? `` : `/`}${source}`);
          });
        });

        list.push(`Clear list`);

        const quickPick = vscode.window.createQuickPick();
        quickPick.items = list.map(item => ({ label: item }));
        quickPick.placeholder = `Enter file path (Format: LIB/SPF/NAME.ext or /home/xx/file.txt)`;

        quickPick.onDidChangeValue(() => {
          // INJECT user values into proposed values
          if (!list.includes(quickPick.value.toUpperCase())) quickPick.items = [quickPick.value.toUpperCase(), ...list].map(label => ({ label }));
        })

        quickPick.onDidAccept(() => {
          const selection = quickPick.selectedItems[0].label;
          if (selection) {
            if (selection === `Clear list`) {
              storage.setSourceList({});
              vscode.window.showInformationMessage(`Cleared list.`);
            } else {
              vscode.commands.executeCommand(`code-for-ibmi.openEditable`, selection, 0, { readonly });
            }
          }
          quickPick.hide()
        })
        quickPick.onDidHide(() => quickPick.dispose());
        quickPick.show();
      })

      // ********* Color provider */
      if (GlobalConfiguration.get<boolean>(`showSeuColors`)) {
        SEUColorProvider.intitialize(context);
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

            CompileTools.runAction(instance, uri);

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
                      config.autoSaveBeforeAction = true;
                      await ConnectionConfiguration.update(config);
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
                    CompileTools.runAction(instance, uri);
                    break;
                }
              }
            }
          }
        }),

        vscode.commands.registerCommand(`code-for-ibmi.openErrors`, async () => {
          interface ObjectDetail {
            asp?: string;
            lib: string;
            object: string;
            ext?: string;
          }

          const detail: ObjectDetail = {
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
              const [library, object] = selection.split(`/`);
              if (library && object) {
                detail.lib = library;
                detail.object = object;
                CompileTools.refreshDiagnostics(instance, { library, object });
              } else {
                vscode.window.showErrorMessage(`Format incorrect. Use LIB/OBJECT`);
              }
            }
          })
        }),

        vscode.commands.registerCommand(`code-for-ibmi.launchTerminalPicker`, () => {
          Terminal.selectAndOpen(instance);
        }),

        vscode.commands.registerCommand(`code-for-ibmi.runCommand`, (detail: RemoteCommand) => {
          if (detail && detail.command) {
            return CompileTools.runCommand(instance, detail);
          }
        }),
        vscode.commands.registerCommand(`code-for-ibmi.runQuery`, (statement?: string) => {
          const content = instance.getContent();
          if (statement && content) {
            return content.runSQL(statement);
          } else {
            return null;
          }
        }),
        vscode.commands.registerCommand(`code-for-ibmi.secret`, async (key: string, newValue: string) => {
          const connectionKey = `${connection.currentConnectionName}_${key}`;
          if (newValue) {
            await context.secrets.store(connectionKey, newValue);
            return newValue;
          }

          const value = context.secrets.get(connectionKey);
          return value;
        }),      
        vscode.commands.registerCommand(`code-for-ibmi.launchUI`, <T>(title: string, fields: any[], callback: (page: Page<T>) => void) => {
          if (title && fields && callback) {
            const ui = new CustomUI();
            fields.forEach(field => {
              const uiField = new Field(field.type, field.id, field.label);
              ui.addField(Object.assign(uiField, field));
            });
            ui.loadPage(title, callback);
          }
        })
      );

      // Enable the profile view if profiles exist.
      vscode.commands.executeCommand(`setContext`, `code-for-ibmi:hasProfiles`, config.connectionProfiles.length > 0);
      Deployment.initialize(context, instance);

      initialisedBefore = true;
    }

    await GlobalStorage.get().setLastConnection(connection.currentConnectionName);
  }

  instance.emitter?.fire(`connected`);
}

/**
 * Register event
 */
export function on(event: string, func: Function) {
  instance.events.push({
    event,
    func
  });
}