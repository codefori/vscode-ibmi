import path from "path";
import vscode from "vscode";
import { instance } from "../../instantiate";
import { t } from "../../locale";
import { SERVICE_CERTIFICATE } from "./certificates";

type ConfigLine = {
  key: string
  value?: string
}
export const DEBUG_CONFIG_FILE = "/QIBM/ProdData/IBMiDebugService/bin/DebugService.env";

export class DebugConfiguration {
  readonly configLines: ConfigLine[] = [];

  private getContent() {
    const content = instance.getContent();
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
    const content = (await this.getContent().downloadStreamfileRaw(DEBUG_CONFIG_FILE)).toString("utf-8");
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
    await this.getContent().writeStreamfileRaw(DEBUG_CONFIG_FILE, Buffer.from(this.configLines.map(line => `${line.key}${line.value !== undefined ? `=${line.value}` : ''}`).join("\n"), `utf8`));
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

export async function getDebugServiceDetails(): Promise<DebugServiceDetails> {
  const content = instance.getContent()!;
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

    const detailFilePath = path.posix.join((await new DebugConfiguration().load()).getRemoteServiceRoot(), `package.json`);
    const detailExists = await content.testStreamFile(detailFilePath, "r");
    if (detailExists) {
      try {
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
      } catch (e) {
        // Something very very bad has happened
        vscode.window.showErrorMessage(t('detail.reading.error', detailFilePath, e));
        console.log(e);
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
  return debugServiceDetails;
}

export function getJavaHome(version: string) {
  switch (version) {
    case "11": return `/QOpenSys/QIBM/ProdData/JavaVM/jdk11/64bit`;
    default: return `/QOpenSys/QIBM/ProdData/JavaVM/jdk80/64bit`;
  }
}