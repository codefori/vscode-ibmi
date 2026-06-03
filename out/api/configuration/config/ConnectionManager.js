"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConnectionManager = void 0;
const os_1 = __importDefault(require("os"));
const VirtualConfig_1 = require("./VirtualConfig");
function initialize(parameters) {
    return {
        ...parameters,
        name: parameters.name,
        host: parameters.host || '',
        objectFilters: parameters.objectFilters || [],
        libraryList: parameters.libraryList || [],
        autoClearTempData: parameters.autoClearTempData || false,
        customVariables: parameters.customVariables || [],
        connectionProfiles: parameters.connectionProfiles || [],
        ifsShortcuts: parameters.ifsShortcuts || [],
        /** Default auto sorting of shortcuts to off  */
        autoSortIFSShortcuts: parameters.autoSortIFSShortcuts || false,
        homeDirectory: parameters.homeDirectory || `.`,
        /** Undefined means not created, so default to on */
        tempLibrary: parameters.tempLibrary || `ILEDITOR`,
        tempDir: parameters.tempDir || `/tmp`,
        currentLibrary: parameters.currentLibrary || ``,
        sourceFileCCSID: parameters.sourceFileCCSID || `*FILE`,
        autoConvertIFSccsid: (parameters.autoConvertIFSccsid === true),
        hideCompileErrors: parameters.hideCompileErrors || [],
        enableSourceDates: parameters.enableSourceDates === true,
        sourceDateGutter: parameters.sourceDateGutter === true,
        encodingFor5250: parameters.encodingFor5250 || `default`,
        terminalFor5250: parameters.terminalFor5250 || `default`,
        setDeviceNameFor5250: (parameters.setDeviceNameFor5250 === true),
        connectringStringFor5250: parameters.connectringStringFor5250 || `+uninhibited localhost`,
        autoSaveBeforeAction: (parameters.autoSaveBeforeAction === true),
        showDescInLibList: (parameters.showDescInLibList === true),
        debugPort: (parameters.debugPort || "8005"),
        debugSepPort: (parameters.debugSepPort || "8008"),
        debugUpdateProductionFiles: (parameters.debugUpdateProductionFiles === true),
        debugEnableDebugTracing: (parameters.debugEnableDebugTracing === true),
        debugIgnoreCertificateErrors: (parameters.debugIgnoreCertificateErrors === true),
        readOnlyMode: (parameters.readOnlyMode === true),
        quickConnect: (parameters.quickConnect === true || parameters.quickConnect === undefined),
        defaultDeploymentMethod: parameters.defaultDeploymentMethod || ``,
        protectedPaths: (parameters.protectedPaths || []),
        showHiddenFiles: (parameters.showHiddenFiles === true || parameters.showHiddenFiles === undefined),
        lastDownloadLocation: (parameters.lastDownloadLocation || os_1.default.homedir())
    };
}
class ConnectionManager {
    configMethod = new VirtualConfig_1.VirtualConfig();
    /**
     * A bit of a hack to access any piece of configuration. (like actions)
     */
    get(key) {
        return this.configMethod.get(key);
    }
    /**
     * Same hack as get.
     */
    set(key, value) {
        return this.configMethod.set(key, value);
    }
    getByName(name) {
        const connections = this.getAll();
        const index = connections.findIndex(conn => conn.name === name);
        if (index !== -1) {
            return { index, data: connections[index] };
        }
    }
    async sort() {
        const connections = this.getAll();
        connections.sort((a, b) => a.name.localeCompare(b.name));
        return this.configMethod.set(`connections`, connections);
    }
    getAll() {
        return this.configMethod.get(`connections`) || [];
    }
    async setAll(connections) {
        return this.configMethod.set(`connections`, connections);
    }
    async storeNew(data) {
        const connections = this.getAll();
        const newId = connections.length;
        connections.push(data);
        await this.setAll(connections);
        return { index: newId, data };
    }
    async deleteByName(name) {
        const connections = await this.getAll();
        const index = connections.findIndex(conn => conn.name === name);
        if (index !== -1) {
            connections.splice(index, 1);
            return this.setAll(connections);
        }
    }
    async updateByIndex(index, data) {
        const connections = await this.getAll();
        connections[index] = data;
        // Remove possible password from any connection
        connections.forEach(conn => delete conn.password);
        return this.configMethod.set(`connections`, connections);
    }
    getConnectionSettings() {
        return this.configMethod.get(`connectionSettings`) || [];
    }
    async updateAll(connections) {
        await this.configMethod.set(`connectionSettings`, connections);
    }
    async update(parameters) {
        if (parameters?.name) {
            const connections = this.getConnectionSettings();
            connections.filter(conn => conn.name === parameters.name).forEach(conn => Object.assign(conn, parameters));
            await this.updateAll(connections);
        }
    }
    async load(name) {
        let connections = this.getConnectionSettings();
        let existingConfig = connections.find(conn => conn.name === name);
        let config;
        if (existingConfig) {
            config = initialize(existingConfig);
        }
        else {
            config = initialize({ name: name, enableSourceDates: true });
            connections.push(config);
            await this.updateAll(connections);
        }
        return config;
    }
}
exports.ConnectionManager = ConnectionManager;
//# sourceMappingURL=ConnectionManager.js.map