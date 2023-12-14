import { ExtensionContext, QuickPickItem, QuickPickItemKind, Selection, TextEditorRevealType, commands, window, workspace } from "vscode";
import Instance from "../api/Instance";
import { getMemberUri, getUriFromPath } from "../filesystems/qsys/QSysFs";
import { QsysFsOptions } from "../typings";
import { Tools } from "../api/Tools";

export function connectOpenCommands(context: ExtensionContext, instance: Instance) {
  context.subscriptions.push(
    commands.registerCommand(`code-for-ibmi.openEditable`, async (path: string, line?: number, options?: QsysFsOptions) => {
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
          let doc = await workspace.openTextDocument(uri); // calls back into the provider
          const editor = await window.showTextDocument(doc, { preview: false });

          if (editor) {
            const selectedLine = editor.document.lineAt(line);
            editor.selection = new Selection(line, selectedLine.firstNonWhitespaceCharacterIndex, line, 100);
            editor.revealRange(selectedLine.range, TextEditorRevealType.InCenter);
          }

        } else {
          // Otherwise, do a generic open
          await commands.executeCommand(`open`, uri);
        }

        return true;
      } catch (e) {
        console.log(e);

        return false;
      }
    }),



    commands.registerCommand("code-for-ibmi.browse", (node: any) => { //any for now, typed later after TS conversion of browsers
      let uri;
      if (node?.member) {
        uri = getMemberUri(node?.member, { readonly: true });
      }
      else if (node?.path) {
        uri = getUriFromPath(node?.path, { readonly: true });
      }

      if (uri) {
        return commands.executeCommand(`vscode.open`, uri);
      }
    }),

    commands.registerCommand(`code-for-ibmi.goToFileReadOnly`, async () => commands.executeCommand(`code-for-ibmi.goToFile`, true)),
    commands.registerCommand(`code-for-ibmi.goToFile`, async (readonly?: boolean) => {
      const LOADING_LABEL = `Please wait`;
      const clearList = `$(trash) Clear list`;
      const clearListArray = [{ label: ``, kind: QuickPickItemKind.Separator }, { label: clearList }];
      const storage = instance.getStorage();
      const content = instance.getContent();
      const config = instance.getConfig();
      const connection = instance.getConnection();
      let starRemoved: boolean = false;

      if (!storage && !content) return;
      let list: string[] = [];

      const sources = storage!.getSourceList();
      const dirs = Object.keys(sources);

      let schemaItems: QuickPickItem[] = [];

      dirs.forEach(dir => {
        sources[dir].forEach(source => {
          list.push(`${dir}${dir.endsWith(`/`) ? `` : `/`}${source}`);
        });
      });

      const listItems: QuickPickItem[] = list.map(item => ({ label: item }));

      const quickPick = window.createQuickPick();
      quickPick.items = [
        {
          label: 'Cached',
          kind: QuickPickItemKind.Separator
        },
        ...listItems,
        ...clearListArray
      ];
      quickPick.canSelectMany = false;
      (quickPick as any).sortByLabel = false; // https://github.com/microsoft/vscode/issues/73904#issuecomment-680298036
      quickPick.placeholder = `Enter file path (format: LIB/SPF/NAME.ext (type '*' to search server) or /home/xx/file.txt)`;

      quickPick.show();

      // Create a cache for Schema if autosuggest enabled
      if (schemaItems.length === 0 && config && config.enableSQL) {
        content!.runSQL(`
            SELECT cast(SYSTEM_SCHEMA_NAME as char(10) for bit data) SYSTEM_SCHEMA_NAME, 
            ifnull(cast(SCHEMA_TEXT as char(50) for bit data), '') SCHEMA_TEXT 
            FROM QSYS2.SYSSCHEMAS 
            ORDER BY 1`
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
          quickPick.items = [
            {
              label: 'Cached',
              kind: QuickPickItemKind.Separator
            },
            ...listItems,
            ...clearListArray
          ];
          filteredItems = [];
        }

        // autosuggest
        if (config && config.enableSQL && (!quickPick.value.startsWith(`/`)) && quickPick.value.endsWith(`*`)) {
          const selectionSplit = quickPick.value.toUpperCase().split('/');
          const lastPart = selectionSplit[selectionSplit.length - 1];
          const filterText = lastPart.substring(0, lastPart.indexOf(`*`));

          let resultSet: Tools.DB2Row[] = [];

          switch (selectionSplit.length) {
            case 1:
              filteredItems = schemaItems.filter(schema => schema.label.startsWith(filterText));

              // Using `kind` didn't make any difference because it's sorted alphabetically on label
              quickPick.items = [
                {
                  label: 'Libraries',
                  kind: QuickPickItemKind.Separator
                },
                ...filteredItems,
                {
                  label: 'Cached',
                  kind: QuickPickItemKind.Separator
                },
                ...listItems,
                ...clearListArray
              ]

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

              resultSet = await content!.runSQL(`SELECT 
                ifnull(cast(system_table_name as char(10) for bit data), '') AS SYSTEM_TABLE_NAME, 
                ifnull(TABLE_TEXT, '') TABLE_TEXT 
              FROM QSYS2.SYSTABLES 
              WHERE TABLE_SCHEMA = '${connection!.sysNameInAmerican(selectionSplit[0])}' 
                AND FILE_TYPE = 'S' 
                ${filterText ? `AND SYSTEM_TABLE_NAME like '${filterText}%'` : ``}
              ORDER BY 1`);

              const listFile: QuickPickItem[] = resultSet.map(row => ({
                label: selectionSplit[0] + '/' + String(row.SYSTEM_TABLE_NAME),
                description: String(row.TABLE_TEXT)
              }))

              filteredItems = listFile.filter(file => file.label.startsWith(selectionSplit[0] + '/' + filterText));

              quickPick.items = [
                {
                  label: 'Source files',
                  kind: QuickPickItemKind.Separator
                },
                ...filteredItems,
                {
                  label: 'Cached',
                  kind: QuickPickItemKind.Separator
                },
                ...listItems,
                ...clearListArray
              ]
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

              resultSet = await content!.runSQL(`
                  SELECT cast(TABLE_PARTITION as char(10) for bit data) TABLE_PARTITION, 
                    ifnull(PARTITION_TEXT, '') PARTITION_TEXT, 
                    lower(ifnull(SOURCE_TYPE, '')) SOURCE_TYPE
                  FROM qsys2.SYSPARTITIONSTAT
                  WHERE TABLE_SCHEMA = '${connection!.sysNameInAmerican(selectionSplit[0])}'
                    AND table_name = '${connection!.sysNameInAmerican(selectionSplit[1])}'
                    ${filterText ? `AND TABLE_PARTITION like '${connection!.sysNameInAmerican(filterText)}%'` : ``}
                  ORDER BY 1
                `);

              const listMember = resultSet.map(row => ({
                label: selectionSplit[0] + '/' + selectionSplit[1] + '/' + String(row.TABLE_PARTITION) + '.' + String(row.SOURCE_TYPE),
                description: String(row.PARTITION_TEXT)
              }))

              filteredItems = listMember.filter(member => member.label.startsWith(selectionSplit[0] + '/' + selectionSplit[1] + '/' + filterText));

              quickPick.items = [
                {
                  label: 'Members',
                  kind: QuickPickItemKind.Separator
                },
                ...filteredItems,
                {
                  label: 'Cached',
                  kind: QuickPickItemKind.Separator
                },
                ...listItems,
                ...clearListArray
              ]
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
            quickPick.items = [
              {
                label: 'Filter',
                kind: QuickPickItemKind.Separator
              },
              ...filteredItems,
              {
                label: 'Cached',
                kind: QuickPickItemKind.Separator
              },
              ...listItems,
              ...clearListArray
            ]
          }
          starRemoved = false;
        }
      })

      quickPick.onDidAccept(() => {
        const selection = quickPick.selectedItems[0].label;
        if (selection && selection !== LOADING_LABEL) {
          if (selection === clearList) {
            storage!.setSourceList({});
            window.showInformationMessage(`Cleared list.`);
            quickPick.hide()
          } else {
            const selectionSplit = selection.split('/')
            if (selectionSplit.length === 3 || selection.startsWith(`/`)) {
              commands.executeCommand(`code-for-ibmi.openEditable`, selection, 0, { readonly });
              quickPick.hide()
            } else {
              quickPick.value = selection.toUpperCase() + '/'
            }
          }
        }
      })

      quickPick.onDidHide(() => quickPick.dispose());
      quickPick.show();

    }),
  );
}