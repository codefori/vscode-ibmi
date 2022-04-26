
const vscode = require(`vscode`);
const contentApi = require(`./complex/content`);

const Tools = require(`../../api/Tools`);

module.exports = class ComplexQsysFs {
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
    const {asp, library, file, member} = Tools.parserMemberPath(uri.path);

    const memberContent = await contentApi.downloadMemberContentWithDates(asp, library, file, member);

    return new Uint8Array(Buffer.from(memberContent, `utf8`));
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
    const {asp, library, file, member} = Tools.parserMemberPath(uri.path);

    return contentApi.uploadMemberContentWithDates(asp, library, file, member, content.toString(`utf8`));
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
