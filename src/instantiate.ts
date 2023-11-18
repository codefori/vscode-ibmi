
import path, { dirname } from 'path';
import * as vscode from "vscode";
import { CompileTools } from './api/CompileTools';
import { ConnectionConfiguration, GlobalConfiguration, onCodeForIBMiConfigurationChange } from "./api/Configuration";
import Instance from "./api/Instance";
import { Search } from "./api/Search";
import { Terminal } from './api/Terminal';
import { refreshDiagnosticsFromServer } from './api/errors/diagnostics';
import { QSysFS, getMemberUri, getUriFromPath } from "./filesystems/qsys/QSysFs";
import { init as clApiInit } from "./languages/clle/clApi";
import * as clRunner from "./languages/clle/clRunner";
import { initGetNewLibl } from "./languages/clle/getnewlibl";
import { SEUColorProvider } from "./languages/general/SEUColorProvider";
import { Action, BrowserItem, DeploymentMethod, QsysFsOptions } from "./typings";
import { SearchView } from "./views/searchView";
import { ActionsUI } from './webviews/actions';
import { VariablesUI } from "./webviews/variables";

export let instance: Instance;

const disconnectBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 12);
disconnectBarItem.command = {
  command: `code-for-ibmi.disconnect`,
  title: `Disconnect from system`
}
disconnectBarItem.tooltip = `Disconnect from system.`;
disconnectBarItem.text = `$(debug-disconnect)`;

const connectedBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10);
connectedBarItem.command = {
  command: `code-for-ibmi.showAdditionalSettings`,
  title: `Show connection settings`
};
connectedBarItem.tooltip = new vscode.MarkdownString([
  `[$(settings-gear) Settings](command:code-for-ibmi.showAdditionalSettings)`,
  `[$(file-binary) Actions](command:code-for-ibmi.showActionsMaintenance)`,
  `[$(terminal) Terminals](command:code-for-ibmi.launchTerminalPicker)`
].join(`\n\n---\n\n`), true);
connectedBarItem.tooltip.isTrusted = true;

let selectedForCompare: vscode.Uri;
let searchViewContext: SearchView;

export function setSearchResults(term: string, results: Search.Result[]) {
  searchViewContext.setResults(term, results);
}

export async function disconnect(): Promise<boolean> {
  let doDisconnect = true;

  for (const document of vscode.workspace.textDocuments) {
    // This code will check that sources are saved before closing
    if (!document.isClosed && [`member`, `streamfile`, `object`].includes(document.uri.scheme)) {
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
  // No connection when the extension is first activated
  vscode.commands.executeCommand(`setContext`, `code-for-ibmi:connected`, false);

  instance = new Instance(context);
  searchViewContext = new SearchView(context);

  context.subscriptions.push(
    connectedBarItem,
    disconnectBarItem,
    vscode.commands.registerCommand(`code-for-ibmi.disconnect`, async (silent?: boolean) => {
      if (instance.getConnection()) {
        await disconnect();
      } else if (!silent) {
        vscode.window.showErrorMessage(`Not currently connected to any system.`);
      }
    }),
    onCodeForIBMiConfigurationChange("connectionSettings", updateConnectedBar),
    vscode.window.registerTreeDataProvider(
      `searchView`,
      searchViewContext
    ),
    vscode.commands.registerCommand(`code-for-ibmi.openEditable`, async (path: string, line?: number, options?: QsysFsOptions) => {
      console.log(path);
      if (!options?.readonly && !path.startsWith('/')) {
        const [library, name] = path.split('/');
        const writable = await instance.getContent()?.checkObject({ library, name, type: '*FILE' }, "*UPD");
        if (!writable) {
          options = options || {};
          options.readonly = true;
        }
      }
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
          const value = (activeEditor ? activeEditor.document.uri : selectedForCompare)
            .with({ query: '' })
            .toString();
          const compareWith = await vscode.window.showInputBox({
            prompt: `Enter the path to compare selected with`,
            value,
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
    vscode.commands.registerCommand(`code-for-ibmi.runAction`, async (target: vscode.TreeItem | BrowserItem | vscode.Uri, group?: any, action?: Action, method?: DeploymentMethod) => {
      const editor = vscode.window.activeTextEditor;
      let uri;
      let browserItem;
      if (target) {
        if ("fsPath" in target) {
          uri = target;
        }
        else {
          uri = target?.resourceUri;
          if ("refresh" in target) {
            browserItem = target;
          }
        }
      }

      uri = uri || editor?.document.uri;

      if (uri) {
        const config = instance.getConfig();
        if (config) {
          let canRun = true;
          if (editor && uri.path === editor.document.uri.path && editor.document.isDirty) {
            if (config.autoSaveBeforeAction) {
              await editor.document.save();
            } else {
              const result = await vscode.window.showWarningMessage(`The file must be saved to run Actions.`, `Save`, `Save automatically`, `Cancel`);
              switch (result) {
                case `Save`:
                  await editor.document.save();
                  canRun = true;
                  break;
                case `Save automatically`:
                  config.autoSaveBeforeAction = true;
                  await ConnectionConfiguration.update(config);
                  await editor.document.save();
                  canRun = true;
                  break;
                default:
                  canRun = false;
                  break;
              }
            }
          }

          if (canRun && [`member`, `streamfile`, `file`, 'object'].includes(uri.scheme)) {
            return await CompileTools.runAction(instance, uri, action, method, browserItem);
          }
        }
        else {
          vscode.window.showErrorMessage('Please connect to an IBM i first');
        }
      }

      return false;
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
          refreshDiagnosticsFromServer(instance, { library, object: nameDetail.name, extension: (nameDetail.ext.length > 1 ? nameDetail.ext.substring(1) : undefined) });
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

    vscode.commands.registerCommand("code-for-ibmi.browse", (node: any) => { //any for now, typed later after TS conversion of browsers
      let uri;
      if (node?.member) {
        uri = getMemberUri(node?.member, { readonly: true });
      }
      else if (node?.path) {
        uri = getUriFromPath(node?.path, { readonly: true });
      }

      if (uri) {
        return vscode.commands.executeCommand(`vscode.open`, uri);
      }
    })
  );

  ActionsUI.initialize(context);
  VariablesUI.initialize(context);

  instance.onEvent("connected", () => onConnected(context));
  instance.onEvent("disconnected", onDisconnected);

  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider(`member`, new QSysFS(context), {
      isCaseSensitive: false
    })
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
    connectedBarItem.text = `$(${config.readOnlyMode ? "lock" : "settings-gear"}) ${config.name}`;
  }
}

async function onConnected(context: vscode.ExtensionContext) {
  const config = instance.getConfig();

  [
    connectedBarItem,
    disconnectBarItem,
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
          if ([`member`, `streamfile`, `object`].includes(uri.scheme)) {
            vscode.window.tabGroups.close(tab);
          }
        }
      })
    });

  // Hide the bar items
  [
    disconnectBarItem,
    connectedBarItem,
  ].forEach(barItem => barItem.hide())
}