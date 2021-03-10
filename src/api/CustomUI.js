const vscode = require(`vscode`);

//Webpack is returning this as a string
const vscodeweb = require(`@bendera/vscode-webview-elements/dist/bundled`);

class CustomUI {
  constructor() {
    /** @type {Field[]} */
    this.fields = [];
  }

  addField(field) {this.fields.push(field)};

  /**
   * @param {string} title 
   * @returns {Promise<{panel: vscode.WebviewPanel, data: object}>}
   */
  loadPage(title) {
    const panel = vscode.window.createWebviewPanel(
      `custom`,
      title,
      vscode.ViewColumn.Beside,
      {
        enableScripts: true
      }
    );

    panel.webview.html = this.getHTML(panel);

    let didSubmit = false;

    return new Promise((resolve, reject) => {
      panel.webview.onDidReceiveMessage(
        message => {
          didSubmit = true;
          resolve({panel, data: message});
        }
      );
  
      panel.onDidDispose(() => {
        if (!didSubmit) resolve({panel, data: null});
      });
    })


  }

  getHTML(panel) {
    const submitButton = this.fields.find(field => field.type === `submit`);

    if (!submitButton) {
      throw new Error(`Submit button required on CustomUI forms.`);
    }

    return `
    <!DOCTYPE html>
    <html lang="en">
    
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>IBM i Log in</title>
    
        <script type="module">${vscodeweb}</script>
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
            const submitfields = [${this.fields.filter(field => field.type !== `submit`).map(field => `'${field.id}'`).join(`,`)}];
            const filefields = [${this.fields.filter(field => field.type == `file`).map(field => `'${field.id}'`).join(`,`)}];
    
            const doDone = (event) => {
                if (event)
                    event.preventDefault();
    
                var data = {};
    
                for (const field of submitfields) {
                  var fieldType = document.getElementById(field).nodeName.toLowerCase();
                   switch (fieldType) {
                    case "vscode-checkbox"
                    :data[field] = document.getElementById(field).checked;
                    break;
                    default
                    :data[field] = document.getElementById(field).value;
                  }
                }
                vscode.postMessage(data)
            };

            submitButton.onclick = doDone;
            submitButton.onKeyDown = doDone;

            for (const field of submitfields) {
                document.getElementById(field)
                    .addEventListener('keyup', function(event) {
                      event.preventDefault();
                      if (event.keyCode === 13) {
                          doDone();
                    }
                });
            }

            for (const field of filefields) {
              document.getElementById(field)
                  .addEventListener('vsc-change', (e) => {
                      const VirtualField = document.getElementById(e.target.id)
                      let input = VirtualField.shadowRoot.querySelector("input");
                      for (let file of Array.from(input.files)) {
                          let reader = new FileReader();
                          reader.addEventListener("load", () => {
                            console.log(file.path);
                            document.getElementById(e.target.id).setAttribute("value", file.path)   
                          });
                          reader.readAsText(file);
                      }
                  }
                  )}

        }())
    </script>
    
    </html>`;
  }
}

class Field  {
  constructor(type, id, label) {
    /** @type {"input"|"password"|"submit"|"checkbox"|"file"}} */
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
    case `checkbox`:
      return `
        <vscode-form-item>
        <vscode-form-control>
        <vscode-checkbox id="${this.id}" ${this.default === `checked` ? `checked` : ``}>${this.label}</vscode-checkbox>
        ${this.description ? `<vscode-form-description>${this.description}</vscode-form-description>` : ``}
        </vscode-form-control>
        </vscode-form-item>`;
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
    case `file`:
      return `
        <vscode-form-item>
            <vscode-form-label>${this.label}</vscode-form-label>
            ${this.description ? `<vscode-form-description>${this.description}</vscode-form-description>` : ``}
            <vscode-form-control>
                <vscode-inputbox type="file" id="${this.id}" name="${this.id}"></vscode-inputbox>
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