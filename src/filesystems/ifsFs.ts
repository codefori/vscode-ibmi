import vscode, { FileSystemError, FileType } from "vscode";
import { Tools } from "../api/Tools";
import { instance } from "../instantiate";
import { getFilePermission } from "./qsys/QSysFs";

export class IFSFS implements vscode.FileSystemProvider {
  private emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> = this.emitter.event;

  private readonly statCache: Map<string, vscode.FileStat> = new Map;

  constructor(context: vscode.ExtensionContext) {
    instance.onEvent("disconnected", () => { this.statCache.clear() });
    context.subscriptions.push(
      vscode.workspace.onDidCloseTextDocument(() => this.statCache.clear())
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
    const path = uri.path;
    let currentStat = this.statCache.get(path);
    if (!currentStat) {
      const content = instance.getContent();
      if (content) {
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
      this.statCache.set(path, currentStat);
    }

    return currentStat;
  }

  async writeFile(uri: vscode.Uri, content: Uint8Array, options: { readonly create: boolean; readonly overwrite: boolean; }) {
    console.log(options);
    this.statCache.delete(uri.path);
    const contentApi = instance.getContent();
    if (contentApi) {
      await contentApi.writeStreamfileRaw(uri.path, content);
    }
    else {
      throw new Error("Not connected to IBM i");
    }
  }

  copy(source: vscode.Uri, destination: vscode.Uri, options: { readonly overwrite: boolean; }): void | Thenable<void> {
    console.log(source, destination, options);
    this.statCache.delete(destination.path);
  }

  rename(oldUri: vscode.Uri, newUri: vscode.Uri, options: { readonly overwrite: boolean; }): void | Thenable<void> {
    console.log({ oldUri, newUri, options });
    this.statCache.delete(oldUri.path);
    this.statCache.delete(newUri.path);
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
    this.statCache.delete(uri.path);
    throw new Error(`delete not implemented in IFSFS.`);
  }
}