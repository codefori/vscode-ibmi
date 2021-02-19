const IBMi = require("./api/IBMi");
const IBMiContent = require("./api/IBMiContent");

const vscode = require('vscode');

module.exports = class {
  static setConnection(conn) {
    instance.connection = conn;
    instance.content = new IBMiContent(instance.connection);
  };

  static getConnection() {return instance.connection};
  static getContent() {return instance.content};

  static loadAllofExtension() {
    const memberBrowser = require('./views/memberBrowser');
    
    if (instance.connection) {
      vscode.window.registerTreeDataProvider(
        'memberBrowser',
        new memberBrowser()
      );
    }
  }
};

var instance = {
  /** @type {IBMi} */
  connection: undefined,
  /** @type {IBMiContent} */
  content: undefined, //IBM
};