
import { createNodeSSHConnection, JDBCOptions, JAR_SHA256 as MAPEPIRE_SIGNATURE, VERSION as MAPEPIRE_VERSION, SQLJob } from "@ibm/mapepire-js";
import path from "path";
import { getJavaHome } from "../../configuration/DebugConfiguration";
import IBMi from "../../IBMi";
import { IBMiComponent, SecureComponentState } from "../component";

export class Mapepire implements IBMiComponent {
  static readonly ID = "mapepire";

  private readonly jobs: Map<string, SQLJob> = new Map;
  private readonly status: SecureComponentState = { status: "Installed", remoteSignature: MAPEPIRE_SIGNATURE };
  private installDirectory = "";

  constructor(public application: string, private readonly passwordProvider?: (connectionName: IBMi) => Promise<string | undefined>) {

  }

  getIdentification() {
    return { name: Mapepire.ID, version: MAPEPIRE_VERSION, signature: MAPEPIRE_SIGNATURE };
  }

  async getRemoteState(_connection: IBMi, installDirectory: string): Promise<SecureComponentState> {
    this.installDirectory = installDirectory;
    //Remote check is managed by mapepire-js - we always assume it's OK at this stage
    return this.status;
  }


  async update(_connection: IBMi): Promise<SecureComponentState> {
    //Update is managed by mapepire-js
    return this.status;
  }

  public async newJob(connection: IBMi, options?: { javaPath?: string, jdbc?: JDBCOptions, application?: string }) {
    const config = connection.getConfig();
    const useServer = config.mapepireUseServer;
    const sqlJob = useServer ?
      //websocket client
      new SQLJob() :
      //single mode
      SQLJob.withConfig({
        transport: "ssh-single",
        sshSingle: {
          ...createNodeSSHConnection(connection.client!),
          javaPath: getJavaPath(connection, options?.javaPath),
          privateInstallDir: this.installDirectory
        }
      });
    sqlJob.options.secure = sqlJob.options.secure || config.secureSQL;
    sqlJob.options.naming = sqlJob.options.naming || config.sqlJobNaming as ("sql" | "system" | undefined);
    sqlJob.options["extended metadata"] = sqlJob.options["extended metadata"] ?? config.mapepireExtendedMetadata;
    const application = options?.application || this.application;
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
      },
        //uncomment if https://github.com/Mapepire-IBMi/mapepire-js/pull/103 gets merged and released
        //application
      );
    }
    else {
      //Single mode over SSH
      await sqlJob.connect(undefined,
        //uncomment if https://github.com/Mapepire-IBMi/mapepire-js/pull/103 gets merged and released
        //application
      );
    }

    this.jobs.set(sqlJob.getUniqueId(), sqlJob);

    let closeJob = sqlJob.close;
    closeJob = closeJob.bind(sqlJob);
    sqlJob.close = async () => {
      this.jobs.delete(sqlJob.getUniqueId());
      closeJob();
    }

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

function getJavaPath(connection: IBMi, javaPath?: string) {
  if (!javaPath) {
    const javaVersion = connection.getConfig().mapepireJavaVersion;
    if (!Number.isNaN(Number(javaVersion))) {
      const javaHome = getJavaHome(connection, javaVersion) || undefined;
      if(javaHome){
        javaPath = path.posix.join(javaHome, 'bin', 'java');
      }
    }
  }

  return javaPath;
}