import * as vscode from "vscode";
import { IBMiEvent } from "../typings";
import { ConnectionConfiguration } from "./Configuration";
import IBMi from "./IBMi";
import { ConnectionStorage, GlobalStorage } from "./Storage";

type IBMiEventSubscription = {
  func: Function,
  transient?: boolean
};

type SubscriptionMap = Map<string, IBMiEventSubscription>

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