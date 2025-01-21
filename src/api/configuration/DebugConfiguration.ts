import path from "path";
import IBMi from "../IBMi";

export const SERVICE_CERTIFICATE = `debug_service.pfx`;
export const CLIENT_CERTIFICATE = `debug_service.crt`;
export const LEGACY_CERT_DIRECTORY = `/QIBM/ProdData/IBMiDebugService/bin/certs`;

type ConfigLine = {
  key: string
  value?: string
}

export const DEBUG_CONFIG_FILE = "/QIBM/UserData/IBMiDebugService/C4iDebugService.env";
export const ORIGINAL_DEBUG_CONFIG_FILE = "/QIBM/ProdData/IBMiDebugService/bin/DebugService.env";

export class DebugConfiguration {
  constructor(private connection: IBMi) { }
  readonly configLines: ConfigLine[] = [];
  private readOnly = false;

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

  delete(key: string) {
    const index = this.configLines.findIndex(line => line.key === key && line.value !== undefined);
    if (index > -1) {
      this.configLines.splice(index, 1);
    }
  }

  set(key: string, value?: string) {
    let config = this.configLines.find(line => line.key === key && line.value !== undefined);
    if (config) {
      config.value = value;
    }
    else {
      this.configLines.push({ key, value });
    }
  }

  async load() {
    //Since Debug Service 2.0.1: https://github.com/codefori/vscode-ibmi/issues/2416
    if (!await this.getContent().testStreamFile(DEBUG_CONFIG_FILE, "r")) {
      const copyResult = await this.connection.sendCommand({ command: `cp ${ORIGINAL_DEBUG_CONFIG_FILE} ${DEBUG_CONFIG_FILE} && chmod 755 ${DEBUG_CONFIG_FILE}` });
      if (copyResult.code) {
        this.readOnly = true;
      }
    }

    const content = (await this.getContent().downloadStreamfileRaw(this.readOnly ? ORIGINAL_DEBUG_CONFIG_FILE : DEBUG_CONFIG_FILE)).toString("utf-8");
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

  async save() {
    if (!this.readOnly) {
      await this.getContent().writeStreamfileRaw(DEBUG_CONFIG_FILE, Buffer.from(this.configLines.map(line => `${line.key}${line.value !== undefined ? `=${line.value}` : ''}`).join("\n"), `utf8`));
    }
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

  getCode4iDebug() {
    return this.get("CODE4IDEBUG");
  }

  setCode4iDebug(value: string) {
    return this.set("CODE4IDEBUG", value);
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