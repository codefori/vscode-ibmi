
const vscode = require(`vscode`);
const { getFilePermission } = require(`./qsys/QSysFs`);

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
    const {instance} = (require(`../instantiate`));
    const contentApi = instance.getContent();

    const fileContent = await contentApi.downloadStreamfile(uri.path);

    return new Uint8Array(Buffer.from(fileContent, `utf8`));
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
    const {instance} = (require(`../instantiate`));
    const contentApi = instance.getContent();
    return contentApi.writeStreamfile(uri.path, content.toString(`utf8`));  
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