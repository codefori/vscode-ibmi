import { stringify, parse, ParsedUrlQueryInput } from "querystring";
import vscode, { FilePermission } from "vscode";
import { instance } from "../../instantiate";
import { IBMiSpooledFile, QsysFsOptions } from "../../typings";

export function getSpooledFileUri(splf: IBMiSpooledFile, options?: QsysFsOptions) {
  return getUriFromPath(`${splf.user}/${splf.queue}/${splf.name}~${splf.job_name}~${splf.job_user}~${splf.job_number}~${splf.number}.splf`, options);
}

export function getUriFromPath(path: string, options?: QsysFsOptions) {
  const query = stringify(options as ParsedUrlQueryInput);
  return vscode.Uri.parse(path).with({ scheme: `spooledfile`, path: `/${path}`, query });
}

export function getFilePermission(uri: vscode.Uri): FilePermission | undefined {
  const fsOptions = parseFSOptions(uri);
  if (instance.getConfig()?.readOnlyMode || fsOptions.readonly) {
    return FilePermission.Readonly;
  }
}

export function parseFSOptions(uri: vscode.Uri): QsysFsOptions {
  const parameters = parse(uri.query);
  return {
    readonly: parameters.readonly === `true`
  };
}

export function isProtectedFilter(filter?: string): boolean {
  return filter && instance.getConfig()?.objectFilters.find(f => f.name === filter)?.protected || false;
}

export class SplfFS implements vscode.FileSystemProvider {



  private emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> = this.emitter.event;

  constructor(context: vscode.ExtensionContext) {



    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration(async event => {
        if (event.affectsConfiguration(`code-for-ibmi.connectionSettings`)) {
          this.updateSpooledFileSupport();
        }
      }));

    instance.onEvent("connected", () => this.updateSpooledFileSupport());
    instance.onEvent("disconnected", () => this.updateSpooledFileSupport());
  }
 

  private updateSpooledFileSupport() {

    const connection = instance.getConnection();
    const config = connection?.config;

    if (connection) {
    }

  }

  stat(uri: vscode.Uri): vscode.FileStat {
    return {
      ctime: 0,
      mtime: 0,
      size: 0,
      type: vscode.FileType.File,
      permissions: getFilePermission(uri)
    }
  }

  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    const contentApi = instance.getContent();
    const connection = instance.getConnection();
    if (connection && contentApi) {
      //           0         1            2             3  a          b                c                d                  e       
      // path: `spooledfile://${splf.user}/${splf.queue}/${splf.name}~${splf.job_name}~${splf.job_user}~${splf.job_number}~${splf.number}.splf``,
      const lpath = uri.path.split(`/`);
      const lfilename = lpath[3].split(`~`);
      const qualified_job_name = lfilename[3]+'/'+lfilename[2]+'/'+lfilename[1];
      // const qualified_job_name = lfilename;
      const splf_number = lfilename[4].replace(`.splf`,``);
      const name = lfilename[0];
      
      const spooledFileContent = await contentApi.downloadSpooledFileContent(uri.path, name, qualified_job_name, splf_number, `txt`);
      if (spooledFileContent !== undefined) {
        return new Uint8Array(Buffer.from(spooledFileContent, `utf8`));
      }
      else {
        throw new Error(`Couldn't read ${uri}; check IBM i connection.`);
      }
    }
    else {
      throw new Error("Not connected to IBM i");
    }
  }
  
  async writeFile(uri: vscode.Uri, content: Uint8Array, options: { readonly create: boolean; readonly overwrite: boolean; }) {
    throw new Error("Method not implemented.");
  }

  rename(oldUri: vscode.Uri, newUri: vscode.Uri, options: { readonly overwrite: boolean; }): void | Thenable<void> {
    throw new Error("Method not implemented.");
  }

  watch(uri: vscode.Uri, options: { readonly recursive: boolean; readonly excludes: readonly string[]; }): vscode.Disposable {
    return { dispose: () => { } };
  }

  readDirectory(uri: vscode.Uri): [string, vscode.FileType][] | Thenable<[string, vscode.FileType][]> {
    throw new Error("Method not implemented.");
  }

  createDirectory(uri: vscode.Uri): void | Thenable<void> {
    throw new Error("Method not implemented.");
  }

  delete(uri: vscode.Uri, options: { readonly recursive: boolean; }): void | Thenable<void> {
    throw new Error("Method not implemented.");
  }
}