/* eslint-disable indent */
const vscode = require(`vscode`);

//Webpack is returning this as a string
const vscodeweb = require(`@bendera/vscode-webview-elements/dist/bundled`);

class CustomUI {
  constructor() {
    /** @type {Field[]} */
    this.fields = [];
  }

  /** 
   * @param {Field} field
   */
  addField(field) {
    switch (field.type) {
      case `submit`:
        console.warn(`Submit fields are no longer supported. Consider using buttons instead.`);
        break;
    }

    this.fields.push(field)
  };

  /**
   * If no callback is provided, a Promise will be returned
   * @param {string} title 
   * @param {Function} [callback] ({panel, data}) => {}
   * @returns {Promise<{panel: vscode.WebviewPanel, data: object}>}
   */
  loadPage(title, callback) {
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

    if (callback) {
      panel.webview.onDidReceiveMessage(
        message => {
          didSubmit = true;
          callback({panel, data: message});
        }
      );
  
      panel.onDidDispose(() => {
        if (!didSubmit) callback({panel, data: null});
      });

    } else {
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
      });
    }
  }

  getHTML(panel) {
    const submitButton = this.fields.find(field => field.type === `submit`) || {id: ``};

    const notInputFields = [`submit`, `buttons`, `tree`, `hr`, `paragraph`, `tabs`];
    const trees = this.fields.filter(field => field.type == `tree`);

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

            vscode-tree {
              width: 50em;
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

            // Legacy: single submit button
            const submitButton = document.getElementById('${submitButton.id}');

            // New: many button that can be pressed to submit
            const groupButtons = [${[...(this.fields.filter(field => field.type == `buttons`).map(field => field.items.map(item => `'${item.id}'`)))].join(`, `)}];

            // Available trees in the fields, though only one is supported.
            const trees = [${trees.map(field => `'${field.id}'`).join(`,`)}];

            // Fields which required a file path
            const filefields = [${this.fields.filter(field => field.type == `file`).map(field => `'${field.id}'`).join(`,`)}];

            // Fields that have value which can be returned
            const submitfields = [${this.fields.filter(field => !notInputFields.includes(field.type)).map(field => `'${field.id}'`).join(`,`)}];
    
            const doDone = (event, buttonValue) => {
                console.log('submit now!!', buttonValue)
                if (event)
                    event.preventDefault();
    
                var data = {};

                if (buttonValue) {
                  data['buttons'] = buttonValue;
                }
    
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

                vscode.postMessage(data);
            };

            // Legacy: when only one button was supported
            if (submitButton) {
              submitButton.onclick = doDone;
              submitButton.onKeyDown = doDone;
            }

            console.log(groupButtons);
            // Now many buttons can be pressed to submit
            for (const field of groupButtons) {
                console.log('group button', field, document.getElementById(field));
                var button = document.getElementById(field);
                button.onclick = (event) => {
                    doDone(event, field);
                };
                button.onKeyDown = (event) => {
                    doDone(event, field);
                };
            }

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
                            document.getElementById(e.target.id).setAttribute("value", file.path)   
                          });
                          reader.readAsText(file);
                      }
                  })
            }

            document.addEventListener('DOMContentLoaded', () => {
              var currentTree;
              ${trees.map(tree => { 
                return `
                  currentTree = document.getElementById('${tree.id}');
                  currentTree.data = ${JSON.stringify(tree.items)};
                  currentTree.addEventListener('vsc-select', (event) => {
                    console.log(event.detail);
                    vscode.postMessage({'${tree.id}': event.detail.value});
                  });
                  `
              })}
            });

        }())
    </script>
    
    </html>`;
  }
}

class Field  {
  /**
   * 
   * @param {"input"|"password"|"submit"|"buttons"|"checkbox"|"file"|"tabs"|"tree"|"select"|"paragraph"|"hr"} type 
   * @param {string} [id] 
   * @param {string} [label] 
   */
  constructor(type, id, label) {
    /** @type {"input"|"password"|"submit"|"buttons"|"checkbox"|"file"|"tabs"|"tree"|"select"|"paragraph"|"hr"} */
    this.type = type;

    /** @type {string} */
    this.id = id;

    /** @type {string} */
    this.label = label;
    
    /** @type {string|undefined} */
    this.description = undefined;

    /** @type {string|undefined} */
    this.default = undefined;

    /** 
     * Used only for `input` type
     * @type {boolean|undefined} 
    */
    this.readonly = undefined;

    /** 
     * Used only for `input` type
     * @type {boolean|undefined} 
    */
    this.multiline = undefined;

    /** @type {{label: string, value: string}[]|{selected?: boolean, value: string, description: string, text: string}[]|{label: string, id: string}[]|undefined} Used for tree, select & button types. */
    this.items = undefined;
  }

  getHTML() {
    switch (this.type) {
    case `submit`:
      return `<vscode-button id="${this.id}">${this.label}</vscode-button>`;

    case `buttons`:
      return `
        <vscode-form-item>
          ${this.items.map(item => `<vscode-button id="${item.id}" style="margin:3px">${item.label}</vscode-button>`).join(``)}
        </vscode-form-item>`;

    case `hr`:
      return `<hr />`;

    case `checkbox`:
      return `
        <vscode-form-item>
          <vscode-form-control>
          <vscode-checkbox id="${this.id}" ${this.default === `checked` ? `checked` : ``}>${this.label}</vscode-checkbox>
          ${this.description ? `<vscode-form-description>${this.description}</vscode-form-description>` : ``}
          </vscode-form-control>
        </vscode-form-item>`;

    case `tabs`:
      return `
        <vscode-tabs selectedIndex="${this.default || 0}">
          ${this.items.map(item => 
            `
            <header slot="${item.label}">Lorem</header>
            <section>
              ${item.value}
            </section>
            `
          )}
        </vscode-tabs>
      `

    case `input`:
      return `
      <vscode-form-item>
          <vscode-form-label>${this.label}</vscode-form-label>
          ${this.description ? `<vscode-form-description>${this.description}</vscode-form-description>` : ``}
          <vscode-form-control>
              <vscode-inputbox id="${this.id}" name="${this.id}" ${this.default ? `value="${this.default}"` : ``} ${this.readonly ? `readonly` : ``} ${this.multiline ? `multiline` : ``}></vscode-inputbox>
          </vscode-form-control>
      </vscode-form-item>
      `;
      
    case `paragraph`:
      return `
      <vscode-form-item>
          <vscode-form-description>${this.label}</vscode-form-description>
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

    case `tree`:
      return `
      <vscode-form-item>
          <vscode-form-label>${this.label}</vscode-form-label>
          ${this.description ? `<vscode-form-description>${this.description}</vscode-form-description>` : ``}
          <vscode-form-control>
              <vscode-tree id="${this.id}"></vscode-tree>
          </vscode-form-control>
      </vscode-form-item>
      `;

    case `select`:
      return `
      <vscode-form-item>
          <vscode-form-label>${this.label}</vscode-form-label>
          ${this.description ? `<vscode-form-description>${this.description}</vscode-form-description>` : ``}
          <vscode-form-control>
              <vscode-single-select id="${this.id}">
                  ${this.items.map(item => `<vscode-option ${item.selected ? `selected` : ``} value="${item.value}" description="${item.text}">${item.description}</vscode-option>`)}
              </vscode-single-select>
          </vscode-form-control>
      </vscode-form-item>
      `

    }
  }
}

module.exports = {CustomUI, Field};