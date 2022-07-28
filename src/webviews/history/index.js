const vscode = require(`vscode`);

module.exports = class HistoryJobUI {

  /**
   * @param {{timestamp: string, texte: string}[]} historyLog
   */
  static async init(historyLog) {

    const panel = vscode.window.createWebviewPanel(
      `custom`,
      `Job Log`,
      vscode.ViewColumn.Beside,
      {
        enableScripts: true
      }
    );

    panel.webview.html = getWebviewContent(historyLog);

  }
  
}

function getWebviewContent(historyLog) {
  return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Job log</title>
        <style type="text/css">
        /* DivTable.com */
        .divTable {
          display: table;
          width: 100%;
        }
    
        .divTableRow {
          display: table-row;
        }
    
        .divTableCell {
          border: 0px;
          display: table-cell;
          padding: 3px 10px;
        }

        .divTableHead {
          border: 0px solid #999999;
          display: table-cell;
          padding: 3px 10px;
          text-align: center;
        }
    
        .divTableHeading {
          background-color: dimgray;
          display: table-header-group;
          font-weight: bold;
        }
    
        .divTableFoot {
          background-color: #EEE;
          display: table-footer-group;
          font-weight: bold;
        }
    
        .divTableBody {
          display: table-row-group;
        }
      </style>
    </head>
    <body>
    <div class="divTable">
      <div class="divTableHeading">
        <div class="divTableHead">
          Timestamp
        </div>
        <div class="divTableHead">
          Message ID
        </div>
        <div class="divTableHead">
          Severity
        </div>
        <div class="divTableHead">
          Description
        </div>
      </div>
      <div class="divTableBody">
        ${historyLog.map(log => {return `<div class="divTableRow">
        <div class="divTableCell">${log.timestamp}</div>
        <div class="divTableCell">${log.messageId}</div>
        <div class="divTableCell">${log.severity}</div>
        <div class="divTableCell">${log.texte}</div>
        </div>`}).join(``)}
      </div>
    </div>
    </body>
    </html>`;
}
