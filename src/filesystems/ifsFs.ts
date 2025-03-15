import vscode, { FileSystemError, FileType } from "vscode";
import { Tools } from "../api/Tools";
import { instance } from "../instantiate";
import { reconnectFS } from "./qsys/FSUtils";
import { getFilePermission } from "./qsys/QSysFs";

export class IFSFS implements vscode.FileSystemProvider {
  private readonly savedAsFiles: Set<string> = new Set;
  private emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> = this.emitter.event;

  watch(uri: vscode.Uri, options: { readonly recursive: boolean; readonly excludes: readonly string[]; }): vscode.Disposable {
    return { dispose: () => { } };
  }

  async readFile(uri: vscode.Uri, retrying?: boolean): Promise<Uint8Array> {
    const connection = instance.getConnection();
    if (connection) {
      const contentApi = connection.getContent();
      const fileContent = await contentApi.downloadStreamfileRaw(uri.path);
      return fileContent;
    }
    else {
      if (retrying) {
        throw new FileSystemError("Not connected to IBM i");
      }
      else {
        if (await reconnectFS(uri)) {
          return this.readFile(uri, true);
        }
        else {
          return Buffer.alloc(0);
        }
      }
    }
  }

  async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    const connnection = instance.getConnection();
    if (connnection) {
      const content = connnection.getContent();
      const path = uri.path;
      if (await content.testStreamFile(path, "e")) {
        const attributes = await content.getAttributes(path, "CREATE_TIME", "MODIFY_TIME", "DATA_SIZE", "OBJTYPE");
        if (attributes) {
          const type = String(attributes.OBJTYPE) === "*DIR" ? vscode.FileType.Directory : vscode.FileType.File;
          return {
            ctime: Tools.parseAttrDate(String(attributes.CREATE_TIME)),
            mtime: Tools.parseAttrDate(String(attributes.MODIFY_TIME)),
            size: Number(attributes.DATA_SIZE),
            type,
            permissions: !this.savedAsFiles.has(path) && type !== FileType.Directory ? getFilePermission(uri) : undefined
          }
        }
      }
      throw FileSystemError.FileNotFound(uri);
    }
    else {
      return {
        ctime: 0,
        mtime: 0,
        size: 0,
        type: vscode.FileType.File,
        permissions: getFilePermission(uri)
      }
    }
  }

  async writeFile(uri: vscode.Uri, content: Uint8Array, options: { readonly create: boolean; readonly overwrite: boolean; }) {
    const path = uri.path;
    const connection =  instance.getConnection();
    if (connection) {
      const contentApi = connection.getContent();
      if (!content.length) { //Coming from "Save as"    
        this.savedAsFiles.add(path);
        await contentApi.createStreamFile(path);
        vscode.commands.executeCommand(`code-for-ibmi.refreshIFSBrowser`);
      }
      else {
        this.savedAsFiles.delete(path);
        await contentApi.writeStreamfileRaw(path, content);
      }
    }
    else {
      throw new FileSystemError("Not connected to IBM i");
    }
  }

  copy(source: vscode.Uri, destination: vscode.Uri, options: { readonly overwrite: boolean; }): void | Thenable<void> {
    //not used at the moment
  }

  rename(oldUri: vscode.Uri, newUri: vscode.Uri, options: { readonly overwrite: boolean; }): void | Thenable<void> {
    //not used at the moment
  }

  async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
    const connection = instance.getConnection();
    if (connection) {
      const content = connection.getContent();
      return (await content.getFileList(uri.path)).map(ifsFile => ([ifsFile.name, ifsFile.type === "directory" ? FileType.Directory : FileType.File]));
    }
    else {
      throw new FileSystemError("Not connected to IBM i");
    }
  }

  async createDirectory(uri: vscode.Uri) {
    const connection = instance.getConnection();
    if (connection) {
      const path = uri.path;
      if (await connection.getContent().testStreamFile(path, "d")) {
        throw FileSystemError.FileExists(uri);
      }
      else {
        const result = await connection.sendCommand({ command: `mkdir -p ${path}` });
        if (result.code !== 0) {
          throw FileSystemError.NoPermissions(result.stderr);
        }
      }
    }
  }

  delete(uri: vscode.Uri, options: { readonly recursive: boolean; }): void | Thenable<void> {
    throw new FileSystemError(`delete not implemented in IFSFS.`);
  }
}