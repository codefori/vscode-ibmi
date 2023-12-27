import { window } from "vscode";
import Instance from "../../api/Instance";

export async function initGetNewLibl(instance: Instance) {
  const connection = instance.getConnection();
  const config = instance.getConfig();

  // Check if the remote library list tool is installed
  if (connection && config && !connection.remoteFeatures[`GETNEWLIBL.PGM`]) {
    // Time to install our new library list fetcher program

    const content = instance.getContent();

    const tempSourcePath = connection.getTempRemote(`getnewlibl.sql`) || `/tmp/getnewlibl.sql`;

    content!.writeStreamfile(tempSourcePath, getSource(config.tempLibrary)).then(() => {
      connection.runCommand({
        command: `RUNSQLSTM SRCSTMF('${tempSourcePath}') COMMIT(*NONE) NAMING(*SQL)`,
        cwd: `/`,
        noLibList: true
      })
      .then((result) => {
        if (result.code === 0) {
          connection.remoteFeatures[`GETNEWLIBL.PGM`] = `${config.tempLibrary}.GETNEWLIBL`;
        } else {
          window.showWarningMessage(`Unable to install GETNEWLIBL. See Code for IBM i output for details.`);
        }
      })
    })
  }
}

function getSource(library: string) {
  return [
    `CREATE OR REPLACE PROCEDURE ${library}.GETNEWLIBL(IN COMMAND VARCHAR(2000))`,
    `DYNAMIC RESULT SETS 1 `,
    `BEGIN`,
    `  DECLARE clibl CURSOR FOR `,
    `    SELECT ORDINAL_POSITION, TYPE as PORTION, SYSTEM_SCHEMA_NAME`,
    `    FROM QSYS2.LIBRARY_LIST_INFO;`,
    `  CALL QSYS2.QCMDEXC(COMMAND);`,
    `  OPEN clibl;`,
    `END;`,
  ].join(`\n`);
}