
import { stat } from "fs/promises";
import path from "path";
import { SemanticVersion } from "../../../typings";
import { getJavaHome } from "../../configuration/DebugConfiguration";
import IBMi from "../../IBMi";
import { ComponentState, IBMiComponent } from "../component";
import { sshSqlJob } from "./sqlJob";
import { SERVER_FILE_PREFIX, SERVER_VERSION_FILE, VERSION } from "./version";

const DEFAULT_JAVA_EIGHT = `/QOpenSys/QIBM/ProdData/JavaVM/jdk80/64bit`;

export class Mapepire implements IBMiComponent {
  static readonly ID = "mapepire";
  private readonly localAssetPath: string;
  private installPath = "";
  private readonly version: SemanticVersion;

  constructor(localAssetRoot: string) {
    this.localAssetPath = path.join(localAssetRoot, SERVER_VERSION_FILE);
    const rawVersion = /-(\d+)\.(\d+)\.(\d+)\.jar$/.exec(SERVER_VERSION_FILE);
    if (rawVersion) {
      this.version = { major: Number(rawVersion[1]), minor: Number(rawVersion[2]), patch: Number(rawVersion[3]) };
    }
    else {
      this.version = { major: 0, minor: 0, patch: 0 };
    }
  }

  getIdentification() {
    return { name: Mapepire.ID, version: VERSION };
  }

  async setInstallDirectory(installDirectory: string): Promise<void> {
    this.installPath = path.posix.join(installDirectory, path.basename(this.localAssetPath));
  }

  async getRemoteState(connection: IBMi, installDirectory: string): Promise<ComponentState> {
    this.setInstallDirectory(installDirectory);
    const remoteVersions = (await connection.sendCommand({ command: `stat --printf="%n\n" ${SERVER_FILE_PREFIX}*`, directory: installDirectory }))
      .stdout.split("\n")
      .map(line => line.trim())
      .map(line => new RegExp(`${SERVER_FILE_PREFIX}(\\d+)\\.(\\d+)\\.(\\d+)\\.jar$`).exec(line))
      .filter(Boolean)
      .map(version => ({ major: Number(version![1]), minor: Number(version![2]), patch: Number(version![3]) } as SemanticVersion));
    if (!remoteVersions) {
      return `NotInstalled`;
    }
    else if (remoteVersions.every(remoteVersion => remoteVersion.major < this.version.major || (remoteVersion.major === this.version.major && remoteVersion.minor < this.version.minor) || (remoteVersion.major === this.version.major && remoteVersion.minor === this.version.minor && remoteVersion.patch < this.version.patch))) {
      return "NeedsUpdate";
    }
    else {
      return "Installed";
    }
  }


  async update(connection: IBMi): Promise<ComponentState> {
    try {
      if (!this.localAssetPath) {
        throw "Local Mapepire asset not set!";
      }

      const assetExistsLocally = await exists(this.localAssetPath);
      if (!assetExistsLocally) {
        throw `Local Mapepire asset not found at ${this.localAssetPath}!`;
      }

      let result = await connection.sendCommand({ command: `rm ${this.installPath.substring(0, this.installPath.lastIndexOf('-'))}*.jar` });
      if (result.code !== 0) {
        throw `Failed to clear previous Mapepire installation: ${result.stderr}`;
      }

      await connection.getContent().uploadFiles([{ local: this.localAssetPath, remote: this.installPath }]);

      result = await connection.sendCommand({ command: `chmod +x ${this.installPath}` });
      if (result.code !== 0) {
        throw `Failed to make Mapepire jar file executable: ${result.stderr}`;
      }
    }
    catch (error: any) {
      connection.appendOutput(String(error));
      return "Error";
    }

    return `Installed`;
  }

  getInitCommand(javaHome: string): string | undefined {
    if (this.installPath) {
      return `${path.posix.join(javaHome, `bin`, `java`)} -Dos400.stdio.convert=N -jar ${this.installPath} --single`
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

  public async newJob(connection: IBMi, javaPath?: string) {
    const sqlJob = new sshSqlJob();
    sqlJob.options.secure = connection.getConfig().secureSQL;
    javaPath = javaPath || getJavaHome(connection, connection.getConfig().mapepireJavaVersion || "8") || DEFAULT_JAVA_EIGHT;
    const stream = await sqlJob.getSshChannel(this, connection, javaPath);
    await sqlJob.connectSsh(stream);
    // sqlJob.setTraceConfig(`IN_MEM`, `ON`);
    // sqlJob.enableLocalTrace();
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