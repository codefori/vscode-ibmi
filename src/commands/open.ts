import path from "path";
import { commands, Disposable, l10n, QuickInputButton, QuickPickItem, QuickPickItemButtonEvent, QuickPickItemKind, Range, TextDocument, TextDocumentShowOptions, ThemeIcon, Uri, window } from "vscode";
import Instance from "../Instance";
import IBMi from "../api/IBMi";
import { Tools } from "../api/Tools";
import { getUriFromPath, parseFSOptions } from "../filesystems/qsys/QSysFs";
import { DefaultOpenMode, MemberItem, QsysFsOptions, WithPath } from "../typings";
import { VscodeTools } from "../ui/Tools";

const CLEAR_RECENT = `$(trash) Clear recently opened`;
const CLEAR_CACHED = `$(trash) Clear cached`;

export type OpenEditableOptions = QsysFsOptions & { position?: Range };

export function registerOpenCommands(instance: Instance): Disposable[] {

  return [
    commands.registerCommand(`code-for-ibmi.openEditable`, async (path: string, options?: OpenEditableOptions) => {
      const connection = instance.getConnection()!;
      console.log(path);
      options = options || {};
      options.readonly = options.readonly || connection.getContent().isProtectedPath(path);
      if (!options.readonly) {
        if (path.startsWith('/')) {
          options.readonly = !await connection.getContent().testStreamFile(path, "w");
        }
        else {
          const qsysObject = Tools.parseQSysPath(path);
          const writable = await connection.getContent().checkObject({ library: qsysObject.library, name: qsysObject.name, type: '*FILE' }, ["*UPD"]);
          if (!writable) {
            options.readonly = true;
          }
        }
      }

      const uri = getUriFromPath(path, options);

      const existingUri = VscodeTools.findExistingDocumentUri(uri);

      if (existingUri) {
        const existingOptions = parseFSOptions(existingUri);
        if (existingOptions.readonly !== options.readonly) {
          window.showWarningMessage(`The file is already opened in another mode.`);
          window.showTextDocument(existingUri);
          return false;
        }
      }

      try {
        if(options.position){
          await commands.executeCommand(`vscode.openWith`, uri, 'default', { selection: options.position } as TextDocumentShowOptions);
        }
        else{
          await commands.executeCommand(`vscode.open`, uri);
        }

        // Add file to front of recently opened files list.
        const recentLimit = IBMi.connectionManager.get<number>(`recentlyOpenedFilesLimit`);
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

    commands.registerCommand("code-for-ibmi.browse", (item: WithPath | MemberItem) => {
      return commands.executeCommand("code-for-ibmi.openWithDefaultMode", item, "browse" as DefaultOpenMode);
    }),

    commands.registerCommand("code-for-ibmi.edit", (item: WithPath | MemberItem) => {
      return commands.executeCommand("code-for-ibmi.openWithDefaultMode", item, "edit" as DefaultOpenMode);
    }),

    commands.registerCommand("code-for-ibmi.openWithDefaultMode", (item: WithPath, overrideMode?: DefaultOpenMode, position?: Range) => {
      const readonly = (overrideMode || IBMi.connectionManager.get<DefaultOpenMode>("defaultOpenMode")) === "browse";
      commands.executeCommand(`code-for-ibmi.openEditable`, item.path, { readonly, position } as OpenEditableOptions);
    }),


    commands.registerCommand("code-for-ibmi.refreshFile", async (uri?: Uri) => {
      let doc: TextDocument | undefined;
      if (uri) {
        doc = VscodeTools.findExistingDocument(uri);
      } else {
        const editor = window.activeTextEditor;
        doc = editor?.document;
      }

      if (doc?.isDirty) {
        window
          .showWarningMessage(
            l10n.t(`Your changes will be discarded`),
            { modal: true },
            l10n.t(`Continue`))
          .then(result => {
            if (result === l10n.t(`Continue`)) {
              commands.executeCommand(`workbench.action.files.revert`);
            }
          });
      } else {
        commands.executeCommand(`workbench.action.files.revert`);
      }
    }),

    commands.registerCommand(`code-for-ibmi.goToFileReadOnly`, async () => commands.executeCommand(`code-for-ibmi.goToFile`, true)),
    commands.registerCommand(`code-for-ibmi.goToFile`, async (readonly?: boolean) => {
      const compareIcon = new ThemeIcon('split-horizontal');
      const compareButton: QuickInputButton = {
        iconPath: compareIcon,
        tooltip: l10n.t(`Compare with Active File`)
      };

      const LOADING_LABEL = `Please wait`;
      const connection = instance.getConnection();
      if (!connection) return;
      
      const storage = instance.getStorage();
      const content = connection?.getContent();
      let starRemoved: boolean = false;

      if (!storage && !content && !connection) return;
      let list: string[] = [];

      // Get recently opened files - cut if limit has been reduced.
      const recentLimit = IBMi.connectionManager.get(`recentlyOpenedFilesLimit`) as number;
      const recent = storage!.getRecentlyOpenedFiles();
      if (recent.length > recentLimit) {
        recent.splice(recentLimit);
        storage!.setRecentlyOpenedFiles(recent);
      }

      const sources = storage!.getSourceList();
      const dirs = Object.keys(sources);

      let schemaItems: QuickPickItem[] = [];

      dirs.forEach(dir => {
        sources[dir].forEach(source => {
          list.push(`${dir}${dir.endsWith(`/`) ? `` : `/`}${source}`);
        });
      });

      const recentItems: QuickPickItem[] = recent.map(item => ({
        label: item,
        buttons: [compareButton]
      }));
      const listItems: QuickPickItem[] = list.map(item => ({
        label: item,
        buttons: [compareButton]
      }));

      const quickPick = window.createQuickPick();
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

      let filteredItems: QuickPickItem[] = [];

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
            quickPick.items = [connection!.upperCaseName(quickPick.value), ...list].map(label => ({
              label: label,
              buttons: [compareButton]
            }));
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

              resultSet = await connection.runSQL(`
                select ifnull( cast( SYSTEM_TABLE_NAME as char( 10 ) for bit data ), '' ) as SYSTEM_TABLE_NAME
                     , ifnull( TABLE_TEXT, '' ) as TABLE_TEXT
                  from QSYS2.SYSTABLES
                 where SYSTEM_TABLE_SCHEMA = '${connection!.sysNameInAmerican(selectionSplit[0])}'
                       and FILE_TYPE = 'S'
                  ${filterText ? `and SYSTEM_TABLE_NAME like '${filterText}%'` : ``}
                 order by 1
              `);

              const listFile: QuickPickItem[] = resultSet.map(row => ({
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

              resultSet = await connection.runSQL(`
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
      });

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
            window.showInformationMessage(`Cleared previously opened files.`);
          } else if (selection === CLEAR_CACHED) {
            listItems.length = 0;
            storage!.setSourceList({});
            quickPick.items = await createQuickPickItemsList(
              `Filter`,
              filteredItems,
              `Recent`,
              recentItems,
            );
            window.showInformationMessage(`Cleared cached files.`);
          } else {
            const selectionSplit = connection!.upperCaseName(selection).split('/')
            if ([3,4].includes(selectionSplit.length) || selection.startsWith(`/`)) {

              // When selection is QSYS path
              if (!selection.startsWith(`/`) && connection) {
                if(selectionSplit.length === 4){
                  //Remove the iASP part
                  selectionSplit.shift();
                }
                const library = selectionSplit[0];
                const file = selectionSplit[1];
                const member = path.parse(selectionSplit[2]);
                member.ext = member.ext.substring(1);
                const memberInfo = await connection.getContent().getMemberInfo(library, file, member.name);
                if (!memberInfo) {
                  window.showWarningMessage(`Source member ${library}/${file}/${member.base} does not exist.`);
                  return;
                } else if (memberInfo.name !== member.name || (member.ext && memberInfo.extension !== member.ext)) {
                  window.showWarningMessage(`Member ${library}/${file}/${member.name} of type ${member.ext} does not exist.`);
                  return;
                }

                member.base = `${member.name}.${member.ext || memberInfo.extension}`;
                selection = `${library}/${file}/${member.base}`;
              };

              // When select is IFS path
              if (selection.startsWith(`/`)) {
                const streamFile = await content!.streamfileResolve([selection.substring(1)], [`/`]);
                if (!streamFile) {
                  window.showWarningMessage(`${selection} does not exist or is not a file.`);
                  return;
                }
                selection = connection!.upperCaseName(selection) === connection!.upperCaseName(quickPick.value) ? quickPick.value : selection;
              }
              commands.executeCommand(`code-for-ibmi.openEditable`, selection, { readonly });
              quickPick.hide();
            } else {
              quickPick.value = connection!.upperCaseName(selection) + '/'
            }
          }
        }
      });

      quickPick.onDidTriggerItemButton((event: QuickPickItemButtonEvent<QuickPickItem>) => {
        if (event.button.iconPath == compareIcon) {
          let path: Uri;
          let currentFile: Uri;
          if (event.item.label.startsWith('/')) {
            path = Uri.parse(`streamfile:${event.item.label}`);
          } else {
            path = Uri.parse(`member:/${event.item.label}`);
          }

          const editor = window.activeTextEditor;
          if (editor) {
            currentFile = editor.document.uri;
            commands.executeCommand(`vscode.diff`, currentFile, path);
            quickPick.hide();
          }
        }
      });

      quickPick.onDidHide(() => quickPick.dispose());
      quickPick.show();

    }),
  ]
}

async function createQuickPickItemsList(
  labelFiltered: string = ``, filtered: QuickPickItem[] = [],
  labelRecent: string = ``, recent: QuickPickItem[] = [],
  labelCached: string = ``, cached: QuickPickItem[] = [],
) {
  const clearRecentArray = [{ label: ``, kind: QuickPickItemKind.Separator }, { label: CLEAR_RECENT }];
  const clearCachedArray = [{ label: ``, kind: QuickPickItemKind.Separator }, { label: CLEAR_CACHED }];

  const returnedList: QuickPickItem[] = [
    { label: labelFiltered, kind: QuickPickItemKind.Separator },
    ...filtered,
    { label: labelRecent, kind: QuickPickItemKind.Separator },
    ...recent,
    ...(recent.length != 0 ? clearRecentArray : []),
    { label: labelCached, kind: QuickPickItemKind.Separator },
    ...cached,
    ...(cached.length != 0 ? clearCachedArray : [])
  ];
  return returnedList;
}