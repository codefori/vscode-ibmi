
const vscode = require(`vscode`);

module.exports = class Configuration {
  constructor(base = {}) {
    
    this.name = base.name;

    this.host = base.host;

    /** @type {string[]} LIB/FILE, LIB/FILEs */
    this.sourceFileList = base.sourceFileList || [`QSYSINC/H`];

    /** @type {string[]} LIB, LIB */
    this.objectBrowserList = base.objectBrowserList || [];

    /** @type {string[]} schema, schema */
    this.databaseBrowserList = base.databaseBrowserList || [];

    /** @type {string[]} */
    this.libraryList = base.libraryList || [];

    /** @type {{name: string, list: string[]}[]} */
    this.libraryListProfiles = base.libraryListProfiles || [];

    /** @type {string} */
    this.homeDirectory = base.homeDirectory || `.`;

    /** @type {string} */
    this.tempLibrary = base.tempLibrary || `ILEDITOR`;

    /** @type {string} */
    this.currentLibrary = base.currentLibrary || ``;

    /** @type {string|undefined} */
    this.sourceASP = base.sourceASP || undefined;

    /** @type {string} */
    this.sourceFileCCSID = base.sourceFileCCSID || `*FILE`;

    /** @type {boolean} Undefined means not created, so default to on */
    this.enableSQL = (base.enableSQL === true || base.enableSQL === undefined);

    /** @type {string[]} */
    this.hideCompileErrors = base.hideCompileErrors || [];
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