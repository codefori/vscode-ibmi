
import { stat } from "fs/promises";
import path from "path";
import IBMi from "../../IBMi";
import { ComponentState, IBMiComponent } from "../component";
import { SERVER_VERSION_FILE, VERSION_NUMBER } from "./version";
import { sshSqlJob } from "./sqlJob";

const DEFAULT_JAVA_EIGHT = `/QOpenSys/QIBM/ProdData/JavaVM/jdk80/64bit/bin/java`;

export class Mapepire implements IBMiComponent {
  static ID = "mapepire";
  private localAssetPath: string|undefined;

  setLocalAssetPath(newPath: string) {
    this.localAssetPath = newPath;
  }

  installPath = "";

  getIdentification() {
    return { name: Mapepire.ID, version: VERSION_NUMBER };
  }

  getFileName() {
    return SERVER_VERSION_FILE;
  }

  async setInstallDirectory(installDirectory: string): Promise<void> {
    this.installPath = path.posix.join(installDirectory, this.getFileName());
  }

  async getRemoteState(connection: IBMi, installDirectory: string): Promise<ComponentState> {
    this.installPath = path.posix.join(installDirectory, this.getFileName());
    const result = await connection.getContent().testStreamFile(this.installPath, "x");

    if (!result) {
      return `NotInstalled`;
    }

    return `Installed`;
  }

  async update(connection: IBMi): Promise<ComponentState> {
    if (!this.localAssetPath) {
      return `Error`;
    }

    const assetExistsLocally = await exists(this.localAssetPath);

    if (!assetExistsLocally) {
      return `Error`;
    }

    await connection.getContent().uploadFiles([{ local: this.localAssetPath, remote: this.installPath }]);

    await connection.sendCommand({
      command: `chmod +x ${this.installPath}`,
    });

    return `Installed`;
  }

  getInitCommand(javaVersion = DEFAULT_JAVA_EIGHT): string | undefined {
    if (this.installPath) {
      return `${javaVersion} -Dos400.stdio.convert=N -jar ${this.installPath} --single`
    }
  }

  public static async useExec(connection: IBMi) {
    let useExec = false;

    const bashPathAvailable = connection.remoteFeatures[`bash`];
    if (bashPathAvailable) {
      const commandShellResult = await connection.sendCommand({
        command: `echo $SHELL`
      });
      if (!commandShellResult.stderr) {
        let userDefaultShell = commandShellResult.stdout.trim();
        if (userDefaultShell === bashPathAvailable) {
          useExec = true;
        }
      }
    }

    return useExec;
  }

  public async newJob(connection: IBMi) {
    const sqlJob = new sshSqlJob();
    
    const stream = await sqlJob.getSshChannel(this, connection);
    
    await sqlJob.connectSsh(stream);

    return sqlJob;
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