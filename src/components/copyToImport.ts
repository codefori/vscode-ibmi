import IBMi from "../api/IBMi";
import { Tools } from "../api/Tools";
import { WrapResult } from "../typings";
import { ComponentState, IBMiComponent } from "./component";

export class CopyToImport implements IBMiComponent {
  static ID = 'CopyToImport';

  static isSimple(statement: string): boolean {
    statement = statement.trim();
    if (statement.endsWith(';')) {
      statement = statement.substring(0, statement.length - 1);
    }

    const parts = statement.split(` `);
    return parts.length === 4 && parts[0].toUpperCase() === `SELECT` && parts[1] === `*` && parts[2].toUpperCase() === `FROM` && parts[3].includes(`.`);
  }

  getIdentification() {
    return { name: CopyToImport.ID, version: 1 };
  }

  getRemoteState(): ComponentState {
    return `Installed`;
  }

  update(): ComponentState | Promise<ComponentState> {
    return this.getRemoteState();
  }

  wrap(connection: IBMi, statement: string): WrapResult {
    const outStmf = connection.getTempRemote(Tools.makeid())!;

    statement = statement.trim();
    if (statement.endsWith(';')) {
      statement = statement.substring(0, statement.length - 1);
    }

    statement = statement.replace(new RegExp(`for bit data`, `gi`), ``);

    let newStatements: string[] = [];
    let requiresQtempTable = true;

    const parts = statement.split(` `);

    let library: string, table: string;

    // If it's a simple statement, then we should use fallback to CPYTOIMPF as it's faster in some cases.
    if (parts.length === 4 && parts[0].toUpperCase() === `SELECT` && parts[1] === `*` && parts[2].toUpperCase() === `FROM` && parts[3].includes(`.`)) {
      const [lib, file] = parts[3].toUpperCase().split(`.`);
      if (file.length <= 10) {
        requiresQtempTable = false;
        library = lib;
        table = file;
      }
    }

    if (requiresQtempTable) {
      library = `QTEMP`;
      table = Tools.makeid(5).toUpperCase();
      newStatements.push(`CREATE TABLE ${library}.${table} AS (${statement}) WITH DATA`);
    }

    newStatements.push(`Call QSYS2.QCMDEXC('` + connection.content.toCl(`CPYTOIMPF`, {
      FROMFILE: `${library!}/${table!} *FIRST`,
      TOSTMF: outStmf,
      MBROPT: `*REPLACE`,
      STMFCCSID: 1208,
      RCDDLM: `*CRLF`,
      DTAFMT: `*DLM`,
      RMVBLANK: `*TRAILING`,
      ADDCOLNAM: `*SQL`,
      FLDDLM: `','`,
      DECPNT: `*PERIOD`
    }).replaceAll(`'`, `''`) + `')`);

    return {
      newStatements,
      outStmf
    };
  }
}