
import IBMi from "../IBMi";
import { ComponentIdentification, ComponentInstallState, ComponentState, IBMiComponent } from "./component";

interface ExtensionContextI {
  extension: {
    id: string
  }
}

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
  private readonly registered: Map<string, IBMiComponentRuntime> = new Map;

  constructor(private readonly connection: IBMi) {}

  public getComponentIds(): ComponentIdentification[] {
    return Array.from(extensionComponentRegistry.getComponents().values()).flatMap(a => a.flat()).map(c => c.getIdentification());
  }

  public getInstallState(): ComponentInstallState[] {
    return Array.from(this.registered.keys()).map(k => {
      const comp = this.registered.get(k)!;
      return {
        id: comp.component.getIdentification(),
        state: comp.getState()
      }
    });
  }

  public async startup(lastInstalled: ComponentInstallState[] = []) {
    const components = Array.from(extensionComponentRegistry.getComponents().values()).flatMap(a => a.flat());
    for (const component of components) {
      await component.reset?.();
      const newComponent = new IBMiComponentRuntime(this.connection, component);

      const installed = lastInstalled.find(i => i.id.name === component.getIdentification().name);
      const sameVersion = installed && (installed.id.version === component.getIdentification().version);

      if (!installed || !sameVersion) {
        await newComponent.check();
      } else {
        newComponent.overrideState(installed.state);
      }

      this.registered.set(component.getIdentification().name, newComponent);
    }
  }

  get<T extends IBMiComponent>(id: string, ignoreState?: boolean) {
    const componentEngine = this.registered.get(id);
    if (componentEngine && (ignoreState || componentEngine.getState() === `Installed`)) {
      return componentEngine.component as T;
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

  async check() {
    try {
      const installDirectory = await this.getInstallDirectory();
      this.state = await this.component.getRemoteState(this.connection, installDirectory);
      if (this.state !== `Installed`) {
        this.state = await this.component.update(this.connection, installDirectory);
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