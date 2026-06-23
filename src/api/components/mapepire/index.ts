
import { JDBCOptions, SQLJob } from "@ibm/mapepire-js";
import { stat } from "fs/promises";
import path from "path";
import { SemanticVersion } from "../../../typings";
import { getJavaHome } from "../../configuration/DebugConfiguration";
import IBMi from "../../IBMi";
import { IBMiComponent, SecureComponentState } from "../component";
import { SSHSQLJob } from "./sshSqlJob";
import { SERVER_FILE_PREFIX, SERVER_VERSION_FILE, VERSION } from "./version";

const DEFAULT_JAVA_EIGHT = `/QOpenSys/QIBM/ProdData/JavaVM/jdk80/64bit`;

export class Mapepire implements IBMiComponent {
  static readonly ID = "mapepire";
  private static readonly SIGNATURE = "41b1cfa67778ac204426f1dda0b51bd3f45fe3b89c91121d968660140acc0876";

  private readonly localAssetPath: string;
  private installPath = "";
  private readonly version: SemanticVersion;

  readonly jobs: Map<string, SQLJob> = new Map;

  constructor(localAssetRoot: string, private readonly passwordProvider?: (connectionName: IBMi) => Promise<string | undefined>) {
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
    return { name: Mapepire.ID, version: VERSION, signature: Mapepire.SIGNATURE };
  }

  async setInstallDirectory(installDirectory: string): Promise<void> {
    this.installPath = path.posix.join(installDirectory, path.basename(this.localAssetPath));
  }

  async getRemoteState(connection: IBMi, installDirectory: string): Promise<SecureComponentState> {
    this.setInstallDirectory(installDirectory);
    if (connection.getConfig().mapepireUseServer) {
      //No need to upload/check remote JAR file in server mode
      return { status: "Installed", remoteSignature: Mapepire.SIGNATURE };
    }

    const remoteVersions = (await connection.sendCommand({ command: `/QOpenSys/usr/bin/find ${installDirectory} -type f -name ${SERVER_FILE_PREFIX}\\*` }))
      .stdout.split("\n")
      .map(line => line.trim().substring(2))
      .map(line => new RegExp(`${SERVER_FILE_PREFIX}(\\d+)\\.(\\d+)\\.(\\d+)\\.jar$`).exec(line))
      .filter(Boolean)
      .map(version => ({ major: Number(version![1]), minor: Number(version![2]), patch: Number(version![3]) } as SemanticVersion));
    if (remoteVersions.length === 0) {
      return { status: "NotInstalled" };
    }
    else if (remoteVersions.every(remoteVersion => remoteVersion.major < this.version.major || (remoteVersion.major === this.version.major && remoteVersion.minor < this.version.minor) || (remoteVersion.major === this.version.major && remoteVersion.minor === this.version.minor && remoteVersion.patch < this.version.patch))) {
      return { status: "NeedsUpdate" };
    }

    return { status: "Installed", remoteSignature: await connection.getContent().getSHA256FileHash(this.installPath) };
  }


  async update(connection: IBMi): Promise<SecureComponentState> {
    try {
      if (!this.localAssetPath) {
        throw "Local Mapepire asset not set!";
      }

      const assetExistsLocally = await exists(this.localAssetPath);
      if (!assetExistsLocally) {
        throw `Local Mapepire asset not found at ${this.localAssetPath}!`;
      }

      await connection.getContent().uploadFiles([{ local: this.localAssetPath, remote: this.installPath }]);
      const result = await connection.sendCommand({ command: `chmod +x ${this.installPath}` });
      if (result.code !== 0) {
        throw `Failed to make Mapepire jar file executable: ${result.stderr}`;
      }
    }
    catch (error: any) {
      connection.appendOutput(String(error));
      return { status: "Error" };
    }

    return { status: "Installed", remoteSignature: await connection.getContent().getSHA256FileHash(this.installPath) };
  }

  getInitCommand(javaHome: string): string | undefined {
    if (this.installPath) {
      return `${javaHome ? path.posix.join(javaHome, `bin`, `java`) : 'java'} -Dos400.stdio.convert=N -jar ${this.installPath} --single`
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

  public async newJob(connection: IBMi, options?: { javaPath?: string, jdbc?: JDBCOptions }) {
    const config = connection.getConfig();
    const useServer = config.mapepireUseServer;
    const sqlJob = useServer ? new SQLJob(options?.jdbc) : new SSHSQLJob(options?.jdbc);
    sqlJob.options.secure = sqlJob.options.secure || config.secureSQL;
    if (useServer) {
      connection.appendOutput(`Connecting to Mapepire over HTTP on port ${config.mapepireServerPort}${config.mapepireAllowSelfCert ? ", allowing self-signed certificates" : ""}`);
      //HTTP connection
      const password = await this.getPassword(connection);
      if (!password) {
        throw new Error("No password provided; cannot connect to Mapepire Server");
      }
      await sqlJob.connect({
        host: connection.currentHost,
        user: connection.currentUser,
        password,
        rejectUnauthorized: (config.mapepireAllowSelfCert !== true),
        port: config.mapepireServerPort
      });
    }
    else {
      //Single mode over SSH
      connection.appendOutput(`Connecting to Mapepire over SSH in single mode`);
      const sshJob = sqlJob as SSHSQLJob;
      let javaPath = options?.javaPath;
      if (!javaPath) {
        const javaVersion = config.mapepireJavaVersion;
        if (Number.isNaN(Number(javaVersion))) {
          javaPath = "";
        }
        else {
          javaPath = getJavaHome(connection, javaVersion) || DEFAULT_JAVA_EIGHT;
        }
      }
      const stream = await sshJob.getSshChannel(this, connection, javaPath);
      await sshJob.connectSsh(connection, stream);
    }

    // sqlJob.setTraceConfig(`IN_MEM`, `ON`);
    // sqlJob.enableLocalTrace();
    return sqlJob;
  }

  public async endJobs() {
    await Promise.all([...this.jobs.values()].map(job => job.close()));
  }

  reset() {
    this.jobs.clear();
  }

  private async getPassword(connection: IBMi) {
    return this.passwordProvider?.(connection);
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