let {instance} = require(`../instantiate`);
import util from 'util';
import vscode from 'vscode';
import { SSHPutFilesOptions } from 'node-ssh';


module.exports = class qsysFs {
    emitter: vscode.EventEmitter<any>;
    onDidChangeFile: vscode.Event<any>;

  constructor() {
    this.emitter = new vscode.EventEmitter();
    this.onDidChangeFile = this.emitter.event;
  }
  
  /**
   * 
   * @param {vscode.Uri} uri 
   * @returns {Promise<Uint8Array>}
   */
  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    const contentApi = instance.getContent();

    const fileContent = await contentApi.downloadStreamfile(uri.path);
    
    return new Uint8Array(Buffer.from(fileContent, `utf8`));
  }

  /**
   * 
   * @param {vscode.Uri} uri 
   */
  stat(uri: vscode.Uri) {
    return {file: vscode.FileType.File}
  }

  /**
   * @param {vscode.Uri} uri 
   * @param {Buffer} content 
   * @param {SSHPutFilesOptions} options
   */
  writeFile(uri: vscode.Uri, content: Buffer, options?: SSHPutFilesOptions): Promise<string | void> {
    const contentApi = instance.getContent();
    console.log("writing file from IFS");
    return contentApi.writeStreamfile(uri.path, content.toString(`utf8`), options);
  }

  /**
   * @param {vscode.Uri} oldUri 
   * @param {vscode.Uri} newUri 
   * @param {{overwrite: boolean}} options 
   */
  rename(oldUri: vscode.Uri, newUri: vscode.Uri, options?: {overwrite: boolean}) {
    console.log({oldUri, newUri, options});
  }
}