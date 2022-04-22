const vscode = require(`vscode`);

const csv = require(`csv/sync`);

let instance = require(`../../Instance`);
const CompileTools = require(`../../api/CompileTools`);

/**
 * @param {vscode.ExtensionContext} context 
 */
exports.initialise = (context) => {
  context.subscriptions.push(
    vscode.commands.registerCommand(`code-for-ibmi.runEditorStatement`, async () => {
      const content = instance.getContent();
      const editor = vscode.window.activeTextEditor;

      if (editor.document.languageId === `sql`) {
        const statement = this.parseStatement(editor);

        if (statement.content.trim().length > 0) {

          try {
            if (statement.type === `cl`) {
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
            } else {
              const data = await content.runSQL(statement.content);

              if (data.length > 0) {
                switch (statement.type) {
                case `statement`:
                  const panel = vscode.window.createWebviewPanel(
                    `databaseResult`,
                    `Database Result`,
                    vscode.ViewColumn.Active,
                    {
                      retainContextWhenHidden: true,
                      enableFindWidget: true
                    }
                  );
                  panel.webview.html = this.generateTable(statement.content, data);
                  break;

                case `csv`:
                case `json`:
                case `sql`:
                  let textDoc = await vscode.workspace.openTextDocument(vscode.Uri.parse(`untitled:` + `result.${statement.type}`));
                  let editor = await vscode.window.showTextDocument(textDoc);

                  let content = ``;
                  switch (statement.type) {
                  case `csv`: content = csv.stringify(data, {
                    header: true,
                    quoted_string: true,
                  }); break;
                  case `json`: content = JSON.stringify(data, null, 2); break;

                  case `sql`: 
                    const keys = Object.keys(data[0]);

                    const insertStatement = [
                      `insert into TABLE (`,
                      `  ${keys.join(`, `)}`,
                      `) values `,
                      data.map(
                        row => `  (${keys.map(key => {
                          if (row[key] === null) return `null`;
                          if (typeof row[key] === `string`) return `'${row[key].replace(/'/g, `''`)}'`;
                          return row[key];
                        }).join(`, `)})`
                      ).join(`,\n`),
                    ];
                    content = insertStatement.join(`\n`); 
                    break;
                  }

                  editor.edit(edit => {
                    edit.insert(new vscode.Position(0, 0), content);
                  }).then(() => {
                    editor.revealRange(new vscode.Range(1, 1, 1, 1), vscode.TextEditorRevealType.AtTop);
                  });
                  break;
                }

              } else {
                vscode.window.showInformationMessage(`Query executed with no data returned.`);
              }
            }

          } catch (e) {
            if (typeof e === `string`) {
              vscode.window.showErrorMessage(e.length > 0 ? e : `An error occurred when executing the statement.`);
            } else {
              vscode.window.showErrorMessage(e.message || `Error running SQL statement.`);
            }
          }
        }
      }
    }),
  )
}


/**
 * @param {vscode.TextEditor} editor
 * @returns {{type: "statement"|"cl"|"json"|"csv"|"sql", content: string}} Statement
 */
exports.parseStatement = (editor) => {
  const document = editor.document;
  const eol = (document.eol === vscode.EndOfLine.LF ? `\n` : `\r\n`);

  let text = document.getText(editor.selection).trim();
  let content;

  /** @type {"statement"|"cl"|"json"|"sql"} */
  let type = `statement`;

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

    // Remove blank lines and comment lines
    let lines = content.split(eol).filter(line => line.trim().length > 0 && !line.trimStart().startsWith(`--`));

    lines.forEach((line, startIndex) => {
      if (type !== `statement`) return;
      
      [`cl`, `json`, `csv`, `sql`].forEach(mode => {
        if (line.trim().toLowerCase().startsWith(mode + `:`)) {
          lines = lines.slice(startIndex);
          lines[0] = lines[0].substring(mode.length + 1).trim();
    
          content = lines.join(` `);

          //@ts-ignore We know the type.
          type = mode;
        }
      });
    });
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
exports.generateTable = (statement, array) => {
  // Setup basics of valid HTML5 document
  let html = /*html*/`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset='utf-8'>
      <meta http-equiv='X-UA-Compatible' content='IE=edge'>
      <title>Database Result</title>
      <meta name='viewport' content='width=device-width, initial-scale=1'>
      <style>
        body {
          color: var(--vscode-editor-foreground);
        }
        table {
          font-weight: var(--vscode-editor-font-weight);
          font-size: var(--vscode-editor-font-size);
          width: 100%;
          border-collapse: collapse;
          margin: 25px 0;
          font-family: sans-serif;
          min-width: 400px;
          <!-- box-shadow: 0 0 20px rgba(0, 0, 0, 0.15); -->
        }
        ::selection {
          font-weight: bold;
          background-color: var(--vscode-editor-selectionBackground);
        }
        table thead tr {
          background-color: var(--vscode-editor-selectionBackground);
          color: var(--vscode-editor-foreground);
          text-align: left;
        }
        table th,
        table td {
          padding: 12px 15px;
        }

        table tbody tr {
          border-bottom: 1px solid var(--vscode-editor-selectionBackground);
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
