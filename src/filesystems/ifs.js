
const util = require(`util`);
const vscode = require(`vscode`);
let {instance} = require(`../instantiate`);
const { parseFSOptions } = require("./qsys/QSysFs");

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

    const fileContent = await contentApi.downloadStreamfile(uri.path);

    return new Uint8Array(Buffer.from(fileContent, `utf8`));
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
    if(parseFSOptions(uri).readOnly){
      throw new Error("Member opened in read only mode: saving is disabled");
    }
    
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