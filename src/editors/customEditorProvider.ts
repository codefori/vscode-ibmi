import vscode from "vscode";
import { CustomHTML } from "../webviews/CustomUI";

const customEditors: Map<string, CustomEditor<any>> = new Map;
export class CustomEditor<T> extends CustomHTML implements vscode.CustomDocument {
  readonly uri: vscode.Uri;
  private data: T = {} as T;
  valid?: boolean;
  dirty = false;
  private panel?: vscode.WebviewPanel;

  constructor(target: string, private readonly onSave: (data: T) => Promise<void>, private readonly onClosed?: () => void, private readonly onRevert?: () => Promise<void>) {
    super();
    this.uri = vscode.Uri.from({ scheme: "code4i", path: `/${target}` });
  }

  protected getSpecificScript() {
    return /* javascript */ `
      const theForm = document.querySelector('#laforma');
      for (const field of submitfields) {
        const fieldElement = document.getElementById(field);
        fieldElement.addEventListener(inputFields.some(f => f.id === field) ? 'input' : 'change', function(event) {
          event?.preventDefault();
          const data = {};
          new FormData(theForm).entries().forEach(([key, value]) => data[key] = value);

          // Convert checkboxes value to actual boolean
          checkboxes.forEach(checkbox => data[checkbox] = (data[checkbox] === 'on'));

          data.valid = validateInputs();

          vscode.postMessage({ type: 'dataChange', data });
        });
      }

      //Prevent form from being submitted
      theForm.addEventListener("submit", (event) => event?.preventDefault());
    `;
  }

  open() {
    customEditors.set(this.uri.toString(), this);
    vscode.commands.executeCommand("vscode.open", this.uri);
  }

  load(webviewPanel: vscode.WebviewPanel) {
    this.panel = webviewPanel;
    const webview = webviewPanel.webview;
    webview.options = {
      enableScripts: true,
      enableCommandUris: true
    };

    webview.html = this.getHTML(webviewPanel, this.uri.path);
  }

  onDataChange(data: T & { valid?: boolean }) {
    this.dirty = true;
    this.valid = data.valid;
    delete data.valid;
    this.data = data;
  }

  async save() {
    await this.onSave(this.data);
  }

  async revert() {
    if (!this.onRevert) {
      throw new Error("Revert not supported.");
    }
    await this.onRevert();
  }

  /**
   * Replaces the editor's content: `build` adds the fields again and `data` is what they now hold.
   * @param dirty `true` to keep the document dirty, so the new content can be saved right away
   */
  rebuild(build: (editor: this) => void, data: T, dirty: boolean) {
    this.fields.length = 0;
    build(this);
    this.data = data;
    this.valid = true;
    this.dirty = dirty;
    if (this.panel) {
      this.panel.webview.html = this.getHTML(this.panel, this.uri.path);
    }
  }

  dispose() {
    this.onClosed?.();
  }
}

export class CustomEditorProvider implements vscode.CustomEditorProvider<CustomEditor<any>> {
  readonly eventEmitter = new vscode.EventEmitter<vscode.CustomDocumentEditEvent<CustomEditor<any>>>();
  readonly onDidChangeCustomDocument = this.eventEmitter.event;

  async saveCustomDocument(document: CustomEditor<any>, cancellation: vscode.CancellationToken) {
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

  async openCustomDocument(uri: vscode.Uri, openContext: vscode.CustomDocumentOpenContext, token: vscode.CancellationToken) {
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

  async resolveCustomEditor(document: CustomEditor<any>, webviewPanel: vscode.WebviewPanel, token: vscode.CancellationToken) {
    document.load(webviewPanel);
    webviewPanel.webview.onDidReceiveMessage(async body => {
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

  saveCustomDocumentAs(document: CustomEditor<any>, destination: vscode.Uri, cancellation: vscode.CancellationToken): Thenable<void> {
    throw new Error("Save As is not supported.");
  }
  async revertCustomDocument(document: CustomEditor<any>, cancellation: vscode.CancellationToken) {
    try {
      await document.revert();
    } catch (error: any) {
      // VS Code doesn't report a failed revert: without this, nothing would seem to happen
      vscode.window.showErrorMessage(String(error.message || error));
      throw error;
    }
  }
  backupCustomDocument(document: CustomEditor<any>, context: vscode.CustomDocumentBackupContext, cancellation: vscode.CancellationToken): Thenable<vscode.CustomDocumentBackup> {
    throw new Error("Backup is not supported.");
  }
}