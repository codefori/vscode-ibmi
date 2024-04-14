import { instance } from "../../instantiate";
import { SERVICE_CERTIFICATE } from "./certificates";

type ConfigLine = {
  key: string
  value?: string
}

export class DebugConfiguration {
  readonly configLines: ConfigLine[] = [];
  readonly configurationFile = "/QIBM/ProdData/IBMiDebugService/bin/DebugService.env";

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
    if(index > -1){
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
    const content = (await this.getContent().downloadStreamfileRaw(this.configurationFile)).toString("utf-8");
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
    await this.getContent().writeStreamfileRaw(this.configurationFile, Buffer.from(this.configLines.map(line => `${line.key}${line.value !== undefined ? `=${line.value}` : ''}`).join("\n"), `utf8`));
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
}