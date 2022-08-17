
const vscode = require(`vscode`);
const contentApi = require(`./complex/content`);

const Tools = require(`../../api/Tools`);
const instance = require(`../../Instance`);

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
    const connection = instance.getConnection();
    const {asp, library, file, member, extension} = connection.parserMemberPath(uri.path);

    const memberContent = await contentApi.downloadMemberContentWithDates(asp, library, file, member, extension);

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
    const connection = instance.getConnection();
    const {asp, library, file, member, extension} = connection.parserMemberPath(uri.path);

    return contentApi.uploadMemberContentWithDates(asp, library, file, member, extension, content.toString(`utf8`));
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
