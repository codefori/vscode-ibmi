
const vscode = require('vscode');

var instance = require('../Instance');
const {Database, Table, Column} = require('./databaseFs');

/** @type {{[SCHEMA: string]: Table[]}} */
let schemaCache = {};

module.exports = class databaseBrowserProvider {
  /**
   * @param {vscode.ExtensionContext} context
   */
  constructor(context) {
    this.emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.emitter.event;

    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration(event => {
        let affected = event.affectsConfiguration("code-for-ibmi.libraryList");
        if (affected) {
          this.refresh();
        }
      }),

      vscode.commands.registerCommand(`code-for-ibmi.refreshDatabaseBrowser`, async () => {
        this.refresh();
      }),

      vscode.commands.registerCommand(`code-for-ibmi.runEditorStatement`, async () => {
        const connection = instance.getConnection();
        const content = instance.getContent();
        const editor = vscode.window.activeTextEditor;

        if (editor.document.languageId === 'sql') {
          if (connection.remoteFeatures.db2util) {
            const statement = parseStatement(editor);

            try {
              const data = await content.runSQL(statement);

              const panel = vscode.window.createWebviewPanel(
                'databaseResult',
                'Database Result',
                vscode.ViewColumn.Active
              );
              panel.webview.html = generateTable(data);
            } catch (e) {
              vscode.window.showErrorMessage("Statement did not execute correctly.");
            }
          } else {
            vscode.window.showErrorMessage("To execute statements, db2util must be installed on the system.");
          }
        }
      }),

      vscode.languages.registerCompletionItemProvider({language: 'sql'}, {
        provideCompletionItems: (document, position) => {
          /** @type vscode.CompletionItem[] */
          let items = [];
          let item;

          for (const schema in schemaCache) {
            for (const table of schemaCache[schema]) {
              item = new vscode.CompletionItem(`select from ${schema}.${table.name.toLowerCase()}`, vscode.CompletionItemKind.Snippet);
              if (table._type === 'A') {
                item.insertText = `SELECT *\nFROM ${schema}.${table.name.toLowerCase()}`;
              } else {
                item.insertText = `SELECT\n${table.columns.map(column => '  ' + column.name.toLowerCase()).join(',\n')}\nFROM ${schema}.${table.name.toLowerCase()}`;
              }
              item.detail = table.type;
              item.documentation = table.text;
              items.push(item);

              for (const column of table.columns) {
                item = new vscode.CompletionItem(`${table.name.toLowerCase()}.${column.name.toLowerCase()}`, vscode.CompletionItemKind.Variable);
                item.insertText = column.name.toLowerCase();
                item.detail = `${column.heading} (${column.type})`;
                item.documentation = `Belongs to \`${schema}.${table.name.toLowerCase()}\`. ${column.comment !== 'null' ? column.comment : ''}`;
                items.push(item);
              }
            }
          }

          return items;
        }
      }),

      vscode.languages.registerHoverProvider({language: 'sql'}, {
        provideHover: (document, position, token) => {
          const range = document.getWordRangeAtPosition(position);
          const word = document.getText(range).toUpperCase();

          let result;
          for (const schema in schemaCache) {
            result = schemaCache[schema].find(table => word === table.name);

            if (result) {
              return new vscode.Hover(new vscode.MarkdownString(`${result.type}: \`${schema}.${result.name.toLowerCase()}\`. ${result.text}\n\n${result.columns.map(column => `* \`${column.name.toLowerCase()}\` ${column.type}`).join('\n')}`));
            }
          }

          return null; 
        }
      })
    )
  }

  refresh() {
    this.emitter.fire();
  }

  /**
   * @param {vscode.TreeItem} element
   * @returns {vscode.TreeItem};
   */
  getTreeItem(element) {
    return element;
  }

  /**
   * @param {vscode.TreeItem?} element
   * @returns {Promise<vscode.TreeItem[]>};
   */
  async getChildren(element) {
    var items = [], item;

    if (element) { 

      if (element instanceof SchemaItem) {
        const objects = await Database.getObjects(element.path);
        schemaCache[element.path] = objects;
        items.push(...objects.map(object => new TableItem(object)));
      } else 
      
      if (element instanceof TableItem) {
        items.push(...element.table.columns.map(column => new ColumnItem(column)));
      }

    } else {
      const connection = instance.getConnection();
      if (connection) {
        if (connection.remoteFeatures.db2util) {
          const libraries = connection.libraryList;

          for (var library of libraries) {
            items.push(new SchemaItem(library));
          }
        } else {
          items.push(new vscode.TreeItem("'db2util' not installed on system.", vscode.TreeItemCollapsibleState.None));
        }
      }
    }
    return items;
  }
}



class SchemaItem extends vscode.TreeItem {
  constructor(name) {
    super(name.toLowerCase(), vscode.TreeItemCollapsibleState.Collapsed);

    this.contextValue = 'schema';
    this.path = name;
    this.iconPath = new vscode.ThemeIcon('database');
  }
}

class TableItem extends vscode.TreeItem {
  /**
   * @param {Table} table 
   */
  constructor(table) {
    super(table.name.toLowerCase());

    this.contextValue = 'table';
    this.tooltip = table.type;
    this.iconPath = new vscode.ThemeIcon(TABLE_ICONS[table._type]);

    if (table._type === 'A') {
      this.collapsibleState = vscode.TreeItemCollapsibleState.None;
      this.description = `${table.type} - ${table.base}. ${table.text}`;
    } else {
      this.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
      this.description = `${table.type}. ${table.text}`;
    }

    /** @type {Table} */
    this.table = table;
  }
}

class ColumnItem extends vscode.TreeItem {
  /**
   * 
   * @param {Column} column 
   */
  constructor(column) {
    super(column.name.toLowerCase(), vscode.TreeItemCollapsibleState.None);

    this.description = `${column.type.toLowerCase()}. ${column.heading}`;
    this.tooltip = column.comment;
    this.iconPath = new vscode.ThemeIcon('circle-filled');
  }
}

const TABLE_ICONS = {
  'A': 'files',
  'L': 'filter',
  'M': 'file-symlink-file',
  'P': 'list-flat',
  'T': 'list-flat',
  'V': 'eye'
}

/**
 * @param {vscode.TextEditor} editor 
 * @returns {string} Statement
 */
function parseStatement(editor) {
  const document = editor.document;

  let text = document.getText(editor.selection).trim();
  let statement;
  
  if (text.length > 0) {
    statement = text;
  } else {
    const cursor = editor.document.offsetAt(editor.selection.active);
    text = document.getText();

    let statements = [];

    let inQuote = false;
    let start = 0, end = 0;

    for (const c of text) {
      switch (c) {
        case `'`:
          inQuote = !inQuote;
          break;
        
        case `;`:
          if (!inQuote) {
            statements.push({
              start,
              end,
              text: text.substring(start, end)
            });

            start = end+1;
          }
          break;
      }
      end++;
    }

    //Add ending
    statements.push({
      start,
      end,
      text: text.substring(start, end)
    });

    statement = statements.find(range => cursor >= range.start && cursor <= range.end).text;
  }

  return statement;
}

/**
 * @param {any[]} array 
 * @returns {string} HTML
 */
function generateTable(array) {
  let html = ``;

  const keys = Object.keys(array[0]);

  html += `<table style="width: 100%">`;
  html += `<thead><tr>${keys.map(key => `<th>${key}</th>`).join('')}</tr></thead>`;
  
  html += `<tbody>`;
  html += array.map(row => {
    return `<tr>` + keys.map(key => `<td>${row[key]}</td>`).join('') + `</tr>`
  }).join('');
  html += `</tbody>`;
  html += `</table>`;

  return html;
}