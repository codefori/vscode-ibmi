
const vscode = require(`vscode`);

module.exports = class Configuration {
  constructor(base = {}) {
    this.host = base.host;

    /** @type {string[]} LIB/FILE, LIB/FILEs */
    this.sourceFileList = base.sourceFileList || [`QSYSINC/H`];

    /** @type {string[]} LIB, LIB */
    this.objectBrowserList = base.objectBrowserList || [];

    /** @type {string[]} schema, schema */
    this.schemaBrowserList = base.objectBrowserList || [];

    /** @type {string[]} */
    this.libraryList = base.libraryList || [];

    /** @type {string} */
    this.homeDirectory = base.homeDirectory || `.`;

    /** @type {string} */
    this.tempLibrary = base.tempLibrary || `ILEDITOR`;

    /** @type {string} */
    this.buildLibrary = base.buildLibrary || `QTEMP`;

    /** @type {string|undefined} */
    this.sourceASP = base.sourceASP || undefined;
  }

  /**
   * Update configuration prop
   * @param {string} key 
   * @param {any} value 
   */
  async set(key, value) {
    const globalData = vscode.workspace.getConfiguration(`code-for-ibmi`);
    let connections = globalData.get(`connectionSettings`);

    const index = connections.findIndex(conn => conn.host === this.host);

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

    const index = connections.findIndex(conn => conn.host === this.host);

    if (index >= 0) {
      for (const prop in props) {
        connections[index][prop] = props[prop];
        this[prop] = props[prop];
      }

      await globalData.update(`connectionSettings`, connections, vscode.ConfigurationTarget.Global);
    }
  }

  /** Reload props from vscode settings */
  reload() {
    const globalData = vscode.workspace.getConfiguration(`code-for-ibmi`);
    const connections = globalData.get(`connectionSettings`);
    const index = connections.findIndex(conn => conn.host === this.host);

    if (index >= 0) {
      for (const key in connections[index]) {
        this[key] = connections[index][key];
      }
    }
  }

  /**
   * Will load an existing config if it exists, otherwise will create it with default values.
   * @param {string} host Host string for configuration
   * @returns {Promise<Configuration>}
   */
  static async load(host) {
    const globalData = vscode.workspace.getConfiguration(`code-for-ibmi`);

    let connections = globalData.get(`connectionSettings`);
    let existingConfig = connections.find(conn => conn.host === host);
    let config;

    if (existingConfig) {
      config = new this(existingConfig);

    } else {
      config = new this({host});
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