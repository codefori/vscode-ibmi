import * as vscode from "vscode";
import IBMi from "../../api/IBMi";

type HeldLock = {
  connection: IBMi;
  releaseCommand: string;
};

export class MemberLockManager implements vscode.Disposable {
  private readonly locks = new Map<string, HeldLock>();
  private readonly acquiring = new Map<string, Promise<void>>();

  constructor(context: vscode.ExtensionContext) {
    context.subscriptions.push(vscode.window.tabGroups.onDidChangeTabs(event => {
      for (const tab of event.closed) {
        if (!(tab.input instanceof vscode.TabInputText) || tab.input.uri.scheme !== "member") continue;
        this.releaseWhenLastEditorCloses(tab.input.uri);
      }
    }), vscode.workspace.onDidCloseTextDocument(document => {
      if (document.uri.scheme === "member") {
        this.releaseWhenLastEditorCloses(document.uri);
      }
    }), this);
  }

  async acquire(uri: vscode.Uri, connection: IBMi): Promise<void> {
    const key = uri.toString();
    if (this.locks.has(key)) return;

    const pending = this.acquiring.get(key);
    if (pending) return pending;

    const acquisition = this.acquireLock(key, uri, connection);
    this.acquiring.set(key, acquisition);
    try {
      await acquisition;
    } finally {
      this.acquiring.delete(key);
    }
  }

  private async acquireLock(key: string, uri: vscode.Uri, connection: IBMi): Promise<void> {
    const path = connection.parserMemberPath(uri.path);
    const object = `${path.library}/${path.file} *FILE`;
    const member = path.name;
    const acquireCommand = `ALCOBJ OBJ((${object} *EXCLRD ${member})) WAIT(0)`;
    await connection.runSQL(`@${acquireCommand}`);
    this.locks.set(key, { connection, releaseCommand: `DLCOBJ OBJ((${object} *EXCLRD ${member}))` });
  }

  isLocked(uri: vscode.Uri, connection: IBMi): boolean {
    return this.locks.get(uri.toString())?.connection === connection;
  }

  async release(uri: vscode.Uri): Promise<void> {
    const lock = this.locks.get(uri.toString());
    if (!lock) return;

    this.locks.delete(uri.toString());
    try {
      await lock.connection.runSQL(`@${lock.releaseCommand}`);
    } catch {
      // Ending the Mapepire job also releases its allocations.
    }
  }

  async releaseAll(): Promise<void> {
    await Promise.all([...this.locks.keys()].map(uri => this.release(vscode.Uri.parse(uri))));
  }

  private releaseWhenLastEditorCloses(uri: vscode.Uri): void {
    const isStillOpen = vscode.window.tabGroups.all
      .flatMap(group => group.tabs)
      .some(tab => tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === uri.toString());
    if (!isStillOpen) {
      void this.release(uri);
    }
  }

  dispose(): void {
    void this.releaseAll();
  }
}