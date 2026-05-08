import IBMi from "../IBMi";

type ComponentStatus = `NotChecked` | `NotInstalled` | `NeedsUpdate` | `Installed` | `Error`;
/** @deprecated use {@link SecureComponentState} instead */
export type ComponentState = ComponentStatus;
export type SecureComponentState = { status: ComponentStatus, remoteSignature?: string };

export type ComponentIdentification = {
  name: string
  version: number | string
  signature: string
  userManaged?: boolean
}

export type ComponentInstallState = {
  id: ComponentIdentification
  state: SecureComponentState
}

/**
 * Defines a component that is managed per IBM i.
 * 
 * Any class extending  {@link IBMiComponent} needs to register itself in the Component Registry.
 * 
 * For example, this class:
 * ```
 * class MyIBMIComponent implements IBMiComponent {
 *  //implements getIdentification, getRemoteState and update
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
   * The identification of this component: a unique name and a signature
   * 
   * @returns a {@link ComponentIdentification}
   */
  getIdentification(): ComponentIdentification;

  setInstallDirectory?(installDirectory: string): Promise<void>;

  /**
   * Check and retrieve the Component's state from the remote system.
   * 
   * @param connection 
   * @param installDirectory 
   * @param signature a unique identifier (i.e. a hash), part of the component's identification. It should be compared against a hash retrieved from the remote system.
   * @returns the component's {@link SecureComponentState state} on the IBM i
   */
  getRemoteState(connection: IBMi, installDirectory: string): ComponentState | SecureComponentState | Promise<ComponentState | SecureComponentState>;

  /**
   * Called whenever the components needs to be installed or updated, depending on its {@link SecureComponentState state}.
   * 
   * The Component Manager is responsible for calling this, so the {@link SecureComponentState state} doesn't need to be checked here.
   * @param connection 
   * @param installDirectory 
   * @param signature a unique identifier (i.e. a hash), part of the component's identification. It should be compared against a hash retrieved from the remote system.
   * @returns the component's {@link SecureComponentState state} after the update is done
   */
  update(connection: IBMi, installDirectory: string): ComponentState | SecureComponentState | Promise<ComponentState | SecureComponentState>

  /**
   * Called when connecting to clear every persitent information related to the previous connection
   */
  reset?(): void | Promise<void>

  /**
   * Called when the component should be uninstalled. 
   * Can only run against user-managed components.
   */
  uninstall?(connection: IBMi): Promise<void>;
}