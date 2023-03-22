import * as vscode from "vscode";
import IBMi from "./IBMi";
import IBMiContent from "./IBMiContent";
import { ConnectionStorage, GlobalStorage } from "./Storage";
import { ConnectionConfiguration } from "./Configuration";
import { IBMiEvent } from "../typings";

export default class Instance {
  private connection: IBMi | undefined;
  private content: IBMiContent | undefined;
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
      this.content = new IBMiContent(connection);
      await GlobalStorage.get().setLastConnection(connection.currentConnectionName);
    }
    else {
      this.connection = undefined;
      this.content = undefined;
      this.storage.setConnectionName("");
    }
  }

  getConnection() {
    return this.connection;
  }

  async setConfig(newConfig: ConnectionConfiguration.Parameters) {
    await ConnectionConfiguration.update(newConfig);
    if (this.connection) this.connection.config = newConfig;
  }

  getConfig() {
    return this.connection?.config;
  }

  getContent() {
    return this.content;
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