import * as vscode from "vscode";
import IBMi from "./IBMi";
import IBMiContent from "./IBMiContent";
import { ConnectionConfiguration } from "./Configuration";
import { Instance, Parameters, Storage } from "../export/code-for-ibmi";
import IBMiImpl from "./IBMi";
import { StorageImpl } from "./Storage";

export default class InstanceImpl implements Instance {
  connection: IBMiImpl | undefined;
  content: IBMiContent | undefined;
  storage: StorageImpl | undefined;
  emitter: vscode.EventEmitter<any> | undefined;
  events: { event: string, func: Function }[];

  constructor() {
    this.events = [];
  }

  getConnection() {
    return this.connection;
  }

  async setConfig(newConfig: Parameters) {
    await ConnectionConfiguration.update(newConfig);
    if (this.connection) this.connection.config = newConfig;
  }
  getConfig(): Parameters | undefined {
    return this.connection?.config;
  }
  getContent() : IBMiContent | undefined {
    return this.content;
  }
  getStorage() {
    return this.storage;
  }

  onEvent(event: "connected", func: Function): void {
    this.events.push({event, func});
  }
};