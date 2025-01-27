
import os from "os";
import { Config, VirtualConfig } from "./VirtualConfig";
import { ConnectionData } from "../../types";
import { ConnectionConfig } from "./types";

function initialize(parameters: Partial<ConnectionConfig>): ConnectionConfig {
  return {
    ...parameters,
    name: parameters.name!,
    host: parameters.host || '',
    objectFilters: parameters.objectFilters || [],
    libraryList: parameters.libraryList || [],
    autoClearTempData: parameters.autoClearTempData || false,
    customVariables: parameters.customVariables || [],
    connectionProfiles: parameters.connectionProfiles || [],
    commandProfiles: parameters.commandProfiles || [],
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
    sourceDateMode: parameters.sourceDateMode || "diff",
    sourceDateGutter: parameters.sourceDateGutter === true,
    encodingFor5250: parameters.encodingFor5250 || `default`,
    terminalFor5250: parameters.terminalFor5250 || `default`,
    setDeviceNameFor5250: (parameters.setDeviceNameFor5250 === true),
    connectringStringFor5250: parameters.connectringStringFor5250 || `localhost`,
    autoSaveBeforeAction: (parameters.autoSaveBeforeAction === true),
    showDescInLibList: (parameters.showDescInLibList === true),
    debugPort: (parameters.debugPort || "8005"),
    debugSepPort: (parameters.debugSepPort || "8008"),
    debugUpdateProductionFiles: (parameters.debugUpdateProductionFiles === true),
    debugEnableDebugTracing: (parameters.debugEnableDebugTracing === true),
    readOnlyMode: (parameters.readOnlyMode === true),
    quickConnect: (parameters.quickConnect === true || parameters.quickConnect === undefined),
    defaultDeploymentMethod: parameters.defaultDeploymentMethod || ``,
    protectedPaths: (parameters.protectedPaths || []),
    showHiddenFiles: (parameters.showHiddenFiles === true || parameters.showHiddenFiles === undefined),
    lastDownloadLocation: (parameters.lastDownloadLocation || os.homedir())
  }
}

export class ConnectionManager {
  configMethod: Config = new VirtualConfig();

  /**
   * A bit of a hack to access any piece of configuration. (like actions)
   */
  get<T>(key: string) {
    return this.configMethod.get<T>(key);
  }

  /**
   * Same hack as get.
   */
  set(key: string, value: any) {
    return this.configMethod.set(key, value);
  }

  getByName(name: string) {
    const connections = this.getAll();
    const index = connections.findIndex(conn => conn.name === name);
    if (index !== -1) {
      return { index, data: connections[index] };
    }
  }

  async sort() {
    const connections = await this.getAll();
    connections.sort((a, b) => a.name.localeCompare(b.name));
    return this.configMethod.set(`connections`, connections);
  }

  getAll() {
    return this.configMethod.get<ConnectionData[]>(`connections`) || [];
  }

  async setAll(connections: ConnectionData[]) {
    return this.configMethod.set(`connections`, connections);
  }

  async storeNew(data: ConnectionData) {
    const connections = await this.getAll();
    const newId = connections.length;
    connections.push(data);
    await this.setAll(connections);
    return { index: newId, data };
  }

  async deleteByName(name: string) {
    const connections = await this.getAll();
    const index = connections.findIndex(conn => conn.name === name);
    if (index !== -1) {
      connections.splice(index, 1);
      return this.setAll(connections);
    }
  }

  async updateByIndex(index: number, data: ConnectionData) {
    const connections = await this.getAll();
    connections[index] = data;

    // Remove possible password from any connection
    connections.forEach(conn => delete conn.password);

    return this.configMethod.set(`connections`, connections);
  }

  getConnectionSettings(): ConnectionConfig[] {
    return this.configMethod.get<ConnectionConfig[]>(`connectionSettings`) || [];
  }

  async updateAll(connections: ConnectionConfig[]) {
    await this.configMethod.set(`connectionSettings`, connections);
  }

  async update(parameters: ConnectionConfig) {
    if (parameters?.name) {
      const connections = this.getConnectionSettings();
      connections.filter(conn => conn.name === parameters.name).forEach(conn => Object.assign(conn, parameters));
      await this.updateAll(connections);
    }
  }

  async load(name: string): Promise<ConnectionConfig> {
    let connections = this.getConnectionSettings();
    let existingConfig = connections.find(conn => conn.name === name);
    let config: ConnectionConfig;
    if (existingConfig) {
      config = initialize(existingConfig);
    } else {
      config = initialize({ name: name });
      connections.push(config);
      await this.updateAll(connections);
    }

    return config;
  }
}