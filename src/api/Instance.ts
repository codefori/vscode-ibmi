import * as vscode from "vscode";
import { IBMiEvent } from "../typings";
import { ConnectionConfiguration } from "./Configuration";
import IBMi from "./IBMi";
import { ConnectionStorage, GlobalStorage } from "./Storage";

export default class Instance {
  private connection: IBMi | undefined;
  private storage: ConnectionStorage;
  private emitter: vscode.EventEmitter<IBMiEvent> = new vscode.EventEmitter();
  private events: { event: IBMiEvent, func: Function }[] = [];

  constructor(context: vscode.ExtensionContext) {
    this.events = [];
    this.storage = new ConnectionStorage(context);
    this.emitter.event(e => {
      this.events.filter(event => event.event === e)
        .forEach(event => event.func());
    })
  }

  async setConnection(connection?: IBMi) {
    if (connection) {
      this.connection = connection;
      this.storage.setConnectionName(connection.currentConnectionName);
      await GlobalStorage.get().setLastConnection(connection.currentConnectionName);
    }
    else {
      this.connection = undefined;
      this.storage.setConnectionName("");
    }
  }

  getConnection() {
    return this.connection;
  }

  async setConfig(newConfig: ConnectionConfiguration.Parameters) {
    if (this.connection) {
      this.connection.config = newConfig;
    }
    await ConnectionConfiguration.update(newConfig);
  }

  getConfig() {
    return this.connection?.config;
  }

  getContent() {
    return this.connection?.content;
  }

  getStorage() {
    return this.storage.ready ? this.storage : undefined;
  }

  onEvent(event: IBMiEvent, func: Function): void {
    this.events.push({ event, func });
  }

  fire(event: IBMiEvent) {
    this.emitter?.fire(event);
  }
}