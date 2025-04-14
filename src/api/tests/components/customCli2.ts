
import { stat } from "fs/promises";
import path from "path";
import IBMi from "../../IBMi";
import { IBMiComponent, ComponentState } from "../../components/component";

export class CustomCLI2 implements IBMiComponent {
  static ID = "customCli";

  installPath = "";

  getIdentification() {
    return { name: CustomCLI2.ID, version: 2, userManaged: true };
  }

  getFileName() {
    const id = this.getIdentification();
    return `${id.name}_${id.version}`;
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

    const testResult = await connection.getContent().testStreamFile(this.installPath, "x");

    if (!testResult) {
      return `Error`;
    }

    return `Installed`;
  }

  async update(connection: IBMi): Promise<ComponentState> {
    await connection.getContent().writeStreamfileRaw(this.installPath, JSON.stringify(this.getIdentification()));

    return `Installed`;
  }

  async uninstall(connection: IBMi): Promise<void> {
    await connection.sendCommand({command: `rm ${this.installPath}`});
  }
}