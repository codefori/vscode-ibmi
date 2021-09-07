
const vscode = require(`vscode`);
const contentApi = require(`./complex/content`);

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
    const path = uri.path.split(`/`);
    let asp, lib, file, fullName;

    if (path.length === 4) {
      lib = path[1];
      file = path[2];
      fullName = path[3];
    } else {
      asp = path[1];
      lib = path[2];
      file = path[3];
      fullName = path[4];
    }

    const name = fullName.substring(0, fullName.lastIndexOf(`.`));

    try {
      const memberContent = await contentApi.downloadMemberContentWithDates(asp, lib, file, name);

      return new Uint8Array(Buffer.from(memberContent, `utf8`));

    } catch (e) {
      vscode.window.showErrorMessage(e);
    }

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
    const path = uri.path.split(`/`);
    let asp, lib, file, fullName;

    if (path.length === 4) {
      lib = path[1];
      file = path[2];
      fullName = path[3];
    } else {
      asp = path[1];
      lib = path[2];
      file = path[3];
      fullName = path[4];
    }

    const name = fullName.substring(0, fullName.lastIndexOf(`.`));

    return contentApi.uploadMemberContentWithDates(asp, lib, file, name, content.toString(`utf8`));
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
