
import IBMi from "../IBMi";
import { ComponentIdentification, ComponentInstallState, ComponentState, IBMiComponent } from "./component";

interface ExtensionContextI {
  extension: {
    id: string
  }
}

export interface ComponentSearchProps {ignoreState?: boolean};

export class ComponentRegistry {
  private readonly components: Map<string, IBMiComponent[]> = new Map;

  public registerComponent(context: ExtensionContextI|string, component: IBMiComponent) {
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

  constructor(private readonly connection: IBMi) {}

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

    if (existingComponent.getState() === `Installed`) {
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

    if (installed.getState() !== `Installed`) {
      throw new Error(`Component ${key} not installed.`);
    }

    await installed.component.uninstall?.(this.connection);
    await installed.overrideState(`NotInstalled`);

    return {
      id: installed.component.getIdentification(),
      state: installed.getState()
    };
  }

  async getRemoteState(key: string): Promise<ComponentState|undefined> {
    const component = this.registered.find(c => c.component.getIdentification().name === key && c.component.getIdentification().userManaged);
    if (component) {
      component.component.reset?.();
      const state = await component.component.getRemoteState(this.connection, await component.getInstallDirectory());
      await component.overrideState(state);
      return state;
    }
  }

  public async startup(lastInstalled: ComponentInstallState[] = []) {
    const components = this.getAllAvailableComponents();
    for (const component of components) {
      await component.reset?.();
      const newComponent = new IBMiComponentRuntime(this.connection, component);

      const installed = lastInstalled.find(i => i.id.name === component.getIdentification().name);
      const sameVersion = installed && (installed.id.version === component.getIdentification().version);

      if ((!installed || !sameVersion || installed.state === `NotChecked`) && !component.getIdentification().userManaged) {
        await newComponent.check();
      } else if (installed) {
        await newComponent.overrideState(installed.state);
      }

      this.registered.push(newComponent);
    }
  }

  /**
   * Returns the latest version of an installed component, or fetch a specific version
   */
  get<T extends IBMiComponent>(id: string, options: ComponentSearchProps = {}): T|undefined {
    const componentEngine = this.registered.find(c => c.component.getIdentification().name === id);

    if (componentEngine && (options.ignoreState || componentEngine.getState() === `Installed`)) {
      return componentEngine.component as T;
    }
  }
}

class IBMiComponentRuntime {
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

  async check() {
    try {
      const installDirectory = await this.getInstallDirectory();
      const newState = await this.component.getRemoteState(this.connection, installDirectory);
      await this.setState(newState);
      if (newState !== `Installed`) {
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