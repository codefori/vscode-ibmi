/* eslint-disable indent */
import vscode from 'vscode';

//Webpack is returning this as a string
const vscodeweb = require(`@bendera/vscode-webview-elements/dist/bundled`);

export interface Page<T> {
  panel: vscode.WebviewPanel
  data?: T
}

export interface Button {
  id: string
  label: string
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

  addInput(id: string, label: string, description?: string, options?: { default?: string, readonly?: boolean, multiline?: boolean }) {
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

  addButtons(...buttons: Button[]) {
    const buttonsField = new Field('buttons', '', '');
    buttonsField.items = buttons.filter(b => b);
    this.addField(buttonsField);
    return this;
  }

  addField(field: Field) {
    switch (field.type) {
      case `submit`:
        console.warn(`Submit fields are no longer supported. Consider using buttons instead.`);
        break;
    }

    this.fields.push(field);
    return this;
  }
}

export class CustomUI extends Section {
  /**
   * If no callback is provided, a Promise will be returned
   * @param title 
   * @param callback
   * @returns a Promise<Page<T>> if no callback is provided
   */
  loadPage<T>(title: string, callback?: (page: Page<T>) => void): Promise<Page<T>> | undefined {
    const panel = vscode.window.createWebviewPanel(
      `custom`,
      title,
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true
      }
    );

    panel.webview.html = this.getHTML(panel, title);

    let didSubmit = false;

    if (callback) {
      panel.webview.onDidReceiveMessage(
        message => {
          didSubmit = true;
          callback({ panel, data: message });
        }
      );

      panel.onDidDispose(() => {
        if (!didSubmit) callback({ panel });
      });

    } else {
      return new Promise((resolve) => {
        panel.webview.onDidReceiveMessage(
          message => {
            didSubmit = true;
            resolve({ panel, data: message });
          }
        );

        panel.onDidDispose(() => {
          if (!didSubmit) resolve({ panel });
        });
      });
    }
  }

  private getHTML(panel: vscode.WebviewPanel, title: string) {
    const submitButton = this.fields.find(field => field.type === `submit`) || { id: `` };

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
                padding-left: 15%;
                padding-right: 15%;
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
            const groupButtons = [${[...(allFields.filter(field => field.type == `buttons`).map(field => field.items?.map(item => `'${item.id}'`)))].join(`, `)}];

            // Available trees in the fields, though only one is supported.
            const trees = [${trees.map(field => `'${field.id}'`).join(`,`)}];

            // Fields which required a file path
            const filefields = [${allFields.filter(field => field.type == `file`).map(field => `'${field.id}'`).join(`,`)}];

            // Fields that have value which can be returned
            const submitfields = [${allFields.filter(field => !notInputFields.includes(field.type)).map(field => `'${field.id}'`).join(`,`)}];
    
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

export type FieldType = "input" | "password" | "submit" | "buttons" | "checkbox" | "file" | "complexTabs" | "tabs" | "tree" | "select" | "paragraph" | "hr";

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
  public multiline?: boolean;

  constructor(readonly type: FieldType, readonly id: string, readonly label: string, readonly description?: string) {

  }

  getHTML(): string {
    this.default = typeof this.default === `string` ? this.default.replace(/"/g, `&quot;`) : undefined;

    switch (this.type) {
      case `submit`:
        return /* html */`<vscode-button id="${this.id}">${this.label}</vscode-button>`;

      case `buttons`:
        return /* html */`
          <vscode-form-item>
            ${this.items?.map(item => /* html */`<vscode-button id="${item.id}" style="margin:3px">${item.label}</vscode-button>`).join(``)}
          </vscode-form-item>`;

      case `hr`:
        return /* html */ `<hr />`;

      case `checkbox`:
        return /* html */`
          <vscode-form-item>
            <vscode-form-control>
            <vscode-checkbox id="${this.id}" ${this.default === `checked` ? `checked` : ``}>${this.label}</vscode-checkbox>
            ${this.renderDescription()}
            </vscode-form-control>
          </vscode-form-item>`;

      case `tabs`:
        return /* html */`
          <vscode-tabs selectedIndex="${this.default || 0}">
            ${this.items?.map(item =>
              /* html */`
              <header slot="header">${item.label}</header>
              <section>
                ${item.value}
              </section>`
        ).join(``)}
          </vscode-tabs>`;

      case `complexTabs`:
        return /* html */`
          <vscode-tabs selectedIndex="${this.default || 0}">
            ${this.complexTabItems?.map(item =>
              /* html */`
              <header slot="header">${item.label}</header>
              <section>
              ${item.fields.map(field => field.getHTML()).join(` `)}
              </section>`
        ).join(``)}
          </vscode-tabs>`;

      case `input`:
        return /* html */`
          <vscode-form-item>
              ${this.renderLabel()}
              ${this.renderDescription()}
              <vscode-form-control>
                  <vscode-inputbox class="long-input" id="${this.id}" name="${this.id}" ${this.default ? `value="${this.default}"` : ``} ${this.readonly ? `readonly` : ``} ${this.multiline ? `multiline` : ``}></vscode-inputbox>
              </vscode-form-control>
          </vscode-form-item>`;

      case `paragraph`:
        return /* html */`
          <vscode-form-item>
              <vscode-form-description>${this.label}</vscode-form-description>
          </vscode-form-item>`;

      case `file`:
        return /* html */`
          <vscode-form-item>
              ${this.renderLabel()}
              ${this.renderDescription()}
              <vscode-form-control>
                  <vscode-inputbox type="file" id="${this.id}" name="${this.id}"></vscode-inputbox>
              </vscode-form-control>
          </vscode-form-item>`;

      case `password`:
        return /* html */`
          <vscode-form-item>
              ${this.renderLabel()}
              ${this.renderDescription()}
              <vscode-form-control>
                  <vscode-inputbox type="password" id="${this.id}" name="${this.id}" ${this.default ? `value="${this.default}"` : ``}></vscode-inputbox>
              </vscode-form-control>
          </vscode-form-item>`;

      case `tree`:
        return /* html */`
          <vscode-form-item>
              ${this.renderLabel()}
              ${this.renderDescription()}
              <vscode-form-control>
                  <vscode-tree id="${this.id}"></vscode-tree>
              </vscode-form-control>
          </vscode-form-item>`;

      case `select`:
        return /* html */`
          <vscode-form-item>
              ${this.renderLabel()}
              ${this.renderDescription()}
              <vscode-form-control>
                  <vscode-single-select id="${this.id}">
                      ${this.items?.map(item => /* html */`<vscode-option ${item.selected ? `selected` : ``} value="${item.value}" description="${item.text}">${item.description}</vscode-option>`)}
                  </vscode-single-select>
              </vscode-form-control>
          </vscode-form-item>`;
    }
  }

  private renderLabel() {
    return /* html */ `<vscode-form-label>${this.label}</vscode-form-label>`;
  }

  private renderDescription() {
    return this.description ? /* html */ `<vscode-form-description>${this.description}</vscode-form-description>` : ``;
  }
}