const vscode = require(`vscode`);
const path = require(`path`);

class CustomUI {
  constructor() {
    /** @type {Field[]} */
    this.fields = [];
  }

  addField(field) {this.fields.push(field)};

  /**
   * @param {vscode.ExtensionContext} context 
   * @param {string} title 
   * @returns {Promise<{panel: vscode.WebviewPanel, data: object}}
   */
  loadPage(context, title, onDidRecieveMessage) {
    const panel = vscode.window.createWebviewPanel(
      `custom`,
      title,
      vscode.ViewColumn.Beside,
      {
        enableScripts: true
      }
    );

    panel.webview.html = this.getHTML(panel, context);

    let didSubmit = false;

    return new Promise((resolve, reject) => {
      panel.webview.onDidReceiveMessage(
        message => {
          didSubmit = true;
          resolve({panel, data: message});
          onDidRecieveMessage(panel, message)
        }
      );
  
      panel.onDidDispose(() => {
        if (!didSubmit) resolve({panel, data: null});
      });
    })


  }

  getHTML(panel, context) {
    const submitButton = this.fields.find(field => field.type === `submit`);

    if (!submitButton) {
      throw new Error(`Submit button required on CustomUI forms.`);
    }

    const onDiskPath = vscode.Uri.file(
      path.join(context.extensionPath, `src`, `webviews`, `extern`, `vscwe.js`)
    );
    // And get the special URI to use with the webview
    const onDiskSrc = panel.webview.asWebviewUri(onDiskPath);

    return `
    <!DOCTYPE html>
    <html lang="en">
    
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>IBM i Log in</title>
    
        <script src="${onDiskSrc}" type="module"></script>
        <style>
            #laforma {
                margin: 2em 2em 2em 2em;
            }
        </style>
    </head>
    
    <body>
    
        <div id="laforma">
            ${this.fields.map(field => field.getHTML()).join(``)}
        </div>
    
    </body>
    
    <script>
        (function () {
            const vscode = acquireVsCodeApi();
            const submitButton = document.getElementById('${submitButton.id}');
            const fields = [${this.fields.filter(field => field.type !== `submit`).map(field => `'${field.id}'`).join(`,`)}];
    
            const doDone = (event) => {
                if (event)
                    event.preventDefault();
    
                var data = {};
    
                for (const field of fields) data[field] = document.getElementById(field).value;
    
                vscode.postMessage(data)
            };

            submitButton.onclick = doDone;
            submitButton.onKeyDown = doDone;

            for (const field of fields) {
                document.getElementById(field)
                    .addEventListener('keyup', function(event) {
                      event.preventDefault();
                      if (event.keyCode === 13) {
                          doDone();
                    }
                });
            }
        }())
    </script>
    
    </html>`;
  }
}

class Field  {
  constructor(type, id, label) {
    /** @type {"input"|"password"|"submit"} */
    this.type = type;

    /** @type {string} */
    this.id = id;

    /** @type {string} */
    this.label = label;
    
    /** @type {string|undefined} */
    this.description = undefined;

    /** @type {string|undefined} */
    this.default = undefined;
  }

  getHTML() {
    switch (this.type) {
    case `submit`:
      return `<vscode-button id="${this.id}">${this.label}</vscode-button>`;

    case `input`:
      return `
      <vscode-form-item>
          <vscode-form-label>${this.label}</vscode-form-label>
          ${this.description ? `<vscode-form-description>${this.description}</vscode-form-description>` : ``}
          <vscode-form-control>
              <vscode-inputbox id="${this.id}" name="${this.id}" ${this.default ? `value="${this.default}"` : ``}></vscode-inputbox>
          </vscode-form-control>
      </vscode-form-item>
      `;

    case `password`:
      return `
      <vscode-form-item>
          <vscode-form-label>${this.label}</vscode-form-label>
          ${this.description ? `<vscode-form-description>${this.description}</vscode-form-description>` : ``}
          <vscode-form-control>
              <vscode-inputbox type="password" id="${this.id}" name="${this.id}" ${this.default ? `value="${this.default}"` : ``}></vscode-inputbox>
          </vscode-form-control>
      </vscode-form-item>
      `;

    }
  }
}

module.exports = {CustomUI, Field};