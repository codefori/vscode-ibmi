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
        throw new Error("Not connected to IBM i");
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
        if (!currentStat) {
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
      this.statCache.set(uri, currentStat);
    }
    else if (currentStat === null) {
      throw FileSystemError.FileNotFound(uri);
    }

    return currentStat;
  }

  async writeFile(uri: vscode.Uri, content: Uint8Array, options: { readonly create: boolean; readonly overwrite: boolean; }) {
    console.log(options);
    const path = uri.path;
    const exists = this.statCache.get(path);
    this.statCache.clear(path);
    const contentApi = instance.getContent();
    if (contentApi) {
      if (!content.length) {
        //Coming from "Save as"; we await so the next call to stat finds the new file
        await contentApi.createStreamFile(path);
      }
      else {
        contentApi.writeStreamfileRaw(path, content);
      }
      if (!exists) {
        vscode.commands.executeCommand(`code-for-ibmi.refreshIFSBrowser`);
      }
    }
    else {
      throw new Error("Not connected to IBM i");
    }
  }

  copy(source: vscode.Uri, destination: vscode.Uri, options: { readonly overwrite: boolean; }): void | Thenable<void> {
    console.log(source, destination, options);
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
      return (await content.getFileList(uri.path)).map(ifsFile => ([ifsFile.path, ifsFile.type === "directory" ? FileType.Directory : FileType.File]));
    }
    else {
      throw new Error("Not connected to IBM i");
    }
  }

  createDirectory(uri: vscode.Uri): void | Thenable<void> {
    throw new Error(`createDirectory not implemented in IFSFS.`);
  }

  delete(uri: vscode.Uri, options: { readonly recursive: boolean; }): void | Thenable<void> {
    this.statCache.clear(uri);
    throw new Error(`delete not implemented in IFSFS.`);
  }
}