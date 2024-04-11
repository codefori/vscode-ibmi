import IBMi from "../api/IBMi";
import { GetNewLibl } from "./getNewLibl";

export enum ComponentState {
  NotChecked = `NotChecked`,
  NotInstalled = `NotInstalled`,
  Installed = `Installed`,
  Error = `Error`,
}

export type ComponentIds = `GetNewLibl`;

export class ComponentManager {
  private GetNewLibl: GetNewLibl|undefined;

  public async startup(connection: IBMi) {
    this.GetNewLibl = new GetNewLibl(connection);
    await this.GetNewLibl.install();
  }

  get<T>(id: ComponentIds): T|undefined {
    const component = this[id as keyof ComponentManager] as unknown as ComponentT;
    if (component.getState() === ComponentState.Installed) {
      return component as T;
    }
  }
}

export abstract class ComponentT {
  public state: ComponentState = ComponentState.NotChecked;
  public installedVersion: number = 0;

  constructor(public connection: IBMi) { }

  abstract install(): Promise<boolean>
  abstract getState(): ComponentState;
}