
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
    const result = await this.connection.content.testStreamFile(remotePath, "x");

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

    await this.connection.uploadFiles([{ local: assetPath, remote: remotePath }]);

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

function getSource(library: string) {
  return Buffer.from([
    `CREATE OR REPLACE PROCEDURE ${library}.GETNEWLIBL(IN COMMAND VARCHAR(2000))`,
    `DYNAMIC RESULT SETS 1 `,
    `BEGIN`,
    `  DECLARE clibl CURSOR FOR `,
    `    SELECT ORDINAL_POSITION, TYPE as PORTION, SYSTEM_SCHEMA_NAME`,
    `    FROM QSYS2.LIBRARY_LIST_INFO;`,
    `  CALL QSYS2.QCMDEXC(COMMAND);`,
    `  OPEN clibl;`,
    `END;`,
    ``,
    `call QSYS2.QCMDEXC( 'grtobjaut ${library}/GETNEWLIBL *PGM *PUBLIC *ALL' );`
  ].join(`\n`), "utf8");
}

async function exists(path: string) {
  try {
    await stat(path);
    return true;
  } catch (e) {
    return false;
  }
}