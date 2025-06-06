import path from "path";
import IBMi from "../IBMi";

export const SERVICE_CERTIFICATE = `debug_service.pfx`;
export const CLIENT_CERTIFICATE = `debug_service.crt`;

type ConfigLine = {
  key: string
  value?: string
}

export const ORIGINAL_DEBUG_CONFIG_FILE = "/QIBM/ProdData/IBMiDebugService/bin/DebugService.env";

export class DebugConfiguration {
  constructor(private connection: IBMi) { }
  readonly configLines: ConfigLine[] = [];

  private getContent() {
    const content = this.connection.getContent();
    if (!content) {
      throw new Error("Not connected to an IBM i");
    }

    return content;
  }

  getOrDefault(key: string, defaultValue: string) {
    return this.get(key) || defaultValue;
  }

  get(key: string) {
    return this.configLines.find(line => line.key === key && line.value !== undefined)?.value;
  }

  async load() {
    const content = (await this.getContent().downloadStreamfileRaw(ORIGINAL_DEBUG_CONFIG_FILE)).toString("utf-8");
    this.configLines.push(...content.split("\n")
      .map(line => line.trim())
      .map(line => {
        const equalPos = line.indexOf("=");
        if (!line || line.startsWith("#") || equalPos === -1) {
          return { key: line };
        }
        else {
          return {
            key: line.substring(0, equalPos),
            value: equalPos < line.length ? line.substring(equalPos + 1) : ''
          }
        }
      })
    );
    return this;
  }

  getRemoteServiceCertificatePath() {
    return this.getOrDefault("DEBUG_SERVICE_KEYSTORE_FILE",  //the actual certificate path, set after it's been configured by Code for i
      `${this.getRemoteServiceWorkDir()}/certs/${SERVICE_CERTIFICATE}`);  //the service working directory as set in the config or its default value
  }

  getRemoteClientCertificatePath() {
    return this.getRemoteServiceCertificatePath().replace(".pfx", ".crt");
  }

  getRemoteServiceRoot() {
    return `${this.getOrDefault("DBGSRV_ROOT", "/QIBM/ProdData/IBMiDebugService")}`;
  }

  getRemoteServiceBin() {
    return `${this.getRemoteServiceRoot()}/bin`;
  }

  getRemoteServiceWorkDir() {
    return this.getOrDefault("DBGSRV_WRK_DIR", "/QIBM/UserData/IBMiDebugService");
  }

  getRemoteServiceWorkspace() {
    return this.getOrDefault("STR_DBGSVR_WRK_ROOT_DIR", "$DBGSRV_WRK_DIR/startDebugService_workspace")
      .replace("$DBGSRV_WRK_DIR", this.getRemoteServiceWorkDir());
  }

  getNavigatorLogFile() {
    return `${this.getRemoteServiceWorkspace()}/startDebugServiceNavigator.log`;
  }
}

interface DebugServiceDetails {
  version: string
  java: string
  semanticVersion: () => {
    major: number
    minor: number
    patch: number
  }
}

let debugServiceDetails: DebugServiceDetails | undefined;

export function resetDebugServiceDetails() {
  debugServiceDetails = undefined;
}

export async function getDebugServiceDetails(connection: IBMi): Promise<DebugServiceDetails> {
  if (!debugServiceDetails) {
    let details = {
      version: `1.0.0`,
      java: `8`,
      semanticVersion: () => ({
        major: 1,
        minor: 0,
        patch: 0
      })
    };

    const content = connection.getContent();
    const detailFilePath = path.posix.join((await new DebugConfiguration(connection).load()).getRemoteServiceRoot(), `package.json`);
    const detailExists = await content.testStreamFile(detailFilePath, "r");
    if (detailExists) {
      const fileContents = (await content.downloadStreamfileRaw(detailFilePath)).toString("utf-8");
      const parsed = JSON.parse(fileContents);
      details = {
        ...parsed as DebugServiceDetails,
        semanticVersion: () => {
          const parts = (parsed.version ? String(parsed.version).split('.') : []).map(Number);
          return {
            major: parts[0],
            minor: parts[1],
            patch: parts[2]
          };
        }
      }
    }
    else {
      details = {
        version: `1.0.0`,
        java: `8`,
        semanticVersion: () => ({
          major: 1,
          minor: 0,
          patch: 0
        })
      };
    }

    debugServiceDetails = details;
  }

  return debugServiceDetails!;
}

export function getJavaHome(connection: IBMi, version: string) {
  version = version.padEnd(2, '0');
  const javaHome = connection.remoteFeatures[`jdk${version}`];
  return javaHome;
}