
import path from "path";
import { workspace } from "vscode";
import IBMi from "../IBMi";

const WORKSPACE_ROOT = `.vscode`;
const SERVER_ROOT = path.posix.join(`/`, `etc`, `.vscode`);

type ConfigResult = `not_loaded`|`no_exist`|`failed_to_parse`|`ok`;

interface LoadResult {
  workspace: ConfigResult;
  server: ConfigResult;
}

export class ConfigFile<T> {
  private state: LoadResult = {server: `not_loaded`, workspace: `not_loaded`};
  private basename: string;
  private workspaceFile: string;
  private serverFile: string;
  private data: T|undefined;

  public hasServerFile = false;
  public mergeArrays = false;
  public validateAndCleanInPlace: ((loadedConfig: any) => T)|undefined;

  constructor(private connection: IBMi, configId: string) {
    this.basename = configId + `.json`;
    this.workspaceFile = path.join(WORKSPACE_ROOT, this.basename);
    this.serverFile = path.posix.join(SERVER_ROOT, this.basename);
  }

  async load(): Promise<T|undefined> {
    if (this.data) return this.data;

    let resultingConfig: any;
    let workspaceConfig: any|undefined;
    let serverConfig: any|undefined;

    if (workspace.workspaceFolders) {
      const configFiles = await workspace.findFiles(`**${this.workspaceFile}`, null, 1);
  
      this.state.server = `no_exist`;
      
      for (const file of configFiles) {
        const content = await workspace.fs.readFile(file);
        try {
          workspaceConfig = JSON.parse(content.toString());
          this.state.workspace = `ok`;
        } catch (e: any) {
          this.state.server = `failed_to_parse`;
        }
      };
    }

    if (this.hasServerFile) {
      this.state.server = `no_exist`;

      const isAvailable = await this.connection.content.testStreamFile(this.serverFile, `r`);
      if (isAvailable) {
        const content = await this.connection.content.downloadStreamfileRaw(this.serverFile);
        try {
          serverConfig = JSON.parse(content.toString());
          this.state.server = `ok`;
        } catch (e: any) {
          this.state.server = `failed_to_parse`;
        }
      } 
    }

    if (workspaceConfig === undefined && serverConfig === undefined) {
      return undefined;
    }

    if (this.mergeArrays && workspaceConfig && serverConfig) {
      resultingConfig = workspaceConfig;
      
      for (const key in serverConfig) {
        if (Array.isArray(serverConfig[key]) && Array.isArray(workspaceConfig[key])) {
          resultingConfig = [...workspaceConfig[key], ...serverConfig[key]];
        }
      }

    } else {
      // Workspace config takes precedence over server config
      resultingConfig = workspaceConfig || serverConfig;
    }


    if (this.validateAndCleanInPlace) {
      // Should throw an error.
      this.validateAndCleanInPlace(resultingConfig);
    }

    this.data = resultingConfig;

    return this.data;
  }

  reset() {
    this.data = undefined;
  }

  getState() {
    return this.state;
  }
}