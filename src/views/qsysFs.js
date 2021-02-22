
const util = require('util');
const vscode = require('vscode');
var instance = require('../instance');

module.exports = class qsysFs {
  constructor() {
    this.emitter = new vscode.EventEmitter();
    this.onDidChangeFile = this.emitter.event;
  }
  
  /**
   * 
   * @param {vscode.Uri} uri 
   * @returns {Promise<Uint8Array>}
   */
  async readFile(uri) {
    const contentApi = instance.getContent();
    const [blank, lib, file, fullName] = uri.path.split('/');
    const name = fullName.substring(0, fullName.lastIndexOf('.'));

    const memberContent = await contentApi.downloadMemberContent(undefined, lib, file, name);

    return new Uint8Array(Buffer.from(memberContent, 'utf8'));
  }

  /**
   * 
   * @param {vscode.Uri} uri 
   */
  stat(uri) {
    return {file: vscode.FileType.File}
  }

  /**
   * @param {vscode.Uri} uri 
   * @param {Buffer} content 
   * @param {*} options 
   */
  writeFile(uri, content, options) {
    const contentApi = instance.getContent();
    const [blank, lib, file, fullName] = uri.path.split('/');
    const name = fullName.substring(0, fullName.lastIndexOf('.'));

    return contentApi.uploadMemberContent(undefined, lib, file, name, content.toString('utf8'));
  }

  /**
   * @param {vscode.Uri} oldUri 
   * @param {vscode.Uri} newUri 
   * @param {{overwrite: boolean}} options 
   */
  rename(oldUri, newUri, options) {
    console.log({oldUri, newUri, options});
  }
}