
const vscode = require(`vscode`);

let instance = require(`../Instance`);
const CompileTools = require(`../api/CompileTools`);
const Configuration = require(`../api/Configuration`);

const {Database, Table, Column} = require(`../filesystems/databaseFs`);

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
      vscode.commands.registerCommand(`code-for-ibmi.refreshDatabaseBrowser`, async () => {
        this.refresh();
      }),

      vscode.commands.registerCommand(`code-for-ibmi.addSchemaToDatabaseBrowser`, async () => {
        const config = instance.getConfig();

        let schemas = config.databaseBrowserList;

        const newSchema = await vscode.window.showInputBox({
          prompt: `Library to add to Database Browser`
        });

        if (newSchema) {
          schemas.push(newSchema.toUpperCase());
          await config.set(`databaseBrowserList`, schemas);
          if (Configuration.get(`autoRefresh`)) this.refresh();
        }
      }),

      vscode.commands.registerCommand(`code-for-ibmi.removeSchemaFromDatabaseBrowser`, async (node) => {
        if (node) {
          //Running from right click
          const config = instance.getConfig();

          let schemas = config.databaseBrowserList;

          let index = schemas.findIndex(file => file.toUpperCase() === node.path)
          if (index >= 0) {
            schemas.splice(index, 1);
          }

          await config.set(`databaseBrowserList`, schemas);
          if (Configuration.get(`autoRefresh`)) this.refresh();
        }
      }),

      vscode.commands.registerCommand(`code-for-ibmi.runEditorStatement`, async () => {
        const connection = instance.getConnection();
        const content = instance.getContent();
        const config = instance.getConfig();
        const editor = vscode.window.activeTextEditor;

        if (editor.document.languageId === `sql`) {
          if (connection.remoteFeatures.db2util) {
            const statement = parseStatement(editor);

            try {
              switch (statement.type) {
              case `sql`:
                const data = await content.runSQL(statement.content);

                const panel = vscode.window.createWebviewPanel(
                  `databaseResult`,
                  `Database Result`,
                  vscode.ViewColumn.Active,
                  {
                    retainContextWhenHidden: true,
                    enableFindWidget: true
                  }
                );
                panel.webview.html = generateTable(statement.content, data);
                break;

              case `cl`:
                const commandResult = await CompileTools.runCommand(instance, {
                  command: statement.content,
                  environment: `ile`
                });

                if (commandResult.code === 0 || commandResult.code === null) {
                  vscode.window.showInformationMessage(`Command executed successfuly.`);
                } else {
                  vscode.window.showErrorMessage(`Command failed to run.`);
                }

                let output = ``;
                if (commandResult.stderr.length > 0) output += `${commandResult.stderr}\n\n`;
                if (commandResult.stdout.length > 0) output += `${commandResult.stdout}\n\n`;

                CompileTools.appendOutput(output);
                break;
              }

            } catch (e) {
              if (typeof e === `string`) {
                vscode.window.showErrorMessage(e);
              } else {
                vscode.window.showErrorMessage(e.message || `Error running SQL statement.`);
              }
            }
          } else {
            vscode.window.showErrorMessage(`To execute statements, db2util must be installed on the system.`);
          }
        }
      }),

      vscode.languages.registerCompletionItemProvider({language: `sql`}, {
        provideCompletionItems: (document, position) => {
          /** @type vscode.CompletionItem[] */
          let items = [];
          let item;

          for (const schema in schemaCache) {
            for (const table of schemaCache[schema]) {
              item = new vscode.CompletionItem(`select from ${schema}.${table.name.toLowerCase()}`, vscode.CompletionItemKind.Snippet);
              if (table._type === `A`) {
                item.insertText = `SELECT *\nFROM ${schema}.${table.name.toLowerCase()}`;
              } else {
                item.insertText = `SELECT\n${table.columns.map(column => `  ` + column.name.toLowerCase()).join(`,\n`)}\nFROM ${schema}.${table.name.toLowerCase()}`;
              }
              item.detail = table.type;
              item.documentation = table.text;
              items.push(item);

              for (const column of table.columns) {
                item = new vscode.CompletionItem(`${table.name.toLowerCase()}.${column.name.toLowerCase()}`, vscode.CompletionItemKind.Variable);
                item.insertText = column.name.toLowerCase();
                item.detail = `${column.heading} (${column.type})`;
                item.documentation = `Belongs to \`${schema}.${table.name.toLowerCase()}\`. ${column.comment !== `null` ? column.comment : ``}`;
                items.push(item);
              }
            }
          }

          return items;
        }
      }),

      vscode.languages.registerHoverProvider({language: `sql`}, {
        provideHover: (document, position, token) => {
          const range = document.getWordRangeAtPosition(position);
          const word = document.getText(range).toUpperCase();

          let result;
          for (const schema in schemaCache) {
            result = schemaCache[schema].find(table => word === table.name);

            if (result) {
              return new vscode.Hover(new vscode.MarkdownString(`${result.type}: \`${schema}.${result.name.toLowerCase()}\`. ${result.text}\n\n${result.columns.map(column => `* \`${column.name.toLowerCase()}\` ${column.type}`).join(`\n`)}`));
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
    let items = [], item;

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
        const config = instance.getConfig();

        if (connection.remoteFeatures.db2util) {
          const libraries = config.databaseBrowserList;

          for (let library of libraries) {
            items.push(new SchemaItem(library));
          }
        } else {
          items.push(new vscode.TreeItem(`'db2util' not installed on system or is disabled in the settings.`, vscode.TreeItemCollapsibleState.None));
        }
      }
    }
    return items;
  }
}



class SchemaItem extends vscode.TreeItem {
  constructor(name) {
    super(name.toLowerCase(), vscode.TreeItemCollapsibleState.Collapsed);

    this.contextValue = `schema`;
    this.path = name;
    this.iconPath = new vscode.ThemeIcon(`database`);
  }
}

class TableItem extends vscode.TreeItem {
  /**
   * @param {Table} table
   */
  constructor(table) {
    super(table.name.toLowerCase());

    this.contextValue = `table`;
    this.tooltip = table.type;
    this.iconPath = new vscode.ThemeIcon(TABLE_ICONS[table._type]);

    if (table._type === `A`) {
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
    this.iconPath = new vscode.ThemeIcon(`circle-filled`);
  }
}

const TABLE_ICONS = {
  'A': `files`,
  'L': `filter`,
  'M': `file-symlink-file`,
  'P': `list-flat`,
  'T': `list-flat`,
  'V': `eye`
}

/**
 * @param {vscode.TextEditor} editor
 * @returns {{type: "sql"|"cl", content: string}} Statement
 */
function parseStatement(editor) {
  const document = editor.document;
  const eol = (document.eol === vscode.EndOfLine.LF ? `\n` : `\r\n`);

  let text = document.getText(editor.selection).trim();
  let content;

  /** @type {"sql"|"cl"} */
  let type = `sql`;

  if (text.length > 0) {
    content = text;
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

    let statementData = statements.find(range => cursor >= range.start && cursor <= range.end);
    content = statementData.text.trim();

    editor.selection = new vscode.Selection(editor.document.positionAt(statementData.start), editor.document.positionAt(statementData.end));

    if (content.toUpperCase().startsWith(`CL:`)) {
      let lines = content.split(eol);
      let startIndex = lines.findIndex(line => line.toUpperCase().startsWith(`CL:`));
      lines = lines.slice(startIndex);
      lines[0] = lines[0].substring(3).trim();

      content = lines.join(` `);
      type = `cl`;
    }
  }

  return {
    type,
    content
  };
}

/**
 * @param {any[]} array
 * @returns {string} HTML
 */
function generateTable(statement, array) {
  // Setup basics of valid HTML5 document
  let html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset='utf-8'>
      <meta http-equiv='X-UA-Compatible' content='IE=edge'>
      <title>Database Result</title>
      <meta name='viewport' content='width=device-width, initial-scale=1'>
      <style>
        body {
          font-family: var(--vscode-editor-font-family);
          color: var(--vscode-editor-foreground);
        }
        table {
          font-weight: var(--vscode-editor-font-weight);
          font-size: var(--vscode-editor-font-size);
          width: 100%;
          border-collapse: collapse;
        }
        ::selection {
          background-color: var(--vscode-editor-selectionBackground);
          color: var(--vscode-editor-selectionForeground);
        }
        container {
          overflow-x: auto;
          white-space: nowrap;
        }
        tr:nth-child(even) {
          background-color: var(--vscode-editor-selectionHighlightBackground);
        }
        table thead tr th {
          border-bottom: 2px solid var(--vscode-editor-selectionHighlightBackground);
        }
      </style>
    </head>
    <body>
      <div class="container">
        <table>
          <thead>`;

  const keys = Object.keys(array[0]);

  html += `<tr>${keys.map(key => `<th>${key}</th>`).join(``)}</tr></thead><tbody>`;
  html += array.map(row => {
    return `<tr>` + keys.map(key => `<td>${row[key]}</td>`).join(``) + `</tr>`
  }).join(``);

  html += `
          </tbody>
        </table>
      </div>
    </body>
  </html>`;

  return html;
}
