import { posix } from "path";
import IBMi from "../api/IBMi";
import { instance } from "../instantiate";
import { ComponentState, IBMiComponent } from "./component";

export class GetNewLibl implements IBMiComponent {
  static ID = "GetNewLibl";
  getIdentification() {
    return { name: GetNewLibl.ID, version: 1 };
  }

  async getRemoteState(connection: IBMi): Promise<ComponentState> {
    return connection.remoteFeatures[`GETNEWLIBL.PGM`] ? `Installed` : `NotInstalled`;
  }

  update(connection: IBMi): Promise<ComponentState> {
    const config = connection.config!
    const content = instance.getContent();
    return connection.withTempDirectory(async (tempDir): Promise<ComponentState> => {
      const tempSourcePath = posix.join(tempDir, `getnewlibl.sql`);

      await content!.writeStreamfileRaw(tempSourcePath, getSource(config.tempLibrary));
      const result = await connection.runCommand({
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

  async getLibraryListFromCommand(connection: IBMi, ileCommand: string) {
    const tempLib = connection.config!.tempLibrary;
    const resultSet = await connection.runSQL(`CALL ${tempLib}.GETNEWLIBL('${ileCommand.replace(new RegExp(`'`, 'g'), `''`)}')`);

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