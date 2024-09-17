
import path from "path";
import {posix} from "path";
import IBMi from "../../api/IBMi";
import { instance } from "../../instantiate";
import { ComponentT, ComponentState } from "../component";
import { extensions } from "vscode";
import { promises as fsPromises } from "fs";
import { SshSqlJob } from "./sqlJob";
import { JDBCOptions } from "@ibm/mapepire-js/dist/src/types";

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

  getInitCommand() {
    const path = this.getComponentPath();

    return `/QOpenSys/QIBM/ProdData/JavaVM/jdk80/64bit/bin/java -Dos400.stdio.convert=N -jar ${path} --single`
  }

  private getComponentPath(justDir = false) {
    return posix.join(this.componentPath!, justDir ? '' : SERVER_VERSION_FILE);
  }

  async getInstalledVersion(): Promise<number> {
    const exists = await this.connection.content.testStreamFile(this.getComponentPath(), "x")

    return exists ? this.currentVersion : 0;
  }

  async checkState(): Promise<boolean> {
    if (!this.componentPath) {
      const result = await this.connection.sendCommand({
        command: `echo "${ExecutablePathDir}"`,
      });

      this.componentPath = result.stdout.trim();
    }

    const installedVersion = await this.getInstalledVersion();

    if (installedVersion === this.currentVersion) {
      this.state = ComponentState.Installed;

    } else { 
      const extensionPath = extensions.getExtension(`halcyontechltd.code-for-ibmi`)!.extensionPath;

      const assetPath = path.join(extensionPath, `dist`, SERVER_VERSION_FILE);
      const assetExistsLocally = await exists(assetPath);
  
      if (assetExistsLocally) {
        const installedFile = this.getComponentPath();
        await this.connection.uploadFiles([{local: assetPath, remote: installedFile}]);

        this.state = ComponentState.Installed;
      } else {
        this.state = ComponentState.Error;
      }
    }

    if (this.state === ComponentState.Installed) {
      const newJob = this.getJob();
      const connection = await newJob.connect();

      if (!connection.success) {
        this.state = ComponentState.Error;
      }

      this.connection.setSqlJob(newJob);
    }

    return this.state === ComponentState.Installed;
  }

  getState(): ComponentState {
    return this.state;
  }

  getJob(opts: JDBCOptions = {}): SshSqlJob {
    return new SshSqlJob(opts, this.connection, this.getInitCommand());
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