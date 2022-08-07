
import * as vscode from 'vscode';

class ConnectionProps {
  name?: string;
  host?: string;
  objectFilters?: {name: string, library: string, object: string, types: string[], member: string, memberType: string}[];
  libraryList?: string[];
  autoClearTempData?: boolean;
  customVariables?: {name: string, value: string}[];
  connectionProfiles?: {name: string, homeDirectory: string, currentLibrary: string, libraryList: string[], objectFilters: object[], ifsShortcuts: string[], customVariables: {name: string, value: string}[] }[];
  ifsShortcuts?: string[];
  autoSortIFSShortcuts?: boolean;
  homeDirectory?: string;
  enableSQL?: boolean;
  tempLibrary?: string;
  tempDir?: string;
  currentLibrary?: string;
  sourceASP?: string;
  sourceFileCCSID?: string;
  autoConvertIFSccsid?: boolean;
  hideCompileErrors?: string[];
  enableSourceDates?: boolean;
  sourceDateGutter?: boolean;
  clContentAssistEnabled?: boolean;
  encodingFor5250?: string;
  terminalFor5250?: string;
  setDeviceNameFor5250?: boolean;
  connectringStringFor5250?: string;
  autoSaveBeforeAction?: boolean;
  [name: string]: any;
}

export default class Configuration extends ConnectionProps {
  constructor(base: ConnectionProps = {}) {
    super();
    this.name = base.name;
    this.host = base.host;
    this.objectFilters = base.objectFilters || [];
    this.libraryList = base.libraryList || [];
    this.autoClearTempData = (base.autoClearTempData === true);
    this.customVariables = base.customVariables || [];
    this.connectionProfiles = base.connectionProfiles || [];
    this.ifsShortcuts = base.ifsShortcuts || [];
    this.autoSortIFSShortcuts = (base.autoSortIFSShortcuts === true );
    this.homeDirectory = base.homeDirectory || `.`;
    this.enableSQL = (base.enableSQL === true || base.enableSQL === undefined);
    this.tempLibrary = base.tempLibrary || `ILEDITOR`;
    this.tempDir = base.tempDir || `/tmp`;
    this.currentLibrary = base.currentLibrary || ``;
    this.sourceASP = base.sourceASP || undefined;
    this.sourceFileCCSID = base.sourceFileCCSID || `*FILE`;
    this.autoConvertIFSccsid = (base.autoConvertIFSccsid === true);
    this.hideCompileErrors = base.hideCompileErrors || [];
    this.enableSourceDates = (base.enableSourceDates === true);
    this.sourceDateGutter = (base.sourceDateGutter === true);
    this.clContentAssistEnabled = (base.clContentAssistEnabled === true);
    this.encodingFor5250 = base.encodingFor5250 || `default`;
    this.terminalFor5250 = base.terminalFor5250 || `default`;
    this.setDeviceNameFor5250 = (base.setDeviceNameFor5250 === true);
    this.connectringStringFor5250 = base.connectringStringFor5250 || `localhost`;
    this.autoSaveBeforeAction = (base.autoSaveBeforeAction === true);
  }

  /**
   * Get a host config prop
   */
  get(key: string) {
    const globalData = vscode.workspace.getConfiguration(`code-for-ibmi`);
    let connections: ConnectionProps[]|undefined = globalData.get(`connectionSettings`);

    if (connections) {
      const index = connections.findIndex(conn => conn.name === this.name);

      return (index >= 0 ? connections[index][key] : undefined);
    }
  }

  async set(key: string, value: any) {
    const globalData = vscode.workspace.getConfiguration(`code-for-ibmi`);
    let connections: ConnectionProps[]|undefined = globalData.get(`connectionSettings`);

    if (connections) {
      const index = connections.findIndex(conn => conn.name === this.name);

      if (index >= 0) {
        connections[index][key] = value;
        this[key] = value;

        await globalData.update(`connectionSettings`, connections, vscode.ConfigurationTarget.Global);
      }
    }
  }

  /**
   * Update many values
   */
  async setMany(props: {[prop: string]: any}) {
    const globalData = vscode.workspace.getConfiguration(`code-for-ibmi`);
    let connections: ConnectionProps[]|undefined = globalData.get(`connectionSettings`);

    if (connections) {
      const index = connections.findIndex(conn => conn.name === this.name);

      if (index >= 0) {
        for (const prop in props) {
          connections[index][prop] = props[prop];
          this[prop] = props[prop];
        }

        await globalData.update(`connectionSettings`, connections, vscode.ConfigurationTarget.Global);
      }
    }
  }

  /** Reload props from vscode settings */
  reload() {
    const globalData = vscode.workspace.getConfiguration(`code-for-ibmi`);
    const connections: ConnectionProps[]|undefined = globalData.get(`connectionSettings`);

    if (connections) {
      const index = connections.findIndex(conn => conn.name === this.name);

      if (index >= 0) {
        for (const key in connections[index]) {
          this[key] = connections[index][key];
        }
      }
    }
  }

  /**
   * Will load an existing config if it exists, otherwise will create it with default values.
   * @param {string} name Connection name string for configuration
   * @returns {Promise<Configuration>}
   */
  static async load(name: string): Promise<Configuration> {
    const globalData = vscode.workspace.getConfiguration(`code-for-ibmi`);

    let connections: ConnectionProps[]|undefined = globalData.get(`connectionSettings`);
    if (connections) {
      let existingConfig = connections.find(conn => conn.name === name);
      let config;

      if (existingConfig) {
        config = new this(existingConfig);

      } else {
        config = new this({name});
        connections.push(config);

        await globalData.update(`connectionSettings`, connections, vscode.ConfigurationTarget.Global);
      }

      return config;
    } else {
      return new this({name: `New connection`});
    }
  }

  /**
   * Set global extension config
   */
  static setGlobal(key: string, value: any) {
    const globalData = vscode.workspace.getConfiguration(`code-for-ibmi`);
    return globalData.update(key, value, vscode.ConfigurationTarget.Global);
  }

  static getGlobal(prop: string): any {
    const globalData = vscode.workspace.getConfiguration(`code-for-ibmi`);
    return globalData.get(prop);
  }
}