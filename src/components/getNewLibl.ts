import { posix } from "path";
import { instance } from "../instantiate";
import { ComponentState, IBMiComponent } from "./component";

export class GetNewLibl extends IBMiComponent {
  getIdentification() {
    return { name: 'GetNewLibl', version: 1 };
  }

  protected async getRemoteState(): Promise<ComponentState> {
    return this.connection.remoteFeatures[`GETNEWLIBL.PGM`] ? `Installed` : `NotInstalled`;
  }

  protected update(): Promise<ComponentState> {
    const config = this.connection.config!
    const content = instance.getContent();
    return this.connection.withTempDirectory(async (tempDir): Promise<ComponentState> => {
      const tempSourcePath = posix.join(tempDir, `getnewlibl.sql`);

      await content!.writeStreamfileRaw(tempSourcePath, getSource(config.tempLibrary));
      const result = await this.connection.runCommand({
        command: `RUNSQLSTM SRCSTMF('${tempSourcePath}') COMMIT(*NONE) NAMING(*SQL)`,
        cwd: `/`,
        noLibList: true
      });

      if (!result.code) {
        return `Installed`;
      } else {
        return `Error`;
      }
    });
  }

  async getLibraryListFromCommand(ileCommand: string) {
    const tempLib = this.connection.config!.tempLibrary;
    const resultSet = await this.connection.runSQL(`CALL ${tempLib}.GETNEWLIBL('${ileCommand.replace(new RegExp(`'`, 'g'), `''`)}')`);

    const result = {
      currentLibrary: `QGPL`,
      libraryList: [] as string[]
    };

    resultSet.forEach(row => {
      const libraryName = String(row.SYSTEM_SCHEMA_NAME);
      switch (row.PORTION) {
        case `CURRENT`:
          result.currentLibrary = libraryName;
          break;
        case `USER`:
          result.libraryList.push(libraryName);
          break;
      }
    })

    return result;
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