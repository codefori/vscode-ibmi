import IBMi from "../api/IBMi";
import { ComponentState, IBMiComponent, IBMiComponentType } from "./component";
import { CopyToImport } from "./copyToImport";
import { GetMemberInfo } from "./getMemberInfo";
import { GetNewLibl } from "./getNewLibl";

export class ComponentRegistry {
  private readonly allComponents: (IBMiComponentType<any>)[] = [GetNewLibl, CopyToImport, GetMemberInfo];

  public registerComponent(component: IBMiComponentType<any>) {
    this.allComponents.push(component);
  }

  public getComponents() {
    return this.allComponents;
  }
}

export const extensionComponentRegistry = new ComponentRegistry();

export class ComponentManager {
  private readonly registered: Map<IBMiComponentType<any>, IBMiComponent> = new Map;

  constructor(private readonly connection: IBMi) {

  }

  public async startup() {
    for (const Component of extensionComponentRegistry.getComponents()) {
      this.registered.set(Component, await new Component(this.connection).check());
    }
  }

  get<T extends IBMiComponent>(type: IBMiComponentType<T>): T | undefined {
    const component = this.registered.get(type);
    if (component && component.getState() === ComponentState.Installed) {
      return component as T;
    }
  }
}