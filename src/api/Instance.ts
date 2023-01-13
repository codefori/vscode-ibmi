import * as vscode from "vscode";
import IBMi from "./IBMi";
import IBMiContent from "./IBMiContent";
import {Storage} from "./Storage";
import { ConnectionConfiguration } from "./Configuration";

export default class Instance {
    connection: IBMi|undefined;
    content: IBMiContent|undefined;
    storage: Storage|undefined;
    emitter: vscode.EventEmitter<any>|undefined;
    events: {event: string, func: Function}[];

    constructor() {
        this.events = [];
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
    getContent () {
      return this.content;
    }
    getStorage () {
      return this.storage;
    }

    onEvent(event: "connected" | "disconnected", func: Function): void {
      this.events.push({event, func});
    }
  };