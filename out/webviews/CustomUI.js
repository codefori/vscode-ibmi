"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Field = exports.CustomUI = exports.CustomHTML = exports.Section = void 0;
/* eslint-disable indent */
const vscode_1 = __importDefault(require("vscode"));
//Webpack is returning this as a string
const vscodeweb = require(`@vscode-elements/elements/dist/bundled`);
class Section {
    fields = [];
    addHeading(label, level = 1) {
        this.addField(new Field(`heading`, level.toString(), label));
        return this;
    }
    addHorizontalRule() {
        this.addField(new Field('hr', '', ''));
        return this;
    }
    addCheckbox(id, label, description, checked) {
        const checkbox = new Field('checkbox', id, label, description);
        checkbox.default = checked ? 'checked' : '';
        this.addField(checkbox);
        return this;
    }
    addInput(id, label, description, options) {
        const input = Object.assign(new Field('input', id, label, description), options);
        this.addField(input);
        return this;
    }
    addParagraph(label) {
        this.addField(new Field('paragraph', '', label));
        return this;
    }
    addFile(id, label, description) {
        this.addField(new Field('file', id, label, description));
        return this;
    }
    addPassword(id, label, description, defaultValue) {
        const password = new Field('password', id, label, description);
        password.default = defaultValue;
        this.addField(password);
        return this;
    }
    addTabs(tabs, selected) {
        const tabsField = new Field('tabs', '', '');
        if (selected !== undefined) {
            tabsField.default = String(selected);
        }
        tabsField.items = tabs;
        this.addField(tabsField);
        return this;
    }
    addComplexTabs(tabs, selected) {
        const tabsField = new Field('complexTabs', '', '');
        if (selected !== undefined) {
            tabsField.default = String(selected);
        }
        tabsField.complexTabItems = tabs;
        this.addField(tabsField);
        return this;
    }
    addSelect(id, label, items, description, readonly) {
        const select = new Field('select', id, label, description);
        select.items = items;
        select.readonly = readonly;
        this.addField(select);
        return this;
    }
    addTree(id, label, treeItems, description, onClick = "submit") {
        const tree = new Field('tree', id, label, description);
        tree.treeLeafAction = onClick;
        tree.treeList = treeItems;
        this.addField(tree);
        return this;
    }
    addButtons(...buttons) {
        const buttonsField = new Field('buttons', '', '');
        buttonsField.items = [];
        buttons.filter(b => b).forEach(b => { if (b)
            buttonsField.items?.push(b); });
        this.addField(buttonsField);
        return this;
    }
    addField(field) {
        this.fields.push(field);
        return this;
    }
    addBrowser(id, items) {
        const browser = new Field('browser', id, '');
        browser.treeList = items;
        if (browser.treeList[0]) {
            browser.treeList[0].selected = true;
        }
        browser.treeLeafAction = 'browse';
        this.addField(browser);
        return this;
    }
}
exports.Section = Section;
const openedWebviews = new Map;
class CustomHTML extends Section {
    options;
    setOptions(options) {
        this.options = options;
        return this;
    }
    getSpecificScript() {
        return "";
    }
    getHTML(panel, title) {
        const notInputFields = [`submit`, `buttons`, `tree`, `hr`, `paragraph`, `tabs`, `complexTabs`, 'browser'];
        const trees = this.fields.filter(field => [`tree`, 'browser'].includes(field.type));
        const complexTabFields = this.fields.filter(field => field.type === `complexTabs`).map(tabs => tabs.complexTabItems?.map(tab => tab.fields));
        const allFields = [...this.fields, ...complexTabFields.flat(2)].filter(cField => cField);
        return /*html*/ `
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
                padding-left: ${this.options?.fullWidth || this.options?.fullPage ? '0' : '15'}%;
                padding-right: ${this.options?.fullWidth || this.options?.fullPage ? '0' : '15'}%;
              }
            }

            #laforma {
              margin: ${this.options?.fullPage ? /*css*/ "0" : "2em 2em 2em 2em"};
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

            vscode-split-layout {
              width: 100vw;
              height: 100vh;
            }

            [slot="start"],
            [slot="end"]{
              overflow: auto;
            }

            pre{              
              background-color: var(--vscode-textPreformat-background);
            }
            ${this.options?.css || ""}
        </style>
    </head>
    
    <body>
    ${this.options?.fullPage ?
            this.fields.map(field => field.getHTML()).join(``) :
            /* html */ `
      <vscode-form-container id="laforma">
        ${this.fields.map(field => field.getHTML()).join(``)}
      </vscode-form-container>
        `}        
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

            window.addEventListener('message', event => {
              const response = event.data;

              if (response.type === 'update') {
                const newValue = response.value;
                const field = document.getElementById(response.field);
                if (response.field && response.value) {
                  const field = document.getElementById(response.field);
                  if (field) {
                    field.value = newValue;
                    let innerInput = field.shadowRoot.querySelector("input");
                    if (innerInput) {
                      innerInput.value = newValue;
                    }
                  }
                  validateInputs(response.field);
                }              
              }
            });

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

                if(field.inputType === "number"){
                  const numberValue = Number(currentValue);
                  isInvalid = isNaN(numberValue) ||
                    (field.min !== undefined && numberValue < Number(field.min)) ||
                    (field.max !== undefined && numberValue > Number(field.max));
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

            const treeItemClick = (treeId, type, value) => {
              if(type === "browse"){
                const browseTarget = document.getElementById("browse_" + treeId);
                browseTarget.innerHTML = value;
              }
              else{
                vscode.postMessage({ type, data: {treeId, value} });
              }              
            }

            const doFileRequest = (event, fieldId) => {
                if (event)
                    event.preventDefault();

                vscode.postMessage({ type: 'file', data: {field: fieldId} });
            }

            // Setup the input fields for validation
            for (const field of inputFields) {
              const fieldElement = document.getElementById(field.id);
              fieldElement.addEventListener("change", (e) => validateInputs());
            }            

            // This is used to read the file in order to get the real path.
            for (const field of filefields) {
                let fileButton = document.getElementById(field + '-file');
                if (fileButton) {
                  fileButton.onclick = (event) => doFileRequest(event, field);
                }
            }

            document.addEventListener('DOMContentLoaded', () => {
              validateInputs(); 
              var currentTree;
              ${trees.map(tree => /*js*/ `
                currentTree = document.getElementById('${tree.id}');
                currentTree.data = ${JSON.stringify(tree.treeList)};
                currentTree.addEventListener('vsc-tree-select', (event) => {
                  console.log(JSON.stringify(event.detail));
                  if (event.detail.itemType === 'leaf') {
                    treeItemClick('${tree.id}', '${tree.treeLeafAction}', event.detail.value);                      
                  }
                });`)}
            });
            ${this.getSpecificScript()}
        }())
    </script>
    
    </html>`;
    }
}
exports.CustomHTML = CustomHTML;
class CustomUI extends CustomHTML {
    /**
     * If no callback is provided, a Promise will be returned.
     * If the page is already opened, it grabs the focus and return no Promise (as it's alreay handled by the first call).
     *
     * @param title
     * @param callback
     * @returns a Promise<Page<T>> if no callback is provided
     */
    loadPage(title) {
        const webview = openedWebviews.get(title);
        if (webview) {
            webview.reveal();
        }
        else {
            return this.createPage(title);
        }
    }
    createPage(title) {
        const panel = vscode_1.default.window.createWebviewPanel(`custom`, title, vscode_1.default.ViewColumn.One, {
            enableScripts: true,
            retainContextWhenHidden: true,
            enableFindWidget: true
        });
        panel.webview.html = this.getHTML(panel, title);
        let didSubmit = false;
        openedWebviews.set(title, panel);
        const page = new Promise((resolve) => {
            panel.webview.onDidReceiveMessage((message) => {
                if (message.type && message.data) {
                    switch (message.type) {
                        case `submit`:
                            didSubmit = true;
                            resolve({ panel, data: message.data });
                            break;
                        case `file`:
                            const resultField = message.data.field;
                            if (resultField) {
                                vscode_1.default.window.showOpenDialog({
                                    canSelectFiles: true,
                                    canSelectMany: false,
                                    canSelectFolders: false,
                                }).then(result => {
                                    if (result) {
                                        panel.webview.postMessage({ type: `update`, field: resultField, value: result[0].fsPath });
                                    }
                                });
                            }
                            break;
                    }
                }
            });
            panel.onDidDispose(() => {
                openedWebviews.delete(title);
                if (!didSubmit) {
                    resolve({ panel });
                }
            });
        });
        return page;
    }
    getSpecificScript() {
        return /* javascript */ `
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

        vscode.postMessage({ type: 'submit', data });
      };

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
    `;
    }
}
exports.CustomUI = CustomUI;
class Field {
    type;
    id;
    label;
    description;
    items;
    treeList;
    complexTabItems;
    default;
    readonly;
    rows;
    minlength;
    maxlength;
    regexTest;
    inputType;
    min;
    max;
    treeLeafAction;
    constructor(type, id, label, description) {
        this.type = type;
        this.id = id;
        this.label = label;
        this.description = description;
    }
    getHTML() {
        this.default = typeof this.default === `string` ? this.default.replace(/"/g, `&quot;`) : undefined;
        switch (this.type) {
            case `buttons`:
                return /* html */ `
          <vscode-form-group variant="settings-group">
            ${this.items?.map(item => /* html */ `<vscode-button id="${item.id}" style="margin:3px">${item.label}</vscode-button>`).join(``)}
          </vscode-form-group>`;
            case 'heading':
                return /* html */ `<h${this.id}>${this.label}</h${this.id}>`;
            case `hr`:
                return /* html */ `<hr />`;
            case `checkbox`:
                return /* html */ `
          <vscode-form-group variant="settings-group">
            <vscode-checkbox id="${this.id}" name="${this.id}" ${this.default === `checked` ? `checked` : ``} label="${this.label}" ${this.readonly ? `disabled` : ``}></vscode-checkbox>
            ${this.renderDescription()}
          </vscode-form-group>`;
            case `tabs`:
                return /* html */ `
          <vscode-tabs selected-index="${this.default || 0}">
            ${this.items?.map(item => 
                /* html */ `
              <vscode-tab-header slot="header">${item.label}</vscode-tab-header>
              <vscode-tab-panel>
                ${item.value}
              </vscode-tab-panel>`).join(``)}
          </vscode-tabs>`;
            case `complexTabs`:
                return /* html */ `
          <vscode-tabs selected-index="${this.default || 0}">
            ${this.complexTabItems?.map(item => 
                /* html */ `
              <vscode-tab-header slot="header">${item.label}</vscode-tab-header>
              <vscode-tab-panel>
              ${item.fields.map(field => field.getHTML()).join(` `)}
              </vscode-tab-panel>`).join(``)}
          </vscode-tabs>`;
            case `input`:
                const multiline = (this.rows || 1) > 1;
                const tag = multiline ? "vscode-textarea" : "vscode-textfield";
                return /* html */ `
          <vscode-form-group variant="settings-group">
              ${this.renderLabel()}
              ${this.renderDescription()}              
              <${tag} class="long-input" id="${this.id}" name="${this.id}" 
                ${this.inputType ? `type="${this.inputType}"` : ``} 
                ${this.default ? `value="${this.default}"` : ``} 
                ${this.readonly ? `readonly` : ``} 
                ${multiline ? `rows="${this.rows}" resize="vertical"` : ''}
                ${this.minlength ? `minlength="${this.minlength}"` : ``} 
                ${this.maxlength ? `maxlength="${this.maxlength}"` : ``}
                ${this.min ? `min="${this.min}"` : ``}
                ${this.max ? `max="${this.max}"` : ``}
                ${this.inputType === 'number' ? `step="1"` : ``}
                >
              <${tag}>
          </vscode-form-group>`;
            case `paragraph`:
                return /* html */ `
          <vscode-form-group variant="settings-group">
              <vscode-form-helper>${this.label}</vscode-form-helper>
          </vscode-form-group>`;
            case `file`:
                return /* html */ `
          <vscode-form-group variant="settings-group">
              ${this.renderLabel()}
              ${this.renderDescription()}
              <vscode-textfield type="input" id="${this.id}" name="${this.id}" ${this.default ? `value="${this.default}"` : ``} readonly></vscode-textfield>
              <br /><br />
              <vscode-button id="${this.id}-file" secondary>Select File</vscode-button>
          </vscode-form-group>`;
            case `password`:
                return /* html */ `
          <vscode-form-group variant="settings-group">
              ${this.renderLabel()}
              ${this.renderDescription()}
              <vscode-textfield type="password" id="${this.id}" name="${this.id}" ${this.default ? `value="${this.default}"` : ``}></vscode-textfield>
          </vscode-form-group>`;
            case `tree`:
                return /* html */ `
          <vscode-form-group variant="settings-group">
              ${this.renderLabel()}
              ${this.renderDescription()}
              <br />
              <vscode-tree id="${this.id}"></vscode-tree>
          </vscode-form-group>`;
            case `select`:
                return /* html */ `
          <vscode-form-group variant="settings-group">
              ${this.renderLabel()}
              ${this.renderDescription()}
              <vscode-single-select id="${this.id}" name="${this.id}" ${this.readonly ? `disabled` : ``}>
                  ${this.items?.map(item => /* html */ `<vscode-option ${item.selected ? `selected` : ``} value="${item.value}" description="${item.text}">${item.description}</vscode-option>`)}
              </vscode-single-select>
          </vscode-form-group>`;
            case `browser`:
                return /* html */ `
        <vscode-split-layout initial-handle-position="20%">
          <div slot="start"><vscode-tree id="${this.id}"></vscode-tree></div>
          <div slot="end"><div id="browse_${this.id}">${this.treeList?.at(0)?.value}</div></div>
      </vscode-split-layout>`;
        }
    }
    renderLabel() {
        return /* html */ `<vscode-label>${this.label}</vscode-label>`;
    }
    renderDescription() {
        return this.description ? /* html */ `<vscode-form-helper>${this.description}</vscode-form-helper>` : ``;
    }
}
exports.Field = Field;
//# sourceMappingURL=CustomUI.js.map