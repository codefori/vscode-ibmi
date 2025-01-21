import * as vscode from 'vscode';
import { BaseStorage } from '../api/configuration/storage/BaseStorage';

export class VsStorage extends BaseStorage {
  declare protected readonly globalState: vscode.Memento;
  private connectionName: string = "";

  constructor(context: vscode.ExtensionContext) {
    super(context.globalState);
    this.globalState = context.globalState;
  }
  public keys(): readonly string[] {
    return this.globalState.keys();
  }

  get<T>(key: string): T | undefined {
    return this.globalState.get(this.getStorageKey(key)) as T | undefined;
  }

  async set(key: string, value: any) {
    await this.globalState.update(this.getStorageKey(key), value);
  }
}