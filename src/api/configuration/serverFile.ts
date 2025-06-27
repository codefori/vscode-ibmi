
import path from "path";
import { RelativePattern, workspace, WorkspaceFolder } from "vscode";
import IBMi from "../IBMi";

const WORKSPACE_ROOT = `.vscode`;
const SERVER_ROOT = path.posix.join(`/`, `etc`, `vscode`);

type ConfigResult = `not_loaded`|`no_exist`|`failed_to_parse`|`invalid`|`ok`;

interface LoadResult {
  server: ConfigResult;
}

export class ConfigFile<T> {
  private state: LoadResult = {server: `not_loaded`};
  private basename: string;
  private serverFile: string;
  private serverData: T|undefined;

  public validateData: ((loadedConfig: any) => T)|undefined;

  constructor(private connection: IBMi, configId: string, readonly fallback: T) {
    this.basename = configId + `.json`;
    this.serverFile = path.posix.join(SERVER_ROOT, this.basename);
  }

  getPaths() {
    return {
      server: this.serverFile,
    }
  }

  async loadFromServer() {
    let serverConfig: any|undefined;

    this.state.server = `no_exist`;

    const isAvailable = await this.connection.getContent().testStreamFile(this.serverFile, `r`);
    if (isAvailable) {
      const content = await this.connection.getContent().downloadStreamfileRaw(this.serverFile);
      try {
        serverConfig = JSON.parse(content.toString());
        this.state.server = `ok`;
      } catch (e: any) {
        this.state.server = `failed_to_parse`;
      }

      if (this.validateData) {
        // Should throw an error.
        try {
          this.serverData = this.validateData(serverConfig);
        } catch (e) {
          this.state.server = `invalid`;
          this.serverData = undefined;
        }
      } else {
        this.serverData = serverConfig;
      }
    }
  }

  async get() {
    return this.serverData;
  }

  reset() {
    this.serverData = undefined;
    this.state.server = `not_loaded`;
  }

  getState() {
    return this.state;
  }
}