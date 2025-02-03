
import { stat } from "fs/promises";
import path from "path";
import IBMi from "../../IBMi";
import { ComponentState, IBMiComponent } from "../component";

export class CustomQSh implements IBMiComponent {
  static ID = "cqsh";
  private localAssetPath: string|undefined;

  setLocalAssetPath(newPath: string) {
    this.localAssetPath = newPath;
  }

  installPath = "";

  getIdentification() {
    return { name: CustomQSh.ID, version: 1 };
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
    const result = await connection.content.testStreamFile(this.installPath, "x");

    if (!result) {
      return `NotInstalled`;
    }

    const testResult = await this.testCommand(connection);

    if (!testResult) {
      return `Error`;
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

    const testResult = await this.testCommand(connection);

    if (!testResult) {
      return `Error`;
    }

    return `Installed`;
  }

  async testCommand(connection: IBMi) {
    const text = `Hello world`;
    const result = await connection.sendCommand({
      stdin: `echo "${text}"`,
      command: this.installPath,
    });

    if (result.code !== 0 || result.stdout !== text) {
      return false;
    }

    return true;
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