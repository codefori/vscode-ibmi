import * as vscode from "vscode";
import IBMi from "./IBMi";
import IBMiContent from "./IBMiContent";
import {ConnectionStorage} from "./Storage";
import { ConnectionConfiguration } from "./Configuration";
import { IBMiEvent } from "../typings";

export default class Instance {
    connection: IBMi|undefined;
    content: IBMiContent|undefined;
    storage: ConnectionStorage|undefined;
    emitter: vscode.EventEmitter<IBMiEvent>|undefined;
    events: {event: IBMiEvent, func: Function}[];

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

    onEvent(event: IBMiEvent, func: Function): void {
      this.events.push({event, func});
    }
  }