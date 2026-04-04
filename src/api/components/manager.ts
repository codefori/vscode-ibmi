
import IBMi, { ConnectionErrorCode } from "../IBMi";
import { ComponentIdentification, ComponentInstallState, IBMiComponent, SecureComponentState } from "./component";
import { IBMiComponentRuntime } from "./runtime";

interface ExtensionContextI {
  extension: {
    id: string
  }
}

export interface ComponentSearchProps { ignoreState?: boolean };

export class ComponentRegistry {
  private readonly components: Map<string, IBMiComponent[]> = new Map;

  public registerComponent(context: ExtensionContextI | string, component: IBMiComponent) {
    const key = typeof context === `object` ? context.extension.id : context;

    if (typeof key !== `string`) {
      throw new Error(`Invalid extension context.`);
    }

    const extensionComponents = this.components.get(key);
    if (extensionComponents) {
      extensionComponents.push(component);
    }
    else {
      this.components.set(key, [component]);
    }
  }

  public getComponents() {
    return this.components;
  }
}

export const extensionComponentRegistry = new ComponentRegistry();

export class ComponentManager {
  private readonly registered: IBMiComponentRuntime[] = [];

  constructor(private readonly connection: IBMi) { }

  public getComponentIds(): ComponentIdentification[] {
    return Array.from(extensionComponentRegistry.getComponents().values()).flatMap(a => a.flat()).map(c => c.getIdentification());
  }

  public getComponentStates(): ComponentInstallState[] {
    return this.registered.map(comp => {
      return {
        id: comp.component.getIdentification(),
        state: comp.getState()
      }
    });
  }

  /**
   * Returns all components, user managed or not
   */
  getAllAvailableComponents() {
    return Array.from(extensionComponentRegistry.getComponents().values()).flatMap(a => a.flat());
  }

  public async installComponent(key: string): Promise<ComponentInstallState> {
    const component = this.getAllAvailableComponents().find(c => c.getIdentification().name === key && c.getIdentification().userManaged);

    if (!component) {
      throw new Error(`Component ${key} not found.`);
    }

    const existingComponent = this.registered.find(c => c.component.getIdentification().name === key);

    if (!existingComponent) {
      throw new Error(`Component ${key} not defined.`);
    }

    if (existingComponent.getState().status === `Installed`) {
      throw new Error(`Component ${key} already installed.`);
    }

    component.reset?.();

    await existingComponent.update(await existingComponent.getInstallDirectory());

    return {
      id: component.getIdentification(),
      state: existingComponent.getState()
    };
  }

  public async uninstallComponent(key: string): Promise<ComponentInstallState> {
    const installed = this.registered.find(c => c.component.getIdentification().name === key && c.component.getIdentification().userManaged);

    if (!installed) {
      throw new Error(`Component ${key} not registered.`);
    }

    if (installed.getState().status !== `Installed`) {
      throw new Error(`Component ${key} not installed.`);
    }

    await installed.component.uninstall?.(this.connection);
    await installed.overrideState({ status: `NotInstalled`, remoteSignature: "" });

    return {
      id: installed.component.getIdentification(),
      state: installed.getState()
    };
  }

  async getRemoteState(key: string): Promise<SecureComponentState | undefined> {
    const component = this.registered.find(c => c.component.getIdentification().name === key && c.component.getIdentification().userManaged);
    if (component) {
      component.component.reset?.();

      const state = component.handleState(await component.component.getRemoteState(this.connection, await component.getInstallDirectory()));
      await component.overrideState(state);
      return state;
    }
  }

  public async startup(lastInstalled: ComponentInstallState[] = []) {
    const components = this.getAllAvailableComponents();
    for (const component of components) {
      await this.startupComponent(component, lastInstalled);
    }
  }

  public async startupComponent(key: string | IBMiComponent, lastInstalled: ComponentInstallState[] = []) {
    const component = typeof key === "string" ? this.getAllAvailableComponents().find(c => c.getIdentification().name === key) : key;
    if (!component) {
      throw new Error(`Component ${key} not found.`);
    }

    const componentId = component.getIdentification();
    if (this.registered.find(c => c.component.getIdentification().name === componentId.name)) {
      return;
    }

    await component.reset?.();
    const newComponent = new IBMiComponentRuntime(this.connection, component);

    // Always check non-user-managed components to ensure they're actually installed
    const installedBefore = componentId.userManaged && lastInstalled.find(i => i.id.name === componentId.name);
    const sameVersion = installedBefore && (installedBefore.id.version === componentId.version);    
    if ((!installedBefore || !sameVersion || installedBefore.state.status === `NotChecked`)) {
      await newComponent.startupCheck();
    } else if (installedBefore) {
      await newComponent.overrideState(installedBefore.state);
    }

    const newState = newComponent.getState();
    if (newState.status === "Installed" && componentId.signature && componentId.signature !== newState.remoteSignature) {      
      throw new Error(`Component ${componentId.name} version ${componentId.version} local signature doesn't match its remote signature. It may have been tampered with and may not be safe to use. Clear your temporary folder and library and reconnect.`, { cause: "component_signature_mismatch" as ConnectionErrorCode });
    }

    this.registered.push(newComponent);
    return newComponent.getState();
  }

  /**
   * Returns the latest version of an installed component, or fetch a specific version
   */
  get<T extends IBMiComponent>(id: string, options: ComponentSearchProps = {}): T | undefined {
    const componentEngine = this.registered.find(c => c.component.getIdentification().name === id);

    if (componentEngine && (options.ignoreState || componentEngine.getState().status === `Installed`)) {
      return componentEngine.component as T;
    }
  }
}

export { IBMiComponentRuntime };

