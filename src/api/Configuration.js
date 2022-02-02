
const vscode = require(`vscode`);

module.exports = class Configuration {
  constructor(base = {}) {
    
    this.name = base.name;

    this.host = base.host;

    /** @type {{name: string, library: string, object: string, types: string[], member: string}[]} */
    this.objectFilters = base.objectFilters || [];

    /** @type {string[]} schema, schema */
    this.databaseBrowserList = base.databaseBrowserList || [];

    /** @type {string[]} */
    this.libraryList = base.libraryList || [];

    /** @type {boolean} */
    this.autoClearTempData = (base.autoClearTempData === true);

    /** @type {{name: string, value: string}[]} */
    this.customVariables = base.customVariables || [];

    /** @type {{name: string, homeDirectory: string, currentLibrary: string, libraryList: string[], objectFilters: object[], databaseBrowserList: string[], ifsShortcuts: string[], customVariables: {name, value}[] }[]} */
    this.connectionProfiles = base.connectionProfiles || [];

    /** @type {string[]} */
    this.ifsShortcuts = base.ifsShortcuts || [];

    /** @type {string} */
    this.homeDirectory = base.homeDirectory || `.`;

    /** @type {"default"|"db2util"|"db2"|"QZDFMDB2"|"none"} */
    this.sqlExecutor = base.sqlExecutor || `default`;

    /** @type {string} */
    this.tempLibrary = base.tempLibrary || `ILEDITOR`;

    /** @type {string} */
    this.currentLibrary = base.currentLibrary || ``;

    /** @type {string|undefined} */
    this.sourceASP = base.sourceASP || undefined;

    /** @type {string} */
    this.sourceFileCCSID = base.sourceFileCCSID || `*FILE`;

    /** @type {boolean} */
    this.autoConvertIFSccsid = (base.autoConvertIFSccsid === true);

    /** @type {string[]} */
    this.hideCompileErrors = base.hideCompileErrors || [];

    /** @type {boolean} */
    this.enableSourceDates = (base.enableSourceDates === true);

    /** @type {"none"|"bar"|"inline"} */
    this.sourceDateLocation = base.sourceDateLocation || `none`;

    /** @type {boolean} */
    this.clContentAssistEnabled = (base.clContentAssistEnabled === true);

    /** @type {string|undefined} */
    this.encodingFor5250 = base.encodingFor5250 || `default`;

    /** @type {string|undefined} */
    this.terminalFor5250 = base.terminalFor5250 || `default`;

    /** @type {boolean} */
    this.setDeviceNameFor5250 = (base.setDeviceNameFor5250 === true);

    /** @type {boolean} */
    this.autoSaveBeforeAction = (base.autoSaveBeforeAction === true);
  }

  /**
   * Get a host config prop
   * @param {string} key 
   */
  get(key) {
    const globalData = vscode.workspace.getConfiguration(`code-for-ibmi`);
    let connections = globalData.get(`connectionSettings`);

    const index = connections.findIndex(conn => conn.name === this.name);

    return (index >= 0 ? connections[index][key] : undefined);
  }

  /**
   * Update configuration prop
   * @param {string} key 
   * @param {any} value 
   */
  async set(key, value) {
    const globalData = vscode.workspace.getConfiguration(`code-for-ibmi`);
    let connections = globalData.get(`connectionSettings`);

    const index = connections.findIndex(conn => conn.name === this.name);

    if (index >= 0) {
      connections[index][key] = value;
      this[key] = value;

      await globalData.update(`connectionSettings`, connections, vscode.ConfigurationTarget.Global);
    }
  }

  /**
   * Update many values
   * @param {{[NAME: string]: any}} props 
   */
  async setMany(props) {
    const globalData = vscode.workspace.getConfiguration(`code-for-ibmi`);
    let connections = globalData.get(`connectionSettings`);

    const index = connections.findIndex(conn => conn.name === this.name);

    if (index >= 0) {
      for (const prop in props) {
        connections[index][prop] = props[prop];
        this[prop] = props[prop];
      }

      await globalData.update(`connectionSettings`, connections, vscode.ConfigurationTarget.Global);
    }
  }

  /**
   * Set global extension config
   * @param {string} key 
   * @param {any} value 
   */
  static setGlobal(key, value) {
    const globalData = vscode.workspace.getConfiguration(`code-for-ibmi`);
    return globalData.update(key, value, vscode.ConfigurationTarget.Global);
  }

  /** Reload props from vscode settings */
  reload() {
    const globalData = vscode.workspace.getConfiguration(`code-for-ibmi`);
    const connections = globalData.get(`connectionSettings`);
    const index = connections.findIndex(conn => conn.name === this.name);

    if (index >= 0) {
      for (const key in connections[index]) {
        this[key] = connections[index][key];
      }
    }
  }

  /**
   * Will load an existing config if it exists, otherwise will create it with default values.
   * @param {string} name Connection name string for configuration
   * @returns {Promise<Configuration>}
   */
  static async load(name) {
    const globalData = vscode.workspace.getConfiguration(`code-for-ibmi`);

    let connections = globalData.get(`connectionSettings`);
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
  }

  /**
   * Returns variable not specific to a host (e.g. a global config)
   * @param {string} prop 
   */
  static get(prop) {
    const globalData = vscode.workspace.getConfiguration(`code-for-ibmi`);
    return globalData.get(prop);
  }
}