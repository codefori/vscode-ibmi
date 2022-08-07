/* eslint-disable indent */
import * as vscode from 'vscode';

//Webpack is returning this as a string
const vscodeweb = require(`@bendera/vscode-webview-elements/dist/bundled`);

export enum FieldType {
  input,
  password,
  submit,
  buttons,
  checkbox,
  file,
  tabs,
  tree,
  select,
  paragraph,
  hr
}

export class CustomUI {
  fields: Field[];
  constructor() {
    /** @type {Field[]} */
    this.fields = [];
  }

  addField(field: Field) {
    switch (field.type) {
      case FieldType.submit:
        console.warn(`Submit fields are no longer supported. Consider using buttons instead.`);
        break;
    }

    this.fields.push(field);
  };

  /**
   * If no callback is provided, a Promise will be returned
   * @returns {Promise<{panel: vscode.WebviewPanel, data: object}>}
   */
  loadPage(title: string, callback?: any): Promise<{panel: vscode.WebviewPanel, data?: {[name: string]: string}}>|void {
    const panel = vscode.window.createWebviewPanel(
      `custom`,
      title,
      vscode.ViewColumn.Beside,
      {
        enableScripts: true
      }
    );

    panel.webview.html = this.getHTML();

    let didSubmit = false;

    if (callback) {
      panel.webview.onDidReceiveMessage(
        (message: any) => {
          didSubmit = true;
          callback({panel, data: message});
        }
      );
  
      panel.onDidDispose(() => {
        if (!didSubmit) {
          callback({panel, data: null});
        };
      });

    } else {
      return new Promise((resolve, reject) => {
        panel.webview.onDidReceiveMessage(
          (message: any) => {
            didSubmit = true;
            resolve({panel, data: message});
          }
        );
    
        panel.onDidDispose(() => {
          if (!didSubmit) {
            resolve({panel});
          };
        });
      });
    }
  }

  getHTML() {
    const submitButton = this.fields.find(field => field.type === FieldType.submit) || {id: ``};

    const notInputFields = [FieldType.submit, FieldType.buttons, FieldType.tree, FieldType.hr, FieldType.paragraph, FieldType.tabs];
    const trees = this.fields.filter(field => field.type === FieldType.tree);

    return /*html*/`
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
              width: 100%;
            }

            .long-input {
              width: 100%;
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
            const groupButtons = [${[...(this.fields.filter(field => field.type === FieldType.buttons).map(field => field.items ? field.items.map(item => `'${item.id}'`) : []))].join(`, `)}];

            // Available trees in the fields, though only one is supported.
            const trees = [${trees.map(field => `'${field.id}'`).join(`,`)}];

            // Fields which required a file path
            const filefields = [${this.fields.filter(field => field.type === FieldType.file).map(field => `'${field.id}'`).join(`,`)}];

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
                const currentElement = document.getElementById(field);
                if (currentElement.hasAttribute('multiline')) {
                  currentElement
                    .addEventListener('keyup', function(event) {
                        event.preventDefault();
                        if (event.keyCode === 13 && event.shiftKey) {
                          doDone();
                        }
                    });
                } else {
                  currentElement
                    .addEventListener('keyup', function(event) {
                        event.preventDefault();
                        if (event.keyCode === 13) {
                          doDone();
                        }
                    });
                }
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
                return /*js*/`
                  currentTree = document.getElementById('${tree.id}');
                  currentTree.data = ${JSON.stringify(tree.treeList)};
                  currentTree.addEventListener('vsc-select', (event) => {
                    console.log(JSON.stringify(event.detail));
                    if (event.detail.itemType === 'leaf') {
                      vscode.postMessage({'${tree.id}': event.detail.value});
                    }
                  });
                  `
              })}
            });

        }())
    </script>
    
    </html>`;
  }
}

interface Tab {
  label: string;
  value: string;
}

interface DropdownItem {
  selected?: boolean,
  value: string;
  description: string;
  text: string;
}

interface Button {
  id: string;
  label: string;
}

export class Field  {
  type: FieldType;
  id: string;
  label: string;
  description?: string;
  default?: string;
  readonly?: string;
  multiline?: boolean;
  items?: any[]|Tab[]|DropdownItem[]|Button[];
  treeList?: any;

  constructor(type: FieldType, id?: string, label?: string) {
    this.type = type;

    this.id = id || ``;

    this.label = label || ``;
    
    this.description = undefined;

    this.default = undefined;

    /** 
     * Used only for `input` type
    */
    this.readonly = undefined;

    /** 
     * Used only for `input` type
    */
    this.multiline = undefined;

    this.items = undefined;

    this.treeList = undefined;
  }

  from(object: Field) {
    this.type = object.type;
    this.id = object.id;
    this.description = object.description;
    this.default = object.default;
    this.readonly = object.readonly;
    this.multiline = object.multiline;
    this.items = object.items;
    this.treeList = object.treeList;
  }

  getHTML() {
    this.default = typeof this.default === `string` ? this.default.replace(/"/g, `&quot;`) : undefined;

    switch (this.type) {
    case FieldType.submit:
      return `<vscode-button id="${this.id}">${this.label}</vscode-button>`;

    case FieldType.buttons:
      if (this.items) {
        return `
          <vscode-form-item>
            ${this.items.map(item => `<vscode-button id="${item.id}" style="margin:3px">${item.label}</vscode-button>`).join(``)}
          </vscode-form-item>`;
      }
      break;

    case FieldType.hr:
      return `<hr />`;

    case FieldType.checkbox:
      return `
        <vscode-form-item>
          <vscode-form-control>
          <vscode-checkbox id="${this.id}" ${this.default === `checked` ? `checked` : ``}>${this.label}</vscode-checkbox>
          ${this.description ? `<vscode-form-description>${this.description}</vscode-form-description>` : ``}
          </vscode-form-control>
        </vscode-form-item>`;

    case FieldType.tabs:
      if (this.items) {
        return `
          <vscode-tabs selectedIndex="${this.default || 0}">
            ${this.items.map(item => 
              `
              <header slot="header">${item.label}</header>
              <section>
                ${item.value}
              </section>
              `
            ).join(``)}
          </vscode-tabs>
        `;
      }
      break;

    case FieldType.input:
      return `
      <vscode-form-item>
          <vscode-form-label>${this.label}</vscode-form-label>
          ${this.description ? `<vscode-form-description>${this.description}</vscode-form-description>` : ``}
          <vscode-form-control>
              <vscode-inputbox class="long-input" id="${this.id}" name="${this.id}" ${this.default ? `value="${this.default}"` : ``} ${this.readonly ? `readonly` : ``} ${this.multiline ? `multiline` : ``}></vscode-inputbox>
          </vscode-form-control>
      </vscode-form-item>
      `;
      
    case FieldType.paragraph:
      return `
      <vscode-form-item>
          <vscode-form-description>${this.label}</vscode-form-description>
      </vscode-form-item>
      `;
    case FieldType.file:
      return `
        <vscode-form-item>
            <vscode-form-label>${this.label}</vscode-form-label>
            ${this.description ? `<vscode-form-description>${this.description}</vscode-form-description>` : ``}
            <vscode-form-control>
                <vscode-inputbox type="file" id="${this.id}" name="${this.id}"></vscode-inputbox>
            </vscode-form-control>
        </vscode-form-item>
        `;
    case FieldType.password:
      return `
      <vscode-form-item>
          <vscode-form-label>${this.label}</vscode-form-label>
          ${this.description ? `<vscode-form-description>${this.description}</vscode-form-description>` : ``}
          <vscode-form-control>
              <vscode-inputbox type="password" id="${this.id}" name="${this.id}" ${this.default ? `value="${this.default}"` : ``}></vscode-inputbox>
          </vscode-form-control>
      </vscode-form-item>
      `;

    case FieldType.tree:
      return `
      <vscode-form-item>
          <vscode-form-label>${this.label}</vscode-form-label>
          ${this.description ? `<vscode-form-description>${this.description}</vscode-form-description>` : ``}
          <vscode-form-control>
              <vscode-tree id="${this.id}"></vscode-tree>
          </vscode-form-control>
      </vscode-form-item>
      `;

    case FieldType.select:
      if (this.items) {
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
          `;
      }

    }

    return ``;
  }
}