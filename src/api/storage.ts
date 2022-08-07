import * as vscode from 'vscode';

export default class Storage {
  context: vscode.ExtensionContext;
  connectionName: string;

  constructor(context: vscode.ExtensionContext, connectionName: string) {
    this.context = context;
    this.connectionName = connectionName;
  }

  get(key: string) {
    const result = this.context.globalState.get(`${this.connectionName}.${key}`);
    return result || {};
  }

  set(key: string, value: string) {
    return this.context.globalState.update(`${this.connectionName}.${key}`, value);
  }
}