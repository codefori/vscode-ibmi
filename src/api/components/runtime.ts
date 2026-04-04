import IBMi from "../IBMi";
import { ComponentState, IBMiComponent, SecureComponentState } from "./component";

export class IBMiComponentRuntime {
  public static readonly InstallDirectory = `$HOME/.vscode/`;
  private state: SecureComponentState = { status: `NotChecked`, remoteSignature: "" };
  private cachedInstallDirectory: string | undefined;

  constructor(protected readonly connection: IBMi, readonly component: IBMiComponent) { }

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

  setState(newState: SecureComponentState) {
    this.state = newState;
    return IBMi.GlobalStorage.storeComponentState(this.connection.currentConnectionName, { id: this.component.getIdentification(), state: newState });
  }

  async overrideState(newState: SecureComponentState) {
    const installDir = await this.getInstallDirectory();
    await this.component.setInstallDirectory?.(installDir);
    await this.setState(newState);
  }

  async update(installDirectory: string) {
    const newState = this.handleState(await this.component.update(this.connection, installDirectory));
    await this.setState(newState);
  }

  async startupCheck() {
    try {
      const identification = this.component.getIdentification();
      if (!identification.signature) {
        this.deprecationWarning();
      }

      const installDirectory = await this.getInstallDirectory();
      const newState = this.handleState(await this.component.getRemoteState(this.connection, installDirectory));
      await this.setState(newState);

      if (newState.status !== `Installed` && !identification.userManaged) {
        await this.update(installDirectory);
      }
    }
    catch (error) {
      console.log(`Error occurred while checking component ${this.toString()}`);
      console.log(error);

      this.state = { status: `Error`, remoteSignature: "" };
      this.setState(this.state);
    }

    return this;
  }

  /**
   * Ensure smooth transition for Components not returning a {@link SecureComponentState} yet.
   * Remove once {@link ComponentState} is removed.
   * 
   * @param state a deprecated {@link ComponentState} or a {@link SecureComponentState}
   * @returns a {@link SecureComponentState} with a blank signature if `state` is a {@link ComponentState}
   */
  handleState(state: ComponentState | SecureComponentState): SecureComponentState {
    if (typeof state === "string") {
      if (state === "Installed") {
        this.deprecationWarning();
      }
      return { status: state, remoteSignature: "" };
    }

    return state;
  }

  deprecationWarning(local?: boolean) {
    const missingSignature = `WARNING: Component ${this.component.getIdentification().name} ` + 
      (local ? "does not define a local signature. If you're the maintainer of that component, please update it to return a signature when its 'getIdentification' method is called." :
        "did not return a remote signature. If you're the maintainer of that component, please update it to have the 'getRemoteState' and 'update' methods to return a SecureComponentState object.");
    this.connection.appendOutput(missingSignature);
    console.warn(missingSignature);
  }

  toString() {
    const identification = this.component.getIdentification();
    return `${identification.name} (version ${identification.version})`
  }
}