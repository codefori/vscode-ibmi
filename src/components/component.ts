import IBMi from "../api/IBMi";

export type ComponentState = `NotChecked` | `NotInstalled` | `Installed` | `NeedsUpdate` | `Error`;

export type ComponentIdentification = {
  name: string
  version: number
}

export type IBMiComponentType<T extends IBMiComponent> = new (c: IBMi) => T;

/**
 * Defines a component that is managed per IBM i.
 * 
 * Any class extending  {@link IBMiComponent} needs to register itself in the Component Registry.
 * 
 * For example, this class:
 * ```
 * class MyIBMIComponent extends IBMiComponent {
 *  //implements getName(), getRemoteState() and update()
 * }
 * ```
 * Must be registered like this, when the extension providing the component gets activated:
 * ```
 * export async function activate(context: ExtensionContext) {
 *   const codeForIBMiExtension = vscode.extensions.getExtension<CodeForIBMi>('halcyontechltd.code-for-ibmi');
 *   if (codeForIBMiExtension) {
 *     codeForIBMi = codeForIBMiExtension.isActive ? codeForIBMiExtension.exports : await codeForIBMiExtension.activate();
 *     codeForIBMi.componentRegistry.registerComponent(context, MyIBMIComponent);
 *   }
 * }
 * ```
 * 
 */
export abstract class IBMiComponent {
  public static readonly InstallDirectory = `$HOME/.vscode/`;
  state: ComponentState = `NotChecked`;
  cachedInstallDirectory: string | undefined;

  constructor(readonly connection: IBMi) {

  }

  async getInstallDirectory() {
    if (!this.cachedInstallDirectory) {
      const result = await this.connection.sendCommand({
        command: `echo "${IBMiComponent.InstallDirectory}"`,
      });

      this.cachedInstallDirectory = result.stdout.trim() || `/home/${this.connection.currentUser.toLowerCase()}/.vscode/`;
    }

    return this.cachedInstallDirectory;
  }

  getState(): ComponentState {
    return this.state;
  }

  async check(): Promise<ComponentState> {
    try {
      this.state = await this.getRemoteState();
      if (this.state !== `Installed`) {
        this.state = await this.update();
      }
    }
    catch (error) {
      console.log(`Error occurred while checking component ${this.toString()}`);
      console.log(error);
      this.state = `Error`;
    }

    return this.state;
  }

  toString() {
    const identification = this.getIdentification();
    return `${identification.name} (version ${identification.version})`
  }

  /**
   * The name of this component; mainly used for display and logging purposes
   * 
   * @returns a human-readable name
   */
  abstract getIdentification(): ComponentIdentification;

  /**
   * @returns the component's {@link ComponentState state} on the IBM i
   */
  abstract getRemoteState(): ComponentState | Promise<ComponentState>;

  /**
   * Called whenever the components needs to be installed or updated, depending on its {@link ComponentState state}.
   * 
   * The Component Manager is responsible for calling this, so the {@link ComponentState state} doesn't need to be checked here.
   * 
   * @returns the component's {@link ComponentState state} after the update is done
   */
  abstract update(): ComponentState | Promise<ComponentState>
}