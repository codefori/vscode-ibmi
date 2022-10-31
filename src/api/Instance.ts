import * as vscode from "vscode";
import IBMi from "./IBMi";
import IBMiContent from "./IBMiContent";
import {Storage} from "./Storage";

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
    getConfig () {
      return this.connection?.config;
    }
    getContent () {
      return this.content;
    }
    getStorage () {
      return this.storage;
    }
  };