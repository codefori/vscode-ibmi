
import path from "path";
import {posix} from "path";
import IBMi from "../api/IBMi";
import { instance } from "../instantiate";
import { ComponentT, ComponentState } from "./component";
import { extensions } from "vscode";
import { promises as fsPromises } from "fs";

const {stat} = fsPromises;

export const VERSION = `2.1.4`;
export const VERSION_NUMBER = 214;
export const SERVER_VERSION_TAG = `v${VERSION}`;
export const SERVER_VERSION_FILE = `mapepire-server-${VERSION}.jar`;

const ExecutablePathDir = `$HOME/.vscode/`;

export class Mapepire implements ComponentT {
  public state: ComponentState = ComponentState.NotInstalled;
  public currentVersion: number = VERSION_NUMBER;
  
  private componentPath: string | undefined;

  constructor(public connection: IBMi) { }

  private async getComponentPath(justDir = false) {
    if (!this.componentPath) {
      const result = await this.connection.sendCommand({
        command: `echo "${ExecutablePathDir}"`,
      });

      this.componentPath = result.stdout.trim();
    }
    return posix.join(this.componentPath, justDir ? '' : SERVER_VERSION_FILE);
  }

  async getInstalledVersion(): Promise<number> {
    const path = this.getComponentPath();
    const exists = await this.connection.sendCommand({
      command: `ls ${this.getComponentPath()}`
    });

    return (exists.code === 0 ? VERSION_NUMBER : 0);
  }

  async checkState(): Promise<boolean> {
    const installedVersion = await this.getInstalledVersion();

    if (installedVersion === this.currentVersion) {
      this.state = ComponentState.Installed;
      return true;
    }
    
    const extensionPath = extensions.getExtension(`halcyontechltd.code-for-ibmi`)!.extensionPath;

    const assetPath = path.join(extensionPath, `dist`, SERVER_VERSION_FILE);
    const assetExistsLocally = await exists(assetPath);
 
    if (assetExistsLocally) {
      const installedFile = await this.getComponentPath();
      this.connection.uploadFiles([{local: assetPath, remote: installedFile}]);

      this.state = ComponentState.Installed;
    } else {
      this.state = ComponentState.Error;
    }

    return this.state === ComponentState.Installed;
  }

  getState(): ComponentState {
    return this.state;
  }
}

async function exists(path: string) {
  try {
    await stat(path);
    return true;
  } catch (e) {
    return false;
  }
}