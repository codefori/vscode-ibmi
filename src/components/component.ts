import IBMi from "../api/IBMi";

export const enum ComponentState {
  NotChecked = `NotChecked`,
  NotInstalled = `NotInstalled`,
  Installed = `Installed`,
  NeedUpdate = `NeedUpdate`,
  Error = `Error`,
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
 * Must be registered like this:
 * ```
 * const codeForIBMiExtension = vscode.extensions.getExtension<CodeForIBMi>('halcyontechltd.code-for-ibmi');
 * if (codeForIBMiExtension) {
 *  codeForIBMi = codeForIBMiExtension.isActive ? codeForIBMiExtension.exports : await codeForIBMiExtension.activate();
 *  codeForIBMi.componentRegistry.registerComponent(MyIBMIComponent);
 * }
 * ```
 * 
 */
export abstract class IBMiComponent {
  private state = ComponentState.NotChecked;

  constructor(protected readonly connection: IBMi) {

  }

  getState() {
    return this.state;
  }

  async check() {
    try {
      this.state = await this.getRemoteState();
      if (this.state !== ComponentState.Installed) {
        this.state = await this.update();
      }
    }
    catch (error) {
      console.log(`Error occurred while checking component ${this.getName()}`);
      console.log(error);
      this.state = ComponentState.Error;
    }

    return this;
  }

  /**
   * The name of this component; mainly used for display and logging purposes
   * 
   * @returns a human-readable name
   */
  abstract getName(): string;

  /**
   * @returns the component's {@link ComponentState state} on the IBM i
   */
  protected abstract getRemoteState(): ComponentState | Promise<ComponentState>;

  /**
   * Called whenever the components needs to be installed or updated, depending on its {@link ComponentState state}.
   * 
   * The Component Manager is responsible for calling this, so the {@link ComponentState state} doesn't need to be checked here.
   * 
   * @returns the component's {@link ComponentState state} after the update is done
   */
  protected abstract update(): ComponentState | Promise<ComponentState>
}