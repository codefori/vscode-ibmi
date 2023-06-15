
import path from 'path';
import * as vscode from "vscode";
import Instance from "./api/Instance";

import { CompileTools } from './api/CompileTools';

import { Terminal } from './api/Terminal';

import { CustomUI, Field, Page } from './api/CustomUI';

import { SearchView } from "./views/searchView";
import { VariablesUI } from "./webviews/variables";

import { dirname } from 'path';
import { ConnectionConfiguration, GlobalConfiguration } from "./api/Configuration";
import { Search } from "./api/Search";
import { QSysFS, getUriFromPath } from "./filesystems/qsys/QSysFs";
import { init as clApiInit } from "./languages/clle/clApi";
import * as clRunner from "./languages/clle/clRunner";
import { initGetNewLibl } from "./languages/clle/getnewlibl";
import { SEUColorProvider } from "./languages/general/SEUColorProvider";
import { QsysFsOptions, RemoteCommand } from "./typings";
import { SplfFS } from "./filesystems/qsys/SplfFs";

export let instance: Instance;

const disconnectBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 12);
disconnectBarItem.command = {
  command: `code-for-ibmi.disconnect`,
  title: `Disconnect from system`
}

const connectedBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10);
connectedBarItem.command = {
  command: `code-for-ibmi.showAdditionalSettings`,
  title: `Show Additional Connection Settings`,
};
disconnectBarItem.tooltip = `Disconnect from system.`;
disconnectBarItem.text = `$(debug-disconnect)`;

const terminalBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
terminalBarItem.command = {
  command: `code-for-ibmi.launchTerminalPicker`,
  title: `Launch Terminal Picker`
}
terminalBarItem.text = `$(terminal) Terminals`;

const actionsBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
actionsBarItem.command = {
  command: `code-for-ibmi.showActionsMaintenance`,
  title: `Show IBM i Actions`,
};
actionsBarItem.text = `$(file-binary) Actions`;

let selectedForCompare: vscode.Uri;
let searchViewContext: SearchView;

export function setSearchResults(term: string, results: Search.Result[]) {
  searchViewContext.setResults(term, results);
}

export async function disconnect(): Promise<boolean> {
  let doDisconnect = true;

  for (const document of vscode.workspace.textDocuments) {
    // This code will check that sources are saved before closing
    if (!document.isClosed && [`member`, `streamfile`, `object`,`spooledfile`].includes(document.uri.scheme)) {
      if (document.isDirty) {
        if (doDisconnect) {
          if (await vscode.window.showTextDocument(document).then(() => vscode.window.showErrorMessage(`Cannot disconnect while files have not been saved.`, 'Disconnect anyway'))) {
            break;
          }
          else {
            doDisconnect = false;
          }
        }
      }
    }
  }

  if (doDisconnect) {
    const connection = instance.getConnection();
    if (connection) {
      await connection.end();
    }
  }

  return doDisconnect;
}

export async function loadAllofExtension(context: vscode.ExtensionContext) {
  instance = new Instance(context);
  searchViewContext = new SearchView(context);

  context.subscriptions.push(
    connectedBarItem,
    disconnectBarItem,
    terminalBarItem,
    actionsBarItem,
    vscode.commands.registerCommand(`code-for-ibmi.disconnect`, () => {
      if (instance.getConnection()) {
        disconnect();
      } else {
        vscode.window.showErrorMessage(`Not currently connected to any system.`);
      }
    }),
    vscode.workspace.onDidChangeConfiguration(async event => {
      if (event.affectsConfiguration(`code-for-ibmi.connectionSettings`)) {
        updateConnectedBar();
      }
    }),
    vscode.window.registerTreeDataProvider(
      `searchView`,
      searchViewContext
    ),
    vscode.commands.registerCommand(`code-for-ibmi.openEditable`, async (path: string, line?: number, options?: QsysFsOptions) => {
      console.log(path);
      if(!options?.readonly && !path.startsWith('/')){
        const [library, name] = path.split('/');
        const writable = await instance.getContent()?.checkObject({library, name, type: '*FILE'}, "*UPD");
        if(!writable){
          options = options || {};
          options.readonly = true;
        }
      }
      else if (path.toLocaleUpperCase().endsWith('.SPLF')) {
        options = options || {};
        options.readonly = true;
      }
      const uri = getUriFromPath(path, options);
      console.log(uri);
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
    }),
    vscode.commands.registerCommand(`code-for-ibmi.goToFileReadOnly`, async () => vscode.commands.executeCommand(`code-for-ibmi.goToFile`, true)),
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
    }),
    vscode.commands.registerCommand(`code-for-ibmi.clearDiagnostics`, async () => {
      CompileTools.clearDiagnostics();
    }),
    vscode.commands.registerCommand(`code-for-ibmi.runAction`, async (node) => {
      if (node) {
        const uri = node.resourceUri || node;

        CompileTools.runAction(instance, uri);

      } else {
        const editor = vscode.window.activeTextEditor;
        let willRun = false;

        if (editor) {
          const config = instance.getConfig()!;
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

    vscode.commands.registerCommand(`code-for-ibmi.openErrors`, async (qualifiedObject?: string) => {
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

      let inputPath: string | undefined

      if (qualifiedObject) {
        // Value passed in via parameter
        inputPath = qualifiedObject;

      } else {
        // Value collected from user input

        let initialPath = ``;
        const editor = vscode.window.activeTextEditor;

        if (editor) {
          const config = instance.getConfig()!;
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

            const pathDetail = path.parse(editor.document.uri.path);
            detail.object = pathDetail.name;
            detail.ext = pathDetail.ext.substring(1);

            initialPath = `${detail.lib}/${pathDetail.base}`;
          }
        }

        inputPath = await vscode.window.showInputBox({
          prompt: `Enter object path (LIB/OBJECT)`,
          value: initialPath
        });
      }

      if (inputPath) {
        const [library, object] = inputPath.split(`/`);
        if (library && object) {
          const nameDetail = path.parse(object);
          CompileTools.refreshDiagnostics(instance, { library, object: nameDetail.name, extension: (nameDetail.ext.length > 1 ? nameDetail.ext.substring(1) : undefined) });
        }
      }
    }),

    vscode.commands.registerCommand(`code-for-ibmi.launchTerminalPicker`, () => {
      return Terminal.selectAndOpen(instance);
    }),

    vscode.commands.registerCommand(`code-for-ibmi.openTerminalHere`, async (ifsNode) => {
      const content = instance.getContent();
      if (content) {
        const path = (await content.isDirectory(ifsNode.path)) ? ifsNode.path : dirname(ifsNode.path);
        const terminal = await Terminal.selectAndOpen(instance, Terminal.TerminalType.PASE);
        terminal?.sendText(`cd ${path}`);        
      }
    }),

    vscode.commands.registerCommand(`code-for-ibmi.secret`, async (key: string, newValue: string) => {
      const connectionKey = `${instance.getConnection()!.currentConnectionName}_${key}`;
      if (newValue) {
        await context.secrets.store(connectionKey, newValue);
        return newValue;
      }

      const value = context.secrets.get(connectionKey);
      return value;
    }),

    // The follow commands are deprecated and to be removed for 1.9.0
    vscode.commands.registerCommand(`code-for-ibmi.runCommand`, (detail: RemoteCommand) => {
      console.log(`Command 'code-for-ibmi.runCommand' has been deprecated. There is no guarantee it will be available after 1.8.0. Use 'instance.getConnection().runCommand' in the export API.`);
      if (detail && detail.command) {
        return CompileTools.runCommand(instance, detail);
      }
    }),

    vscode.commands.registerCommand(`code-for-ibmi.runQuery`, (statement?: string) => {
      console.log(`Command 'code-for-ibmi.runQuery' has been deprecated. There is no guarantee it will be available after 1.8.0. Use 'instance.getContent().runSQL' in the export API.`);
      const content = instance.getContent();
      if (statement && content) {
        return content.runSQL(statement);
      } else {
        return null;
      }
    }),

    vscode.commands.registerCommand(`code-for-ibmi.launchUI`, <T>(title: string, fields: any[], callback: (page: Page<T>) => void) => {
      console.log(`Command 'code-for-ibmi.launchUI' has been deprecated. There is no guarantee it will be available after 1.8.0. Use 'exports.customUI' in the export API.`);
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

  (require(`./webviews/actions`)).init(context);
  VariablesUI.init(context);

  instance.onEvent("connected", () => onConnected(context));
  instance.onEvent("disconnected", onDisconnected);

  let fsp = vscode.workspace.registerFileSystemProvider(`member`, new QSysFS(context), {
    isCaseSensitive: false
  })
  context.subscriptions.push(fsp
  );
  
  fsp = vscode.workspace.registerFileSystemProvider(`spooledfile`, new SplfFS(context), {
    isCaseSensitive: false
  })
  const dd = context.subscriptions.push(fsp 
  );
  
  // Color provider
  if (GlobalConfiguration.get<boolean>(`showSeuColors`)) {
    SEUColorProvider.intitialize(context);
  }

  clRunner.initialise(context);
}

function updateConnectedBar() {
  const config = instance.getConfig();
  if (config) {
    connectedBarItem.text = `$(${config.readOnlyMode ? "lock" : "settings-gear"}) Settings: ${config.name}`;
  }
}

async function onConnected(context: vscode.ExtensionContext) {
  const config = instance.getConfig();

  [
    connectedBarItem,
    disconnectBarItem,
    terminalBarItem,
    actionsBarItem
  ].forEach(barItem => barItem.show());

  updateConnectedBar();

  // CL content assist
  const clExtension = vscode.extensions.getExtension(`IBM.vscode-clle`);
  if (clExtension) {
    clApiInit();
  }

  initGetNewLibl(instance);

  // Enable the profile view if profiles exist.
  vscode.commands.executeCommand(`setContext`, `code-for-ibmi:hasProfiles`, (config?.connectionProfiles || []).length > 0);
}

async function onDisconnected() {
  // Close the tabs with no dirty editors
  vscode.window.tabGroups.all
    .filter(group => !group.tabs.some(tab => tab.isDirty))
    .forEach(group => {
      group.tabs.forEach(tab => {
        if (tab.input instanceof vscode.TabInputText) {
          const uri = tab.input.uri;
          if ([`member`, `streamfile`, `object`, `spooledfile`].includes(uri.scheme)) {
            vscode.window.tabGroups.close(tab);
          }
        }
      })
    });

  // Hide the bar items
  [
    disconnectBarItem,
    connectedBarItem,
    terminalBarItem,
    actionsBarItem,
  ].forEach(barItem => barItem.hide())
}