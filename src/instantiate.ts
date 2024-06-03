import { Tools } from './api/Tools';

import path, { dirname } from 'path';
import * as vscode from "vscode";
import { CompileTools } from './api/CompileTools';
import { ConnectionConfiguration, ConnectionManager, DefaultOpenMode, GlobalConfiguration, onCodeForIBMiConfigurationChange } from "./api/Configuration";
import Instance from "./api/Instance";
import { Search } from "./api/Search";
import { Terminal } from './api/Terminal';
import { getDebugServiceDetails } from './api/debug/config';
import { debugPTFInstalled, isDebugEngineRunning } from './api/debug/server';
import { refreshDiagnosticsFromServer } from './api/errors/diagnostics';
import { setupGitEventHandler } from './api/local/git';
import { GetMemberInfo } from './components/getMemberInfo';
import { QSysFS, getUriFromPath, parseFSOptions } from "./filesystems/qsys/QSysFs";
import { SEUColorProvider } from "./languages/general/SEUColorProvider";
import { Action, BrowserItem, DeploymentMethod, MemberItem, OpenEditableOptions, WithPath } from "./typings";
import { SearchView } from "./views/searchView";
import { ActionsUI } from './webviews/actions';
import { VariablesUI } from "./webviews/variables";
import { t } from './locale';

export let instance: Instance;

const passwordAttempts: { [extensionId: string]: number } = {}

const CLEAR_RECENT = `$(trash) Clear recently opened`;
const CLEAR_CACHED = `$(trash) Clear cached`;

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
    vscode.commands.registerCommand(`code-for-ibmi.openEditable`, async (path: string, options?: OpenEditableOptions) => {
      console.log(path);
      options = options || {};
      options.readonly = options.readonly || instance.getContent()?.isProtectedPath(path);
      if (!options.readonly) {
        if (path.startsWith('/')) {
          options.readonly = !await instance.getContent()?.testStreamFile(path, "w");
        }
        else {
          const qsysObject = Tools.parseQSysPath(path);
          const writable = await instance.getContent()?.checkObject({ library: qsysObject.library, name: qsysObject.name, type: '*FILE' }, ["*UPD"]);
          if (!writable) {
            options.readonly = true;
          }
        }
      }

      const uri = getUriFromPath(path, options);

      const existingUri = Tools.findExistingDocumentUri(uri);

      if (existingUri) {
        const existingOptions = parseFSOptions(existingUri);
        if (existingOptions.readonly !== options.readonly) {
          vscode.window.showWarningMessage(`The file is already opened in another mode.`);
          vscode.window.showTextDocument(existingUri);
          return false;
        }
      }

      try {
        await vscode.commands.executeCommand(`vscode.openWith`, uri, 'default', { selection: options.position } as vscode.TextDocumentShowOptions);

        // Add file to front of recently opened files list.
        const recentLimit = GlobalConfiguration.get<number>(`recentlyOpenedFilesLimit`);
        const storage = instance.getStorage();
        if (recentLimit) {
          const recent = storage!.getRecentlyOpenedFiles();
          storage!.setRecentlyOpenedFiles([path, ...recent.filter((file) => file !== path).slice(0, recentLimit - 1)]);
        } else {
          storage!.clearRecentlyOpenedFiles();
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
      const LOADING_LABEL = `Please wait`;
      const storage = instance.getStorage();
      const content = instance.getContent();
      const connection = instance.getConnection();
      let starRemoved: boolean = false;

      if (!storage && !content && !connection) return;
      let list: string[] = [];

      // Get recently opened files - cut if limit has been reduced.
      const recentLimit = GlobalConfiguration.get(`recentlyOpenedFilesLimit`) as number;
      const recent = storage!.getRecentlyOpenedFiles();
      if (recent.length > recentLimit) {
        recent.splice(recentLimit);
        storage!.setRecentlyOpenedFiles(recent);
      }

      const sources = storage!.getSourceList();
      const dirs = Object.keys(sources);

      let schemaItems: vscode.QuickPickItem[] = [];

      dirs.forEach(dir => {
        sources[dir].forEach(source => {
          list.push(`${dir}${dir.endsWith(`/`) ? `` : `/`}${source}`);
        });
      });

      const recentItems: vscode.QuickPickItem[] = recent.map(item => ({ label: item }));
      const listItems: vscode.QuickPickItem[] = list.map(item => ({ label: item }));

      const quickPick = vscode.window.createQuickPick();
      quickPick.items = await createQuickPickItemsList(
        ``,
        [],
        `Recent`,
        recentItems,
        `Cached`,
        listItems
      );
      quickPick.canSelectMany = false;
      (quickPick as any).sortByLabel = false; // https://github.com/microsoft/vscode/issues/73904#issuecomment-680298036
      quickPick.placeholder = `Enter file path (format: LIB/SPF/NAME.ext (type '*' to search server) or /home/xx/file.txt)`;

      quickPick.show();

      // Create a cache for Schema if autosuggest enabled
      if (schemaItems.length === 0 && connection?.enableSQL) {
        content!.runSQL(`
          select cast( SYSTEM_SCHEMA_NAME as char( 10 ) for bit data ) as SYSTEM_SCHEMA_NAME
               , ifnull( cast( SCHEMA_TEXT as char( 50 ) for bit data ), '' ) as SCHEMA_TEXT
            from QSYS2.SYSSCHEMAS
           order by 1`
        ).then(resultSetLibrary => {
          schemaItems = resultSetLibrary.map(row => ({
            label: String(row.SYSTEM_SCHEMA_NAME),
            description: String(row.SCHEMA_TEXT)
          }))
        });
      }

      let filteredItems: vscode.QuickPickItem[] = [];

      quickPick.onDidChangeValue(async () => {
        if (quickPick.value === ``) {
          quickPick.items = await createQuickPickItemsList(
            ``,
            [],
            `Recent`,
            recentItems,
            `Cached`,
            listItems
          );
          filteredItems = [];
        } else {
          if (!starRemoved && !list.includes(connection!.upperCaseName(quickPick.value))) {
            quickPick.items = [connection!.upperCaseName(quickPick.value), ...list].map(label => ({ label }));
          }
        }

        // autosuggest
        if (connection && connection.enableSQL && (!quickPick.value.startsWith(`/`)) && quickPick.value.endsWith(`*`)) {
          const selectionSplit = connection!.upperCaseName(quickPick.value).split('/');
          const lastPart = selectionSplit[selectionSplit.length - 1];
          let filterText = lastPart.substring(0, lastPart.indexOf(`*`));

          let resultSet: Tools.DB2Row[] = [];

          switch (selectionSplit.length) {
            case 1:
              filteredItems = schemaItems.filter(schema => schema.label.startsWith(filterText));

              // Using `kind` didn't make any difference because it's sorted alphabetically on label
              quickPick.items = await createQuickPickItemsList(
                `Libraries`,
                filteredItems,
                `Recent`,
                recentItems,
                `Cached`,
                listItems
              );

              break;

            case 2:
              // Create cache
              quickPick.busy = true;
              quickPick.items = [
                {
                  label: LOADING_LABEL,
                  alwaysShow: true,
                  description: 'Searching files..',
                },
              ]

              resultSet = await content!.runSQL(`
                select ifnull( cast( SYSTEM_TABLE_NAME as char( 10 ) for bit data ), '' ) as SYSTEM_TABLE_NAME
                     , ifnull( TABLE_TEXT, '' ) as TABLE_TEXT
                  from QSYS2.SYSTABLES
                 where SYSTEM_TABLE_SCHEMA = '${connection!.sysNameInAmerican(selectionSplit[0])}'
                       and FILE_TYPE = 'S'
                  ${filterText ? `and SYSTEM_TABLE_NAME like '${filterText}%'` : ``}
                 order by 1
              `);

              const listFile: vscode.QuickPickItem[] = resultSet.map(row => ({
                label: selectionSplit[0] + '/' + String(row.SYSTEM_TABLE_NAME),
                description: String(row.TABLE_TEXT)
              }))

              filteredItems = listFile.filter(file => file.label.startsWith(selectionSplit[0] + '/' + filterText));

              quickPick.items = await createQuickPickItemsList(
                `Source files`,
                filteredItems,
                `Recent`,
                recentItems,
                `Cached`,
                listItems
              );
              quickPick.busy = false;

              break;

            case 3:
              // Create cache
              quickPick.busy = true;
              quickPick.items = [
                {
                  label: LOADING_LABEL,
                  alwaysShow: true,
                  description: 'Searching members..',
                },
              ]

              filterText = filterText.endsWith(`.`) ? filterText.substring(0, filterText.length - 1) : filterText;

              resultSet = await content!.runSQL(`
                select cast( SYSTEM_TABLE_MEMBER as char( 10 ) for bit data ) as SYSTEM_TABLE_MEMBER
                     , ifnull( PARTITION_TEXT, '' ) as PARTITION_TEXT
                     , ifnull( SOURCE_TYPE, '' ) as SOURCE_TYPE
                  from QSYS2.SYSPARTITIONSTAT
                 where SYSTEM_TABLE_SCHEMA = '${connection!.sysNameInAmerican(selectionSplit[0])}'
                       and SYSTEM_TABLE_NAME = '${connection!.sysNameInAmerican(selectionSplit[1])}'
                  ${filterText ? `and SYSTEM_TABLE_MEMBER like '${connection!.sysNameInAmerican(filterText)}%'` : ``}
                 order by 1
              `);

              const listMember = resultSet.map(row => ({
                label: selectionSplit[0] + '/' + selectionSplit[1] + '/' + String(row.SYSTEM_TABLE_MEMBER) + '.' + String(row.SOURCE_TYPE),
                description: String(row.PARTITION_TEXT)
              }))

              filteredItems = listMember.filter(member => member.label.startsWith(selectionSplit[0] + '/' + selectionSplit[1] + '/' + filterText));

              quickPick.items = await createQuickPickItemsList(
                `Members`,
                filteredItems,
                `Recent`,
                recentItems,
                `Cached`,
                listItems
              );
              quickPick.busy = false;

              break;

            default:
              break;
          }

          // We remove the asterisk from the value so that the user can continue typing
          quickPick.value = quickPick.value.substring(0, quickPick.value.indexOf(`*`));
          starRemoved = true;

        } else {

          if (filteredItems.length > 0 && !starRemoved) {
            quickPick.items = await createQuickPickItemsList(
              `Filter`,
              filteredItems,
              `Recent`,
              recentItems,
              `Cached`,
              listItems
            );
          }
        }
        starRemoved = false;
      })

      quickPick.onDidAccept(async () => {
        let selection = quickPick.selectedItems.length === 1 ? quickPick.selectedItems[0].label : undefined;
        if (selection && selection !== LOADING_LABEL) {
          if (selection === CLEAR_RECENT) {
            recentItems.length = 0;
            storage!.clearRecentlyOpenedFiles();
            quickPick.items = await createQuickPickItemsList(
              `Filter`,
              filteredItems,
              ``,
              [],
              `Cached`,
              listItems
            );
            vscode.window.showInformationMessage(`Cleared previously opened files.`);
          } else if (selection === CLEAR_CACHED) {
            listItems.length = 0;
            storage!.setSourceList({});
            quickPick.items = await createQuickPickItemsList(
              `Filter`,
              filteredItems,
              `Recent`,
              recentItems,
            );
            vscode.window.showInformationMessage(`Cleared cached files.`);
          } else {
            const selectionSplit = connection!.upperCaseName(selection).split('/')
            if (selectionSplit.length === 3 || selection.startsWith(`/`)) {

              const infoComponent = connection?.getComponent<GetMemberInfo>(`GetMemberInfo`);

              // When selection is QSYS path
              if (!selection.startsWith(`/`) && infoComponent) {
                const lib = selectionSplit[0];
                const file = selectionSplit[1];
                const member = path.parse(selectionSplit[2]);
                member.ext = member.ext.substring(1);
                const memberInfo = await infoComponent.getMemberInfo(lib, file, member.name);
                if (!memberInfo) {
                  vscode.window.showWarningMessage(`Source member ${lib}/${file}/${member.base} does not exist.`);
                  return;
                } else if (memberInfo.name !== member.name || (member.ext && memberInfo.extension !== member.ext)) {
                  vscode.window.showWarningMessage(`Member ${lib}/${file}/${member.name} of type ${member.ext} does not exist.`);
                  return;
                }

                member.base = `${member.name}.${member.ext || memberInfo.extension}`;
                selection = `${lib}/${file}/${member.base}`;
              };

              // When select is IFS path
              if (selection.startsWith(`/`)) {
                const streamFile = await content!.streamfileResolve([selection.substring(1)], [`/`]);
                if (!streamFile) {
                  vscode.window.showWarningMessage(`${selection} does not exist or is not a file.`);
                  return;
                }
                selection = connection!.upperCaseName(selection) === connection!.upperCaseName(quickPick.value) ? quickPick.value : selection;
              }
              vscode.commands.executeCommand(`code-for-ibmi.openEditable`, selection, { readonly });
              quickPick.hide();
            } else {
              quickPick.value = connection!.upperCaseName(selection) + '/'
            }
          }
        }
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

    vscode.commands.registerCommand(`code-for-ibmi.getPassword`, async (extensionId: string, reason?: string) => {
      if (extensionId) {
        const extension = vscode.extensions.getExtension(extensionId);
        const isValid = (extension && extension.isActive);
        if (isValid) {
          const connection = instance.getConnection();
          const storage = instance.getStorage();
          if (connection && storage) {
            const displayName = extension.packageJSON.displayName || extensionId;

            // Some logic to stop spam from extensions.
            passwordAttempts[extensionId] = passwordAttempts[extensionId] || 0;
            if (passwordAttempts[extensionId] > 1) {
              throw new Error(`Password request denied for extension ${displayName}.`);
            }

            const storedPassword = await ConnectionManager.getStoredPassword(context, instance.getConnection()!.currentConnectionName);

            if (storedPassword) {
              let isAuthed = storage.getExtensionAuthorisation(extension) !== undefined;

              if (!isAuthed) {
                const detail = `The ${displayName} extension is requesting access to your password for this connection. ${reason ? `\n\nReason: ${reason}` : `The extension did not provide a reason for password access.`}`;
                let done = false;
                let modal = true;

                while (!done) {
                  const options: string[] = [`Allow`];

                  if (modal) {
                    options.push(`View on Marketplace`);
                  } else {
                    options.push(`Deny`);
                  }

                  const result = await vscode.window.showWarningMessage(
                    modal ? `Password Request` : detail,
                    {
                      modal,
                      detail,
                    },
                    ...options
                  );

                  switch (result) {
                    case `Allow`:
                      await storage.grantExtensionAuthorisation(extension);
                      isAuthed = true;
                      done = true;
                      break;

                    case `View on Marketplace`:
                      vscode.commands.executeCommand('extension.open', extensionId);
                      modal = false;
                      break;

                    default:
                      done = true;
                      break;
                  }
                }
              }

              if (isAuthed) {
                return storedPassword;
              } else {
                passwordAttempts[extensionId]++;
              }
            }

          } else {
            throw new Error(`Not connected to an IBM i.`);
          }
        }
      }
    }),

    vscode.commands.registerCommand("code-for-ibmi.browse", (item: WithPath | MemberItem) => {
      return vscode.commands.executeCommand("code-for-ibmi.openWithDefaultMode", item, "browse" as DefaultOpenMode);
    }),

    vscode.commands.registerCommand("code-for-ibmi.edit", (item: WithPath | MemberItem) => {
      return vscode.commands.executeCommand("code-for-ibmi.openWithDefaultMode", item, "edit" as DefaultOpenMode);
    }),

    vscode.commands.registerCommand("code-for-ibmi.openWithDefaultMode", (item: WithPath, overrideMode?: DefaultOpenMode) => {
      const readonly = (overrideMode || GlobalConfiguration.get<DefaultOpenMode>("defaultOpenMode")) === "browse";
      vscode.commands.executeCommand(`code-for-ibmi.openEditable`, item.path, { readonly });
    }),
    vscode.commands.registerCommand("code-for-ibmi.updateConnectedBar", updateConnectedBar),
    
    vscode.commands.registerCommand("code-for-ibmi.refreshFile", async (uri?: vscode.Uri) => {
      let doc: vscode.TextDocument | undefined;
      if (uri) {
        doc = Tools.findExistingDocument(uri);
      } else {
        const editor = vscode.window.activeTextEditor;
        doc = editor?.document;
      }

      if (doc?.isDirty) {
        vscode.window
          .showWarningMessage(
            t(`discard.changes`), 
            { modal: true }, 
            t(`Continue`))
          .then(result => {
              if (result === t(`Continue`)) {
                vscode.commands.executeCommand(`workbench.action.files.revert`);
              }
        });
      } else {
        vscode.commands.executeCommand(`workbench.action.files.revert`);
      }
    }),
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

  // Register git events based on workspace folders
  if (vscode.workspace.workspaceFolders) {
    setupGitEventHandler(context);
  }
}

async function updateConnectedBar() {
  const config = instance.getConfig();
  if (config) {
    connectedBarItem.text = `$(${config.readOnlyMode ? "lock" : "settings-gear"}) ${config.name}`;
  }

  const debugRunning = await isDebugEngineRunning();
  connectedBarItem.tooltip = new vscode.MarkdownString([
    `[$(settings-gear) Settings](command:code-for-ibmi.showAdditionalSettings)`,
    `[$(file-binary) Actions](command:code-for-ibmi.showActionsMaintenance)`,
    `[$(terminal) Terminals](command:code-for-ibmi.launchTerminalPicker)`,
    debugPTFInstalled() ?
      `[$(${debugRunning ? "bug" : "debug"}) Debugger ${((await getDebugServiceDetails()).version)} (${debugRunning ? "on" : "off"})](command:ibmiDebugBrowser.focus)`
      :
      `[$(debug) No debug PTF](https://codefori.github.io/docs/developing/debug/#required-ptfs)`
  ].join(`\n\n---\n\n`), true);
  connectedBarItem.tooltip.isTrusted = true;
}

async function onConnected(context: vscode.ExtensionContext) {
  const config = instance.getConfig();

  [
    connectedBarItem,
    disconnectBarItem,
  ].forEach(barItem => barItem.show());

  updateConnectedBar();

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

async function createQuickPickItemsList(
  labelFiltered: string = ``, filtered: vscode.QuickPickItem[] = [],
  labelRecent: string = ``, recent: vscode.QuickPickItem[] = [],
  labelCached: string = ``, cached: vscode.QuickPickItem[] = [],
) {
  const clearRecentArray = [{ label: ``, kind: vscode.QuickPickItemKind.Separator }, { label: CLEAR_RECENT }];
  const clearCachedArray = [{ label: ``, kind: vscode.QuickPickItemKind.Separator }, { label: CLEAR_CACHED }];

  const returnedList: vscode.QuickPickItem[] = [
    { label: labelFiltered, kind: vscode.QuickPickItemKind.Separator },
    ...filtered,
    { label: labelRecent, kind: vscode.QuickPickItemKind.Separator },
    ...recent,
    ...(recent.length != 0 ? clearRecentArray : []),
    { label: labelCached, kind: vscode.QuickPickItemKind.Separator },
    ...cached,
    ...(cached.length != 0 ? clearCachedArray : [])
  ];
  return returnedList;
}