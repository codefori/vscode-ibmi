
const vscode = require(`vscode`);
const {instance} = require(`../../instantiate`);
const { getFilePermission } = require(`./QSysFs`);

module.exports = class basicQsysFs {
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
    const connection = instance.getConnection();

    const {asp, library, file, member} = connection.parserMemberPath(uri.path);

    const memberContent = await contentApi.downloadMemberContent(asp, library, file, member);

    return new Uint8Array(Buffer.from(memberContent, `utf8`));
  }

  /**
   * 
   * @param {vscode.Uri} uri 
   * @returns {vscode.FileStat}
   */
  stat(uri) {
    return {file: vscode.FileType.File, permissions: getFilePermission(uri)}
  }

  /**
   * @param {vscode.Uri} uri 
   * @param {Buffer} content 
   * @param {*} options 
   */
  writeFile(uri, content, options) {    
    const contentApi = instance.getContent();
    const connection = instance.getConnection();
    const {asp, library, file, member} = connection.parserMemberPath(uri.path);
    return contentApi.uploadMemberContent(asp, library, file, member, content.toString(`utf8`));
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