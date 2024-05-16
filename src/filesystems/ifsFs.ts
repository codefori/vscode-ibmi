import vscode, { FileSystemError, FileType } from "vscode";
import { Tools } from "../api/Tools";
import { instance } from "../instantiate";
import { FileStatCache } from "./fileStatCache";
import { getFilePermission } from "./qsys/QSysFs";

export class IFSFS implements vscode.FileSystemProvider {
  private emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> = this.emitter.event;

  private readonly statCache = new FileStatCache();

  constructor(context: vscode.ExtensionContext) {
    instance.onEvent("disconnected", () => { this.statCache.clear() });
    context.subscriptions.push(
      vscode.workspace.onDidCloseTextDocument((doc) => this.statCache.clear(doc.uri)),
      vscode.commands.registerCommand("code-for-ibmi.clearIFSStats", (uri?: vscode.Uri | string) => this.statCache.clear(uri))
    );
  }

  watch(uri: vscode.Uri, options: { readonly recursive: boolean; readonly excludes: readonly string[]; }): vscode.Disposable {
    return { dispose: () => { } };
  }

  async readFile(uri: vscode.Uri, retrying?: boolean): Promise<Uint8Array> {
    const contentApi = instance.getContent();
    if (contentApi) {
      const fileContent = await contentApi.downloadStreamfileRaw(uri.path);
      return fileContent;
    }
    else {
      if (retrying) {
        throw new FileSystemError("Not connected to IBM i");
      }
      else {
        await vscode.commands.executeCommand(`code-for-ibmi.connectToPrevious`);
        return this.readFile(uri, true);
      }
    }
  }

  async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    let currentStat = this.statCache.get(uri);
    if (currentStat === undefined) {
      const content = instance.getContent();
      if (content) {
        const path = uri.path;
        if (await content.testStreamFile(path, "e")) {
          const attributes = await content.getAttributes(path, "CREATE_TIME", "MODIFY_TIME", "DATA_SIZE", "OBJTYPE");
          if (attributes) {
            currentStat = {
              ctime: Tools.parseAttrDate(String(attributes.CREATE_TIME)),
              mtime: Tools.parseAttrDate(String(attributes.MODIFY_TIME)),
              size: Number(attributes.DATA_SIZE),
              type: String(attributes.OBJTYPE) === "*DIR" ? vscode.FileType.Directory : vscode.FileType.File,
              permissions: getFilePermission(uri)
            }
          }
        }
        if (currentStat) {
          this.statCache.set(uri, currentStat);
        } else {
          this.statCache.set(uri, null);
          throw FileSystemError.FileNotFound(uri);
        }
      }
      else {
        currentStat = {
          ctime: 0,
          mtime: 0,
          size: 0,
          type: vscode.FileType.File,
          permissions: getFilePermission(uri)
        }
      }
    }
    else if (currentStat === null) {
      throw FileSystemError.FileNotFound(uri);
    }

    return currentStat;
  }

  async writeFile(uri: vscode.Uri, content: Uint8Array, options: { readonly create: boolean; readonly overwrite: boolean; }) {
    const path = uri.path;
    const exists = this.statCache.get(path);
    this.statCache.clear(path);
    const contentApi = instance.getContent();
    if (contentApi) {
      if (!content.length) { //Coming from "Save as"        
        await contentApi.createStreamFile(path);
      }
      else {
        await contentApi.writeStreamfileRaw(path, content);
      }
      if (!exists) {
        vscode.commands.executeCommand(`code-for-ibmi.refreshIFSBrowser`);
      }
    }
    else {
      throw new FileSystemError("Not connected to IBM i");
    }
  }

  copy(source: vscode.Uri, destination: vscode.Uri, options: { readonly overwrite: boolean; }): void | Thenable<void> {
    this.statCache.clear(destination);
  }

  rename(oldUri: vscode.Uri, newUri: vscode.Uri, options: { readonly overwrite: boolean; }): void | Thenable<void> {
    console.log({ oldUri, newUri, options });
    this.statCache.clear(oldUri);
    this.statCache.clear(newUri);
  }

  async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
    const content = instance.getContent();
    if (content) {
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
      if (await connection.content.testStreamFile(path, "d")) {
        throw FileSystemError.FileExists(uri);
      }
      else {
        const result = await connection.sendCommand({ command: `mkdir -p ${path}` });
        if (result.code === 0) {
          this.statCache.clear(uri);
        }
        else {
          throw FileSystemError.NoPermissions(result.stderr);
        }
      }
    }
  }

  delete(uri: vscode.Uri, options: { readonly recursive: boolean; }): void | Thenable<void> {
    this.statCache.clear(uri);
    throw new FileSystemError(`delete not implemented in IFSFS.`);
  }
}