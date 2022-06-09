const css = /*html*/`
  <style>
    .center-screen {
      display: flex;
      justify-content: center;
      align-items: center;
      text-align: center;
      min-height: 100vh;
    }

    .plaintext {
      background-color: var(--vscode-button-secondaryBackground);
      padding: 1em;
      color: var(--vscode-button-secondaryForeground);
    }

    .errortext {
      background-color: var(--vscode-button-secondaryBackground);
      padding: 1em;
      color: var(--vscode-errorForeground);
    }
  </style>`;

exports.setSimpleMessage = (text, className=`plaintext`) => {
  return `
  <!DOCTYPE html>
  <html>
    <head>
      ${css}
    </head>
    <body>
      <div class="center-screen">
        <span class="${className}">${text}</span>
      </div>
    </body>
  </html>`;
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
          margin: 5px 0;
          font-family: sans-serif;
          min-width: 400px;
          <!-- box-shadow: 0 0 20px rgba(0, 0, 0, 0.15); -->
        }
        ::selection {
          font-weight: bold;
          background-color: var(--vscode-editor-selectionBackground);
        }
        table thead tr {
          background-color: var(--);
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