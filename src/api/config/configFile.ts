
import path from "path";
import { RelativePattern, workspace, WorkspaceFolder } from "vscode";
import IBMi from "../IBMi";
import { ConnectionConfiguration, ConnectionManager, onCodeForIBMiConfigurationChange } from "../../api/Configuration";

const WORKSPACE_ROOT = `.vscode`;
const SERVER_ROOT = path.posix.join(`/`, `etc`, `.vscode`);

type ConfigResult = `not_loaded`|`no_exist`|`failed_to_parse`|`invalid`|`ok`;

interface LoadResult {
  workspace: ConfigResult;
  server: ConfigResult;
}

export class ConfigFile<T> {
  private state: LoadResult = {server: `not_loaded`, workspace: `not_loaded`};
  private basename: string;
  private workspaceFile: string;
  private serverFile: string;
  private serverData: T|undefined;

  public hasServerFile = false;
  public mergeArrays = false;
  public validateAndCleanInPlace: ((loadedConfig: any) => T)|undefined;

  constructor(private connection: IBMi, configId: string, readonly fallback: T) {
    this.basename = configId + `.json`;
    this.workspaceFile = path.join(WORKSPACE_ROOT, this.basename);
    this.serverFile = path.posix.join(SERVER_ROOT, this.basename);
  }

  getPaths() {
    return {
      workspace: this.workspaceFile,
      server: this.serverFile,
    }
  }

  async loadFromServer() {
    let serverConfig: any|undefined;

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

        if (this.validateAndCleanInPlace) {
          // Should throw an error.
          try {
            this.serverData = this.validateAndCleanInPlace(serverConfig);
          } catch (e) {
            this.state.server = `invalid`;
            this.serverData = undefined;
          }
        }
      }
    }
  }

  async get(currentWorkspace?: WorkspaceFolder): Promise<T> {
    let resultingConfig: any;
    let workspaceConfig: any|undefined;

    if (workspace.workspaceFolders && currentWorkspace) {
      const relativeSearch = new RelativePattern(currentWorkspace, `**/${this.workspaceFile}`);
      const configFiles = await workspace.findFiles(relativeSearch, null, 1);
  
      this.state.server = `no_exist`;
      
      for (const file of configFiles) {
        const content = await workspace.fs.readFile(file);
        try {
          workspaceConfig = JSON.parse(content.toString());
          this.state.workspace = `ok`;
        } catch (e: any) {
          this.state.workspace = `failed_to_parse`;
        }
      };
    }

    if (workspaceConfig === undefined && this.serverData === undefined) {
      return this.fallback;
    }

    if (this.mergeArrays && workspaceConfig && this.serverData) {
      resultingConfig = workspaceConfig;
      
    
      for (const key in resultingConfig) {
        if (Array.isArray(resultingConfig[key]) && Array.isArray((this.serverData as any)[key])) {
          resultingConfig[key] = [...workspaceConfig[key], ...(this.serverData as any)[key]];
        }
      }

    } else {
      // Workspace config takes precedence over server config
      resultingConfig = workspaceConfig || this.serverData;
    }


    if (this.validateAndCleanInPlace) {
      // Should throw an error.
      try {
        resultingConfig = this.validateAndCleanInPlace(resultingConfig);
      } catch (e: any) {
        resultingConfig = this.fallback;
        this.state.workspace = `invalid`;
        console.log(`Error validating config file: ${e.message}`);
      }
    }

    return resultingConfig as T;
  }

  reset() {
    this.serverData = undefined;
  }

  getState() {
    return this.state;
  }
}