const vscode = require(`vscode`);
const TelemetryReporter = require(`@vscode/extension-telemetry`).default;

/** @type {TelemetryReporter} */
let reporter;

module.exports = class {
  static create(id, version, key) {
    reporter = new TelemetryReporter(id, version, key);
    return reporter;
  }

  /**
   * 
   * @param {string} event 
   * @param {object} data 
   */
  static sendTelemetryEvent(event, data) {
    if (reporter && vscode.env.isTelemetryEnabled)
      return reporter.sendTelemetryEvent(event, data);
  }
}