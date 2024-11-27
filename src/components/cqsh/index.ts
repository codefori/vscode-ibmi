
import { stat } from "fs/promises";
import { ComponentState, IBMiComponent } from "../component";
import path from "path";
import { extensions } from "vscode";

export class cqsh extends IBMiComponent {
  getIdentification() {
    return { name: 'cqsh', version: 1 };
  }

  getFileName() {
    const id = this.getIdentification();
    return `${id.name}_${id.version}`;
  }

  public async getPath() {
    const installDir = await this.getInstallDirectory();
    return path.posix.join(installDir, this.getFileName());
  }

  protected async getRemoteState(): Promise<ComponentState> {
    const remotePath = await this.getPath();
    const result = await this.connection.getContent().testStreamFile(remotePath, "x");

    if (!result) {
      return `NotInstalled`;
    }

    const testResult = await this.testCommand();

    if (!testResult) {
      return `Error`;
    }

    return `Installed`;
  }

  protected async update(): Promise<ComponentState> {
    const extensionPath = extensions.getExtension(`halcyontechltd.code-for-ibmi`)!.extensionPath;
    const remotePath = await this.getPath();

    const assetPath = path.join(extensionPath, `dist`, this.getFileName());
    const assetExistsLocally = await exists(assetPath);

    if (!assetExistsLocally) {
      return `Error`;
    }

    await this.connection.getContent().uploadFiles([{ local: assetPath, remote: remotePath }]);

    await this.connection.sendCommand({
      command: `chmod +x ${remotePath}`,
    });

    const testResult = await this.testCommand();

    if (!testResult) {
      return `Error`;
    }

    return `Installed`;
  }

  async testCommand() {
    const remotePath = await this.getPath();
    const text = `Hello world`;
    const result = await this.connection.sendCommand({
      stdin: `echo "${text}"`,
      command: remotePath,
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