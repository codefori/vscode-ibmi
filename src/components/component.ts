import IBMi from "../api/IBMi";
import { CopyToImport } from "./copyToImport";
import { GetMemberInfo } from "./getMemberInfo";
import { GetNewLibl } from "./getNewLibl";

export enum ComponentState {
  NotChecked = `NotChecked`,
  NotInstalled = `NotInstalled`,
  Installed = `Installed`,
  Error = `Error`,
}
interface ComponentRegistry {
  GetNewLibl?: GetNewLibl;
  CopyToImport?: CopyToImport;
  GetMemberInfo?: GetMemberInfo;
}

export type ComponentId = keyof ComponentRegistry;

export abstract class ComponentT {
  public state: ComponentState = ComponentState.NotChecked;
  public currentVersion: number = 0;

  constructor(public connection: IBMi) { }

  abstract getInstalledVersion(): Promise<number | undefined>;
  abstract checkState(): Promise<boolean>
  abstract getState(): ComponentState;
}

export class ComponentManager {
  private registered: ComponentRegistry = {};

  public async startup(connection: IBMi) {
    this.registered.GetNewLibl = new GetNewLibl(connection);
    await ComponentManager.checkState(this.registered.GetNewLibl);

    this.registered.CopyToImport = new CopyToImport(connection);
    await ComponentManager.checkState(this.registered.CopyToImport);

    this.registered.GetMemberInfo = new GetMemberInfo(connection);
    await ComponentManager.checkState(this.registered.GetMemberInfo);
  }

  // TODO: return type based on ComponentIds
  get<T>(id: ComponentId): T | undefined {
    const component = this.registered[id];
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