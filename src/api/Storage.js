const vscode = require(`vscode`);

module.exports = class Storage {
  constructor(context, connectionName) {
    /** @type {vscode.ExtensionContext} */
    this.context = context;
    this.connectionName = connectionName;
  }

  get(key) {
    const result = this.context.globalState.get(`${this.connectionName}.${key}`);
    return result || {};
  }

  set(key, value) {
    return this.context.globalState.update(`${this.connectionName}.${key}`, value);
  }
}