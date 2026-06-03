"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IBMiComponentRuntime = exports.ComponentManager = exports.extensionComponentRegistry = exports.ComponentRegistry = void 0;
const runtime_1 = require("./runtime");
Object.defineProperty(exports, "IBMiComponentRuntime", { enumerable: true, get: function () { return runtime_1.IBMiComponentRuntime; } });
;
class ComponentRegistry {
    components = new Map;
    registerComponent(context, component) {
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
    getComponents() {
        return this.components;
    }
}
exports.ComponentRegistry = ComponentRegistry;
exports.extensionComponentRegistry = new ComponentRegistry();
class ComponentManager {
    connection;
    registered = [];
    constructor(connection) {
        this.connection = connection;
    }
    getComponentIds() {
        return Array.from(exports.extensionComponentRegistry.getComponents().values()).flatMap(a => a.flat()).map(c => c.getIdentification());
    }
    getComponentStates() {
        return this.registered.map(comp => {
            return {
                id: comp.component.getIdentification(),
                state: comp.getState()
            };
        });
    }
    /**
     * Returns all components, user managed or not
     */
    getAllAvailableComponents() {
        return Array.from(exports.extensionComponentRegistry.getComponents().values()).flatMap(a => a.flat());
    }
    async installComponent(key) {
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
    async uninstallComponent(key) {
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
    async getRemoteState(key) {
        const component = this.registered.find(c => c.component.getIdentification().name === key && c.component.getIdentification().userManaged);
        if (component) {
            component.component.reset?.();
            const state = await component.component.getRemoteState(this.connection, await component.getInstallDirectory());
            await component.overrideState(state);
            return state;
        }
    }
    async startup(lastInstalled = []) {
        const components = this.getAllAvailableComponents();
        for (const component of components) {
            await component.reset?.();
            const newComponent = new runtime_1.IBMiComponentRuntime(this.connection, component);
            const installedBefore = lastInstalled.find(i => i.id.name === component.getIdentification().name);
            const sameVersion = installedBefore && (installedBefore.id.version === component.getIdentification().version);
            if ((!installedBefore || !sameVersion || installedBefore.state === `NotChecked`)) {
                await newComponent.startupCheck();
            }
            else if (installedBefore) {
                await newComponent.overrideState(installedBefore.state);
            }
            this.registered.push(newComponent);
        }
    }
    /**
     * Returns the latest version of an installed component, or fetch a specific version
     */
    get(id, options = {}) {
        const componentEngine = this.registered.find(c => c.component.getIdentification().name === id);
        if (componentEngine && (options.ignoreState || componentEngine.getState() === `Installed`)) {
            return componentEngine.component;
        }
    }
}
exports.ComponentManager = ComponentManager;
//# sourceMappingURL=manager.js.map