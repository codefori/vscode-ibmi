import * as vscode from "vscode";
import { ConnectionData, IBMiEvent } from "../typings";
import { ConnectionConfiguration } from "./Configuration";
import IBMi, { ConnectionResult } from "./IBMi";
import { ConnectionStorage, GlobalStorage } from "./Storage";
import { Tools } from "./Tools";

type IBMiEventSubscription = {
  func: Function,
  transient?: boolean
};

type SubscriptionMap = Map<string, IBMiEventSubscription>

export interface ConnectionOptions {
  data: ConnectionData, 
  reconnecting?: boolean, 
  reloadServerSettings?: boolean, 
  onConnectedOperations?: Function[]
}

export default class Instance {
  private connection: IBMi | undefined;
  private storage: ConnectionStorage;
  private emitter: vscode.EventEmitter<IBMiEvent> = new vscode.EventEmitter();
  private subscribers: Map<IBMiEvent, SubscriptionMap> = new Map;

  private deprecationCount = 0; //TODO: remove in v3.0.0

  constructor(context: vscode.ExtensionContext) {
    this.storage = new ConnectionStorage(context);
    this.emitter.event(e => this.processEvent(e));
  }

  connect(options: ConnectionOptions): Promise<ConnectionResult> {
    const connection = new IBMi();

    let result: ConnectionResult;

    const timeoutHandler = async (conn: IBMi) => {
      if (conn) {
        const choice = await vscode.window.showWarningMessage(`Connection lost`, {
          modal: true,
          detail: `Connection to ${conn.currentConnectionName} has dropped. Would you like to reconnect?`
        }, `Yes`, `No, get logs`);

        let reconnect = choice === `Yes`;
        let collectLogs = choice === `No, get logs`;

        if (collectLogs) {
          const logs = conn.getOutputChannelContent();
          vscode.workspace.openTextDocument({ content: logs, language: `plaintext` }).then(doc => {
            vscode.window.showTextDocument(doc);
          });
        }

        this.disconnect();

        if (reconnect) {
          await this.connect({...options, reconnecting: true});
        }
      }
    };

    return Tools.withContext("code-for-ibmi:connecting", async () => {
      while (true) {
        try {
          result = await connection.connect(options.data, options.reconnecting, options.reloadServerSettings, options.onConnectedOperations || [], timeoutHandler);
        } catch (e: any) {
          result = { success: false, error: e.message };
        }

        if (result.success) {
          await this.setConnection(connection);
          break;

        } else {
          await this.disconnect();
          if (options.reconnecting && await vscode.window.showWarningMessage(`Could not reconnect`, {
            modal: true,
            detail: `Reconnection has failed. Would you like to try again?\n\n${result.error || `No error provided.`}`
          }, `Yes`)) {
            
            options.reconnecting = true;
            continue;

          } else {
            break;
          }
        }
      }

      if (result.success === false) {
        connection.dispose();
      }

      return result;
    });
  }

  async disconnect() {
    await this.setConnection();
      
    await Promise.all([
      vscode.commands.executeCommand("code-for-ibmi.refreshObjectBrowser"),
      vscode.commands.executeCommand("code-for-ibmi.refreshLibraryListView"),
      vscode.commands.executeCommand("code-for-ibmi.refreshIFSBrowser")
    ]);
  }

  private async setConnection(connection?: IBMi) {
    if (this.connection) {
      await this.connection.dispose();
    }

    if (connection) {
      connection.setDisconnectedCallback(async () => {
        this.setConnection();
        this.fire(`disconnected`);
      });

      this.connection = connection;
      this.storage.setConnectionName(connection.currentConnectionName);
      await GlobalStorage.get().setLastConnection(connection.currentConnectionName);
      this.fire(`connected`);
    }
    else {
      this.connection = undefined;
      this.storage.setConnectionName("");
    }

    await vscode.commands.executeCommand(`setContext`, `code-for-ibmi:connected`, connection !== undefined);
  }

  getConnection() {
    return this.connection;
  }

  async setConfig(newConfig: ConnectionConfiguration.Parameters) {
    if (this.connection) {
      this.connection.setConfig(newConfig);
    }
    await ConnectionConfiguration.update(newConfig);
  }

  /**
   * @deprecated Will be removed in `v3.0.0`; use {@link IBMi.getConfig()} instead
   */
  getConfig() {
    return this.connection?.getConfig();
  }

  /**
   * @deprecated Will be removed in `v3.0.0`; use {@link IBMi.getContent()} instead
   */
  getContent() {
    return this.connection?.getContent();
  }

  getStorage() {
    return this.storage.ready ? this.storage : undefined;
  }

  /**
   * Subscribe to an {@link IBMiEvent}. When the event is triggerred, the `func` function gets executed.
   * 
   * Each `context`/`name` couple must be unique.
   * @param context the extension subscribing to the event
   * @param event the {@link IBMiEvent} to subscribe to 
   * @param name a human-readable name summarizing the function   
   * @param func the function to execute when the {@link IBMiEvent} is triggerred
   * @param transient if `true`, the function will only be executed once during the lifetime of a connection
   */
  subscribe(context: vscode.ExtensionContext, event: IBMiEvent, name: string, func: Function, transient?: boolean) {
    this.getSubscribers(event).set(`${context.extension.id} - ${name}`, { func, transient });
  }

  private getSubscribers(event: IBMiEvent) {
    let eventSubscribers: SubscriptionMap = this.subscribers.get(event) || new Map;
    if (!this.subscribers.has(event)) {
      this.subscribers.set(event, eventSubscribers);
    }
    return eventSubscribers;
  }

  /**
   * @deprecated Will be removed in `v3.0.0`; use {@link subscribe} instead
   */
  onEvent(event: IBMiEvent, func: Function): void {
    this.getSubscribers(event).set(`deprecated - ${func.name || "unknown"}_${this.deprecationCount++}`, { func });
    console.warn("[Code for IBM i] Deprecation warning: you are using Instance::onEvent which is deprecated and will be removed in v3.0.0. Please use Instance::subscribe instead.");
  }

  fire(event: IBMiEvent) {
    this.emitter?.fire(event);
  }

  async processEvent(event: IBMiEvent) {
    const eventSubscribers = this.getSubscribers(event)
    console.time(event);
    for (const [identity, callable] of eventSubscribers.entries()) {
      try {
        console.time(identity);
        await callable.func();
        console.timeEnd(identity);
      }
      catch (error) {
        console.error(`${event} event function ${identity} failed`, error);
      }
      finally {
        if (callable.transient) {
          eventSubscribers.delete(identity);
        }
      }
    }
    console.timeEnd(event);
  }
}