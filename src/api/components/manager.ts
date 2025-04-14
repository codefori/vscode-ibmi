
import IBMi from "../IBMi";
import { ComponentIdentification, ComponentInstallState, ComponentState, IBMiComponent } from "./component";

interface ExtensionContextI {
  extension: {
    id: string
  }
}

export interface ComponentSearchProps {version?: number, ignoreState?: boolean};

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

  public getInstallState(): ComponentInstallState[] {
    return this.registered.map(comp => {
      return {
        id: comp.component.getIdentification(),
        state: comp.getState()
      }
    });
  }

  getAllComponents() {
    return Array.from(extensionComponentRegistry.getComponents().values()).flatMap(a => a.flat());
  }

  public async installComponent(key: string, version: number): Promise<ComponentState> {
    const component = this.getAllComponents().find(c => c.getIdentification().name === key && c.getIdentification().version === version);

    if (!component) {
      throw new Error(`Component ${key} version ${version} not found.`);
    }
    
    const existingComponent = this.registered.find(c => {
      const id = c.component.getIdentification();
      return id.name === key && id.version === version;
    });

    if (!existingComponent) {
      throw new Error(`Component ${key} version ${version} not defined.`);
    }

    if (existingComponent.getState() === `Installed`) {
      throw new Error(`Component ${key} version ${version} already installed.`);
    }

    component.reset?.();

    await existingComponent.update(await existingComponent.getInstallDirectory());

    return existingComponent.getState();
  }

  public async uninstallComponent(key: string, version: number): Promise<void> {
    const installed = this.registered.find(c => {
      const id = c.component.getIdentification();
      return id.name === key && id.version === version;
    });

    if (!installed) {
      throw new Error(`Component ${key} version ${version} not installed.`);
    }

    if (installed.getState() !== `Installed`) {
      throw new Error(`Component ${key} version ${version} not installed.`);
    }

    if (!installed.component.getIdentification().userManaged) {
      throw new Error(`Component ${key} version ${version} is not user managed and therefore cannot be uninstalled.`);
    }

    await installed.component.uninstall?.(this.connection);
  }

  public async startup(lastInstalled: ComponentInstallState[] = []) {
    const components = this.getAllComponents();
    for (const component of components) {
      await component.reset?.();
      const newComponent = new IBMiComponentRuntime(this.connection, component);

      const installed = lastInstalled.find(i => i.id.name === component.getIdentification().name);
      const sameVersion = installed && (installed.id.version === component.getIdentification().version);

      if (!installed || !sameVersion || installed.state === `NotChecked`) {
        await newComponent.check();
      } else {
        await newComponent.overrideState(installed.state);
      }

      this.registered.push(newComponent);
    }
  }

  /**
   * Returns the latest version of an installed component, or fetch a specific version
   */
  get<T extends IBMiComponent>(id: string, options: ComponentSearchProps = {}): T|undefined {
    const componentEngines = this.registered.filter(c => c.component.getIdentification().name === id);

    let allVersions: number[];
    if (options.version) {
      allVersions = [options.version];
    } else {
      // get all versions, highest to lowest
      allVersions = componentEngines.map(c => c.component.getIdentification().version).sort((a, b) => b - a);
    }

    for (const version of allVersions) {
      const componentEngine = componentEngines.find(c => c.component.getIdentification().version === version);
      if (componentEngine && (options.ignoreState || componentEngine.getState() === `Installed`)) {
        return componentEngine.component as T;
      }
    }
  }
}

class IBMiComponentRuntime {
  public static readonly InstallDirectory = `$HOME/.vscode/`;
  private state: ComponentState = `NotChecked`;
  private cachedInstallDirectory: string | undefined;

  constructor(protected readonly connection: IBMi, readonly component: IBMiComponent) {

  }

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

  async overrideState(newState: ComponentState) {
    const installDir = await this.getInstallDirectory();
    await this.component.setInstallDirectory?.(installDir);
    this.state = newState;
  }
  
  async update(installDirectory: string) {
    this.state = await this.component.update(this.connection, installDirectory);
  }

  async check() {
    try {
      const installDirectory = await this.getInstallDirectory();
      this.state = await this.component.getRemoteState(this.connection, installDirectory);
      if (this.state !== `Installed` && !this.component.getIdentification().userManaged) {
        this.update(installDirectory);
      }
    }
    catch (error) {
      console.log(`Error occurred while checking component ${this.toString()}`);
      console.log(error);
      this.state = `Error`;
    }

    return this;
  }

  toString() {
    const identification = this.component.getIdentification();
    return `${identification.name} (version ${identification.version})`
  }
}