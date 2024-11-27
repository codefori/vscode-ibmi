import vscode from "vscode";
import IBMi from "../api/IBMi";
import { ComponentState, IBMiComponent, IBMiComponentType } from "./component";

export class ComponentRegistry {
  private readonly components: Map<string, (IBMiComponentType<any>)[]> = new Map;

  public registerComponent(context: vscode.ExtensionContext, component: IBMiComponentType<any>) {
    const key = context.extension.id;
    const extensionComponents = this.components.get(key);
    if (extensionComponents) {
      extensionComponents.push(component);
    }
    else {
      this.components.set(key, [component]);
    }
  }

  public getComponents() {
    return this.components;
  }
}

export const extensionComponentRegistry = new ComponentRegistry();

export class ComponentManager {
  private readonly registered: Map<IBMiComponentType<any>, IBMiComponent> = new Map;

  constructor(private readonly connection: IBMi) {

  }

  public getState() {
    return Array.from(this.registered.keys()).map(k => {
      const comp = this.registered.get(k)!;
      return {
        id: comp.getIdentification(),
        state: comp.getState()
      }
    });
  }

  public async startup() {
    const components = Array.from(extensionComponentRegistry.getComponents().values()).flatMap(a => a.flat());
    for (const Component of components) {
      const comp: IBMiComponent = await new Component(this.connection);
      await comp.check();
      this.registered.set(Component, comp);
    }
  }

  get<T extends IBMiComponent>(type: IBMiComponentType<T>, ignoreState?: boolean): T | undefined {
    const component = this.registered.get(type);
    if (component && (ignoreState || component.getState() === `Installed`)) {
      return component as T;
    }
  }
}