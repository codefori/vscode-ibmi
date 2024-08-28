import IBMi from "../api/IBMi";

export enum ComponentState {
  NotChecked = `NotChecked`,
  NotInstalled = `NotInstalled`,
  Installed = `Installed`,
  Error = `Error`,
}

export class ComponentT {
  public state: ComponentState = ComponentState.NotChecked;
  public currentVersion: number = 0;

  constructor(public connection: IBMi) { }

  async getInstalledVersion(): Promise<number | undefined> {return};
  async checkState(): Promise<boolean> {return false}
  getState(): ComponentState {return this.state};
}