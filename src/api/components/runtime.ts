import IBMi from "../IBMi";
import { ComponentState, IBMiComponent } from "./component";

export class IBMiComponentRuntime {
  public static readonly InstallDirectory = `$HOME/.vscode/`;
  private state: ComponentState = `NotChecked`;
  private cachedInstallDirectory: string | undefined;

  constructor(protected readonly connection: IBMi, readonly component: IBMiComponent) {}

  async getInstallDirectory() {
    if (!this.cachedInstallDirectory) {
      const result = await this.connection.sendCommand({
        command: `echo "${IBMiComponentRuntime.InstallDirectory}"`,
      });

      this.cachedInstallDirectory = result.stdout.trim() || `/home/${this.connection.currentUser.toLowerCase()}/.vscode/`;
    }

    return this.cachedInstallDirectory;
  }

  getState() {
    return this.state;
  }

  setState(newState: ComponentState) {
    this.state = newState;
    return IBMi.GlobalStorage.storeComponentState(this.connection.currentConnectionName, {id: this.component.getIdentification(), state: newState});
  }

  async overrideState(newState: ComponentState) {
    const installDir = await this.getInstallDirectory();
    await this.component.setInstallDirectory?.(installDir);
    await this.setState(newState);
  }
  
  async update(installDirectory: string) {
    const newState = await this.component.update(this.connection, installDirectory);
    await this.setState(newState);
  }

  async startupCheck() {
    try {
      const installDirectory = await this.getInstallDirectory();
      const newState = await this.component.getRemoteState(this.connection, installDirectory);
      await this.setState(newState);
      if (newState !== `Installed` && !this.component.getIdentification().userManaged) {
        this.update(installDirectory);
      }
    }
    catch (error) {
      console.log(`Error occurred while checking component ${this.toString()}`);
      console.log(error);

      this.state = `Error`;
      this.setState(this.state);
    }

    return this;
  }

  toString() {
    const identification = this.component.getIdentification();
    return `${identification.name} (version ${identification.version})`
  }
}