import IBMi from "../IBMi";

export type ComponentState = `NotChecked` | `NotInstalled` | `Installed` | `NeedsUpdate` | `Error`;

export type ComponentIdentification = {
  name: string
  version: number
}

export type ComponentInstallState = {
  id: ComponentIdentification
  state: ComponentState
}

/**
 * Defines a component that is managed per IBM i.
 * 
 * Any class extending  {@link IBMiComponent} needs to register itself in the Component Registry.
 * 
 * For example, this class:
 * ```
 * class MyIBMIComponent implements IBMiComponent {
 *  //implements getName, getRemoteState and update
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
export type IBMiComponent = {
  /**
   * The identification of this component; name must be unique
   * 
   * @returns a human-readable name
   */
  getIdentification(): ComponentIdentification;

  setInstallDirectory?(installDirectory: string): Promise<void>;

  /**
   * @returns the component's {@link ComponentState state} on the IBM i
   */
  getRemoteState(connection: IBMi, installDirectory:string): ComponentState | Promise<ComponentState>;

  /**
   * Called whenever the components needs to be installed or updated, depending on its {@link ComponentState state}.
   * 
   * The Component Manager is responsible for calling this, so the {@link ComponentState state} doesn't need to be checked here.
   * 
   * @returns the component's {@link ComponentState state} after the update is done
   */
  update(connection: IBMi, installDirectory:string): ComponentState | Promise<ComponentState>

  /**
   * Called when connecting to clear every persitent information related to the previous connection
   */
  reset?() : void | Promise<void>
}