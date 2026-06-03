"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CustomEditorProvider = exports.CustomEditor = void 0;
const vscode_1 = __importDefault(require("vscode"));
const CustomUI_1 = require("../webviews/CustomUI");
const customEditors = new Map;
class CustomEditor extends CustomUI_1.CustomHTML {
    onSave;
    onClosed;
    uri;
    data = {};
    valid;
    dirty = false;
    constructor(target, onSave, onClosed) {
        super();
        this.onSave = onSave;
        this.onClosed = onClosed;
        this.uri = vscode_1.default.Uri.from({ scheme: "code4i", path: `/${target}` });
    }
    getSpecificScript() {
        return /* javascript */ `
      for (const field of submitfields) {
        const fieldElement = document.getElementById(field);
        fieldElement.addEventListener(inputFields.some(f => f.id === field) ? 'input' : 'change', function(event) {
          event?.preventDefault();
          const data = document.querySelector('#laforma').data;
          for (const checkbox of checkboxes) {
            data[checkbox] = data[checkbox]?.length >= 1;
          }

          data.valid = validateInputs();

          vscode.postMessage({ type: 'dataChange', data });
        });        
      }
    `;
    }
    open() {
        customEditors.set(this.uri.toString(), this);
        vscode_1.default.commands.executeCommand("vscode.open", this.uri);
    }
    load(webviewPanel) {
        const webview = webviewPanel.webview;
        webview.options = {
            enableScripts: true,
            enableCommandUris: true
        };
        webview.html = this.getHTML(webviewPanel, this.uri.path);
    }
    onDataChange(data) {
        this.dirty = true;
        this.valid = data.valid;
        delete data.valid;
        this.data = data;
    }
    async save() {
        await this.onSave(this.data);
    }
    dispose() {
        this.onClosed?.();
    }
}
exports.CustomEditor = CustomEditor;
class CustomEditorProvider {
    eventEmitter = new vscode_1.default.EventEmitter();
    onDidChangeCustomDocument = this.eventEmitter.event;
    async saveCustomDocument(document, cancellation) {
        if (document.dirty) {
            if (document.valid) {
                await document.save();
                document.dirty = false;
            }
            else {
                throw new Error("Can't save: some inputs are invalid");
            }
        }
    }
    async openCustomDocument(uri, openContext, token) {
        const customEditor = customEditors.get(uri.toString());
        if (customEditor) {
            customEditors.delete(uri.toString());
            return customEditor;
        }
        else {
            //Fail safe: do not fail, return an empty editor asking to reopen the editor
            //Throwing an error here prevents that URI to be opened until the editor is closed and VS Code is restarted
            return new CustomEditor(uri.path.substring(1), async () => { }).addHeading("Please close this editor and re-open it.", 3);
        }
    }
    async resolveCustomEditor(document, webviewPanel, token) {
        document.load(webviewPanel);
        webviewPanel.webview.onDidReceiveMessage(async (body) => {
            if (body.type === "dataChange") {
                document.onDataChange(body.data);
                this.eventEmitter.fire({
                    document,
                    redo: () => { throw new Error("Redo not supported."); },
                    undo: () => { throw new Error("Undo not supported."); }
                });
            }
        });
    }
    saveCustomDocumentAs(document, destination, cancellation) {
        throw new Error("Save As is not supported.");
    }
    revertCustomDocument(document, cancellation) {
        throw new Error("Revert is not supported.");
    }
    backupCustomDocument(document, context, cancellation) {
        throw new Error("Backup is not supported.");
    }
}
exports.CustomEditorProvider = CustomEditorProvider;
//# sourceMappingURL=customEditorProvider.js.map