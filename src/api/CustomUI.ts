/* eslint-disable indent */
import vscode from 'vscode';

//Webpack is returning this as a string
const vscodeweb = require(`@bendera/vscode-webview-elements/dist/bundled`);

type PanelOptions = {
  fullWidth?: boolean
};

export interface Page<T> {
  panel: vscode.WebviewPanel
  data?: T
}

export interface Button {
  id: string
  label: string
  requiresValidation?: boolean
}

export interface SelectItem {
  text: string
  description: string
  value: string
  selected?: boolean
}

export interface Tab {
  label: string
  value: string
}

export interface ComplexTab {
  label: string
  fields: Field[];
}

export class Section {
  readonly fields: Field[] = [];

  addHeading(label: string, level: 1 | 2 | 3 | 4 | 5 | 6 = 1) {
    this.addField(new Field(`heading`, level.toString(), label));
    return this;
  }

  addHorizontalRule() {
    this.addField(new Field('hr', '', ''));
    return this;
  }

  addCheckbox(id: string, label: string, description?: string, checked?: boolean) {
    const checkbox = new Field('checkbox', id, label, description);
    checkbox.default = checked ? 'checked' : '';
    this.addField(checkbox);
    return this;
  }

  addInput(id: string, label: string, description?: string, options?: { default?: string, readonly?: boolean, rows?: number, minlength?: number, maxlength?: number, regexTest?: string }) {
    const input = Object.assign(new Field('input', id, label, description), options);
    this.addField(input);
    return this;
  }

  addParagraph(label: string) {
    this.addField(new Field('paragraph', '', label));
    return this;
  }

  addFile(id: string, label: string, description?: string) {
    this.addField(new Field('file', id, label, description));
    return this;
  }

  addPassword(id: string, label: string, description?: string, defaultValue?: string) {
    const password = new Field('password', id, label, description);
    password.default = defaultValue;
    this.addField(password);
    return this;
  }

  addTabs(tabs: Tab[], selected?: number) {
    const tabsField = new Field('tabs', '', '');
    if (selected !== undefined) {
      tabsField.default = String(selected);
    }
    tabsField.items = tabs;
    this.addField(tabsField);
    return this;
  }

  addComplexTabs(tabs: ComplexTab[], selected?: number) {
    const tabsField = new Field('complexTabs', '', '');
    if (selected !== undefined) {
      tabsField.default = String(selected);
    }
    tabsField.complexTabItems = tabs;
    this.addField(tabsField);
    return this;
  }

  addSelect(id: string, label: string, items: SelectItem[], description?: string) {
    const select = new Field('select', id, label, description);
    select.items = items;
    this.addField(select);
    return this;
  }

  addTree(id: string, label: string, treeItems: TreeListItem[], description?: string) {
    const tree = new Field('tree', id, label, description);
    tree.treeList = treeItems;
    this.addField(tree);
    return this;
  }

  addButtons(...buttons: (Button | undefined)[]) {
    const buttonsField = new Field('buttons', '', '');
    buttonsField.items = [];
    buttons.filter(b => b).forEach(b => { if (b) buttonsField.items?.push(b); });
    this.addField(buttonsField);
    return this;
  }

  addField(field: Field) {
    this.fields.push(field);
    return this;
  }
}

const openedWebviews: Map<string, vscode.WebviewPanel> = new Map;

export class CustomUI extends Section {
  private options?: PanelOptions;
  /**
   * If no callback is provided, a Promise will be returned.
   * If the page is already opened, it grabs the focus and return no Promise (as it's alreay handled by the first call).
   * 
   * @param title 
   * @param callback
   * @returns a Promise<Page<T>> if no callback is provided
   */
  loadPage<T>(title: string, callback?: (page: Page<T>) => void): Promise<Page<T>> | undefined {
    const webview = openedWebviews.get(title);
    if (webview) {
      webview.reveal();
    }
    else {
      return this.createPage(title, callback);
    }
  }

  setOptions(options: PanelOptions) {
    this.options = options;
    return this;
  }

  private createPage<T>(title: string, callback?: (page: Page<T>) => void): Promise<Page<T>> | undefined {
    const panel = vscode.window.createWebviewPanel(
      `custom`,
      title,
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        enableFindWidget: true
      }
    );

    panel.webview.html = this.getHTML(panel, title);

    let didSubmit = false;

    openedWebviews.set(title, panel);

    if (callback) {
      panel.webview.onDidReceiveMessage(
        message => {
          didSubmit = true;
          callback({ panel, data: message });
        }
      );

      panel.onDidDispose(() => {
        openedWebviews.delete(title);
        if (!didSubmit) {
          callback({ panel });
        }        
      });
    } else {
      const page = new Promise<Page<T>>((resolve) => {
        panel.webview.onDidReceiveMessage(
          message => {
            didSubmit = true;
            resolve({ panel, data: message });
          }
        );

        panel.onDidDispose(() => {
          openedWebviews.delete(title);
          if (!didSubmit) {
            resolve({ panel });
          }
        });
      });

      return page;
    }
  }

  private getHTML(panel: vscode.WebviewPanel, title: string) {
    const notInputFields = [`submit`, `buttons`, `tree`, `hr`, `paragraph`, `tabs`, `complexTabs`];
    const trees = this.fields.filter(field => field.type == `tree`);

    const complexTabFields = this.fields.filter(field => field.type === `complexTabs`).map(tabs => tabs.complexTabItems?.map(tab => tab.fields));
    const allFields = [...this.fields, ...complexTabFields.flat(2)].filter(cField => cField) as Field[];

    return /*html*/`
    <!DOCTYPE html>
    <html lang="en">
    
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${title}</title>
    
        <script type="module">${vscodeweb}</script>
        <style>
            @media only screen and (min-width: 750px) {
              #laforma {
                padding-left: ${this.options?.fullWidth ? '0' : '15'}%;
                padding-right: ${this.options?.fullWidth ? '0' : '15'}%;
              }
            }

            #laforma {
                margin: 2em 2em 2em 2em;
            }

            vscode-tree {
              width: 100%;
            }

            .long-input {
              width: 100%;
            }

            :root{
              --dropdown-z-index: 666;
            }
        </style>
    </head>
    
    <body>
        <vscode-form-container id="laforma">
            ${this.fields.map(field => field.getHTML()).join(``)}
        </vscode-form-container>
    </body>
    
    <script>
        (function () {
            const vscode = acquireVsCodeApi();

            // New: many button that can be pressed to submit
            const groupButtons = ${JSON.stringify(allFields.filter(field => field.type == `buttons`).map(field => field.items).flat())};

            // Input fields that can be validated
            const inputFields = ${JSON.stringify(allFields.filter(field => field.type == `input`))};

            // Available trees in the fields, though only one is supported.
            const trees = [${trees.map(field => `'${field.id}'`).join(`,`)}];

            // Fields which required a file path
            const filefields = [${allFields.filter(field => field.type == `file`).map(field => `'${field.id}'`).join(`,`)}];

            // Fields which are checkboxes
            const checkboxes = [${allFields.filter(field => field.type == `checkbox`).map(field => `'${field.id}'`).join(`,`)}];

            // Fields that have value which can be returned
            const submitfields = [${allFields.filter(field => !notInputFields.includes(field.type)).map(field => `'${field.id}'`).join(`,`)}];

            const validateInputs = (optionalId) => {
              const testFields = optionalId ? inputFields.filter(theField => theField.id === optionalId) : inputFields

              let isValid = true;

              for (const field of testFields) {
                const fieldElement = document.getElementById(field.id);
                const currentValue = fieldElement.value || "";

                let isInvalid = false;

                if (field.minlength && currentValue.length < field.minlength) isInvalid = true;
                if (field.maxlength && currentValue.length > field.maxlength) isInvalid = true;
                if (field.regexTest) {
                  if (!(new RegExp(field.regexTest)).test(currentValue)) {
                    isInvalid = true;
                  }
                }

                if (isInvalid) {
                  fieldElement.setAttribute("invalid", "true");
                  isValid = false;
                } else {
                  fieldElement.removeAttribute("invalid");
                }
              }

              // If not validating a specific field, 
              // then we can enable/disable certain buttons
              if (!optionalId) {
                for (const fieldData of groupButtons) {
                  if (fieldData.requiresValidation) {
                    const field = fieldData.id;
                    
                    let button = document.getElementById(field);
                    if (isValid) {
                      button.removeAttribute("disabled");
                    } else {
                      button.setAttribute("disabled", "true");
                    }
                  }
                }
              }

              return isValid;
            }

    
            const doDone = (event, buttonId) => {
                console.log('submit now!!', buttonId)
                if (event)
                    event.preventDefault();
                    
                var data = document.querySelector('#laforma').data;

                if (buttonId) {
                  data['buttons'] = buttonId;
                }

                // Convert the weird array value of checkboxes to boolean
                for (const checkbox of checkboxes) {
                  data[checkbox] = (data[checkbox] && data[checkbox].length >= 1);
                }

                vscode.postMessage(data);
            };

            // Setup the input fields for validation
            for (const field of inputFields) {
              const fieldElement = document.getElementById(field.id);
              fieldElement.onkeyup = (e) => {validateInputs()};
            }

            // Now many buttons can be pressed to submit
            for (const fieldData of groupButtons) {
              const field = fieldData.id;
              
              console.log('group button', fieldData, document.getElementById(field));
              var button = document.getElementById(field);

              const submitButtonAction = (event) => {
                const isValid = fieldData.requiresValidation ? validateInputs() : true;
                console.log({requiresValidation: fieldData.requiresValidation, isValid});
                if (isValid) doDone(event, field);
              }

              button.onclick = submitButtonAction;
              button.onKeyDown = submitButtonAction;
            }

            for (const field of submitfields) {
                const currentElement = document.getElementById(field);
                if (currentElement.hasAttribute('rows')) {
                  currentElement
                    .addEventListener('keyup', function(event) {
                        event.preventDefault();
                        if (event.keyCode === 13 && event.altKey) {
                          if (validateInputs()) {
                            doDone();
                          }
                        }
                    });
                } else {
                  currentElement
                    .addEventListener('keyup', function(event) {
                        event.preventDefault();
                        if (event.keyCode === 13) {
                          if (validateInputs()) {
                            doDone();
                          }
                        }
                    });
                }
            }

            // This is used to read the file in order to get the real path.
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
              validateInputs(); 
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

export type FieldType = "input" | "password" | "buttons" | "checkbox" | "file" | "complexTabs" | "tabs" | "tree" | "select" | "paragraph" | "hr" | "heading";

export interface TreeListItemIcon {
  branch?: string;
  open?: string;
  leaf?: string;
}

export interface TreeListItem {
  label: string;
  subItems?: TreeListItem[];
  open?: boolean;
  selected?: boolean;
  focused?: boolean;
  icons?: TreeListItemIcon;
  value?: string;
  path?: number[];
}

export interface FieldItem {
  label?: string
  value?: string
  selected?: boolean
  description?: string
  text?: string
  id?: string
}

export class Field {
  public items?: FieldItem[];
  public treeList?: TreeListItem[];
  public complexTabItems?: ComplexTab[];
  public default?: string;
  public readonly?: boolean;
  public rows?: number;

  public minlength?: number;
  public maxlength?: number;
  public regexTest?: string;

  constructor(readonly type: FieldType, readonly id: string, readonly label: string, readonly description?: string) {

  }

  getHTML(): string {
    this.default = typeof this.default === `string` ? this.default.replace(/"/g, `&quot;`) : undefined;

    switch (this.type) {
      case `buttons`:
        return /* html */`
          <vscode-form-group variant="settings-group">
            ${this.items?.map(item => /* html */`<vscode-button id="${item.id}" style="margin:3px">${item.label}</vscode-button>`).join(``)}
          </vscode-form-group>`;

      case 'heading':
        return /* html */ `<h${this.id}>${this.label}</h${this.id}>`;

      case `hr`:
        return /* html */ `<hr />`;

      case `checkbox`:
        return /* html */`
          <vscode-form-group variant="settings-group">
            <vscode-checkbox id="${this.id}" name="${this.id}" ${this.default === `checked` ? `checked` : ``}><vscode-label>${this.label}</vscode-label></vscode-checkbox>
            ${this.renderDescription()}
          </vscode-form-group>`;

      case `tabs`:
        return /* html */`
          <vscode-tabs selected-index="${this.default || 0}">
            ${this.items?.map(item =>
              /* html */`
              <vscode-tab-header slot="header">${item.label}</vscode-tab-header>
              <vscode-tab-panel>
                ${item.value}
              </vscode-tab-panel>`
        ).join(``)}
          </vscode-tabs>`;

      case `complexTabs`:
        return /* html */`
          <vscode-tabs selected-index="${this.default || 0}">
            ${this.complexTabItems?.map(item =>
              /* html */`
              <vscode-tab-header slot="header">${item.label}</vscode-tab-header>
              <vscode-tab-panel>
              ${item.fields.map(field => field.getHTML()).join(` `)}
              </vscode-tab-panel>`
        ).join(``)}
          </vscode-tabs>`;

      case `input`:
        const multiline = (this.rows || 1) > 1;
        const tag = multiline ? "vscode-textarea" : "vscode-textfield";
        return /* html */`
          <vscode-form-group variant="settings-group">
              ${this.renderLabel()}
              ${this.renderDescription()}              
              <${tag} class="long-input" id="${this.id}" name="${this.id}" 
                ${this.default ? `value="${this.default}"` : ``} 
                ${this.readonly ? `readonly` : ``} 
                ${multiline ? `rows="${this.rows}" resize="vertical"` : ''}
                ${this.minlength ? `minlength="${this.minlength}"` : ``} 
                ${this.maxlength ? `maxlength="${this.maxlength}"` : ``}>
              /${tag}>
          </vscode-form-group>`;

      case `paragraph`:
        return /* html */`
          <vscode-form-group variant="settings-group">
              <vscode-form-helper>${this.label}</vscode-form-helper>
          </vscode-form-group>`;

      case `file`:
        return /* html */`
          <vscode-form-group variant="settings-group">
              ${this.renderLabel()}
              ${this.renderDescription()}
              <vscode-textfield type="file" id="${this.id}" name="${this.id}"></vscode-textfield>
          </vscode-form-group>`;

      case `password`:
        return /* html */`
          <vscode-form-group variant="settings-group">
              ${this.renderLabel()}
              ${this.renderDescription()}
              <vscode-textfield type="password" id="${this.id}" name="${this.id}" ${this.default ? `value="${this.default}"` : ``}></vscode-textfield>
          </vscode-form-group>`;

      case `tree`:
        return /* html */`
          <vscode-form-group variant="settings-group">
              ${this.renderLabel()}
              ${this.renderDescription()}
              <vscode-tree id="${this.id}"></vscode-tree>
          </vscode-form-group>`;

      case `select`:
        return /* html */`
          <vscode-form-group variant="settings-group">
              ${this.renderLabel()}
              ${this.renderDescription()}
              <vscode-single-select id="${this.id}" name="${this.id}">
                  ${this.items?.map(item => /* html */`<vscode-option ${item.selected ? `selected` : ``} value="${item.value}" description="${item.text}">${item.description}</vscode-option>`)}
              </vscode-single-select>
          </vscode-form-group>`;
    }
  }

  private renderLabel() {
    return /* html */ `<vscode-label>${this.label}</vscode-label>`;
  }

  private renderDescription() {
    return this.description ? /* html */ `<vscode-form-helper>${this.description}</vscode-form-helper>` : ``;
  }
}