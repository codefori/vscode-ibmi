
import path from "path";
import IBMi from "../../IBMi";
import { ComponentIdentification, IBMiComponent, SecureComponentState } from "../../components/component";

export class CustomCLI implements IBMiComponent {
  static DEFAULT_ID = "customCli";
  static SIGNATURE = "ForTests";
  id: string;

  installPath = "";

  constructor(id: string = CustomCLI.DEFAULT_ID) {
    this.id = id;
  }

  getIdentification(): ComponentIdentification {
    return { name: this.id, version: 1, userManaged: true, signature: CustomCLI.SIGNATURE };
  }

  getFileName() {
    const id = this.getIdentification();
    return `${id.name}_${id.version}`;
  }

  async setInstallDirectory(installDirectory: string): Promise<void> {
    this.installPath = path.posix.join(installDirectory, this.getFileName());
  }

  async getRemoteState(connection: IBMi, installDirectory: string): Promise<SecureComponentState> {
    this.installPath = path.posix.join(installDirectory, this.getFileName());
    const result = await connection.getContent().testStreamFile(this.installPath, "r");

    if (!result) {
      return { status: `NotInstalled`, remoteSignature: CustomCLI.SIGNATURE  };
    }

    const testResult = await connection.getContent().testStreamFile(this.installPath, "r");

    if (!testResult) {
      return { status: `Error`, remoteSignature: CustomCLI.SIGNATURE  };
    }

    return { status: `Installed`, remoteSignature: CustomCLI.SIGNATURE };
  }

  async update(connection: IBMi): Promise<SecureComponentState> {
    await connection.getContent().writeStreamfileRaw(this.installPath, JSON.stringify(this.getIdentification()));
    return { status: `Installed`, remoteSignature: CustomCLI.SIGNATURE };
  }

  async uninstall(connection: IBMi): Promise<void> {
    await connection.sendCommand({ command: `rm ${this.installPath}` });
  }
}