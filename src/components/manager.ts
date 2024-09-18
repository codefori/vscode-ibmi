import IBMi from "../api/IBMi";
import { ComponentState, ComponentT } from "./component";
import { CopyToImport } from "./copyToImport";
import { GetMemberInfo } from "./getMemberInfo";
import { GetNewLibl } from "./getNewLibl";

export class ComponentRegistry {
  private readonly allComponents: (typeof ComponentT)[] = [GetNewLibl, CopyToImport, GetMemberInfo];

  public registerComponent(component: typeof ComponentT) {
    this.allComponents.push(component);
  }

  public getComponents() {
    return this.allComponents;
  }
}

export const extensionComponentRegistry = new ComponentRegistry();

export class ComponentManager {
  private readonly registered: Map<string, ComponentT> = new Map;

  public async startup(connection: IBMi) {
    for (const Component of extensionComponentRegistry.getComponents()) {
      const instance = new Component(connection);
      this.registered.set(Component.name, instance);
      await ComponentManager.checkState(instance);
    }
  }

  get<T>(id: string): T | undefined {
    const component = this.registered.get(id);
    if (component && component.getState() === ComponentState.Installed) {
      return component as T;
    }
  }

  private static async checkState(component: ComponentT) {
    try {
      await component.checkState();
    } catch (e) {
      console.log(component);
      console.log(`Error checking state for ${component.constructor.name}`, e);
    }
  }
}