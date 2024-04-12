import IBMi from "../api/IBMi";
import { GetNewLibl } from "./getNewLibl";
import { SqlToCsv } from "./sqlToCsv";

export enum ComponentState {
  NotChecked = `NotChecked`,
  NotInstalled = `NotInstalled`,
  Installed = `Installed`,
  Error = `Error`,
}

export type ComponentIds = `GetNewLibl`|`SqlToCsv`;

export class ComponentManager {
  private GetNewLibl: GetNewLibl | undefined;
  private SqlToCsv: SqlToCsv | undefined;

  public async startup(connection: IBMi) {
    this.GetNewLibl = new GetNewLibl(connection);
    await this.GetNewLibl.checkState();

    this.SqlToCsv = new SqlToCsv(connection);
    await this.SqlToCsv.checkState();
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
  public currentVersion: number = 0;

  constructor(public connection: IBMi) { }

  abstract getInstalledVersion(): Promise<number | undefined>;
  abstract checkState(): Promise<boolean>
  abstract getState(): ComponentState;
}