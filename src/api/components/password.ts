import { posix } from "path";
import IBMi from "../IBMi";
import { Tools } from "../Tools";
import { ComponentIdentification, ComponentState, IBMiComponent } from "./component";

export class PasswordManager implements IBMiComponent {
  static readonly ID = "CHGPWD";
  static readonly VERSION = 1;

  getIdentification(): ComponentIdentification {
    return { name: PasswordManager.ID, version: PasswordManager.VERSION };
  }

  async setInstallDirectory?(_installDirectory: string) {
    //Not used
  }

  async getRemoteState(connection: IBMi, _installDirectory: string) {
    let version = 0;
    const [result] = await connection.runSQL(`select cast(LONG_COMMENT as VarChar(200)) LONG_COMMENT from qsys2.sysprocs where routine_schema = '${connection.getConfig().tempLibrary.toUpperCase()}' and routine_name = '${PasswordManager.ID}'`);
    if (result?.LONG_COMMENT) {
      const comment = result.LONG_COMMENT as string;
      const dash = comment.indexOf('-');
      if (dash > -1) {
        version = Number(comment.substring(0, dash).trim());
      }
    }
    if (version < PasswordManager.VERSION) {
      return `NeedsUpdate`;
    }

    return `Installed`;
  }

  async update(connection: IBMi, _installDirectory: string): Promise<ComponentState> {
    try {
      await connection.withTempDirectory(async directory => {
        const source = posix.join(directory, `${PasswordManager.ID}.sql`);
        const procedure = `${connection.getConfig().tempLibrary}.${PasswordManager.ID}`;
        await connection.getContent().writeStreamfileRaw(source, /* sql */`
          create or replace procedure ${procedure}(oldPassword varchar(128), newPassword varchar(128))
          language sql
          not deterministic
          begin
            call QSYS.QSYCHGPW(
              '*CURRENT  ', oldPassword, newPassword,
              X'00000000',
              LENGTH(oldPassword), 0, LENGTH(newPassword), 0        
            );
          end;

          comment on procedure ${procedure} is '${PasswordManager.VERSION} - Change password';
          call QSYS2.QCMDEXC('grtobjaut ${connection.getConfig().tempLibrary}/${PasswordManager.ID} *PGM *PUBLIC *ALL');
        `);
        const compile = await connection.runCommand({
          command: `RUNSQLSTM SRCSTMF('${source}') COMMIT(*NONE) NAMING(*SQL) OPTION(*NOSRC)`,
          noLibList: true
        });
        if (compile.code !== 0) {
          throw Error(compile.stderr || compile.stdout);
        }
      });
      return "Installed";
    }
    catch (error: any) {
      connection.appendOutput(`Failed to install ${PasswordManager.ID} procedure:\n${typeof error === "string" ? error : JSON.stringify(error)}`);
      return "Error";
    }
  }

  async getPasswordExpiration(connection: IBMi) {
    const [row] = (await connection.runSQL(`
      Select EXTRACT(EPOCH FROM (DATE_PASSWORD_EXPIRES)) * 1000 AS EXPIRATION,
      DAYS(DATE_PASSWORD_EXPIRES) - DAYS(current_timestamp) as DAYS_LEFT
      FROM TABLE (QSYS2.QSYUSRINFO('${connection.upperCaseName(connection.currentUser)}'))
    `));
    if (row && row.EXPIRATION) {
      return {
        expiration: new Date(Number(row.EXPIRATION)),
        daysLeft: Number(row.DAYS_LEFT)
      }
    }
  }

  async changePassword(connection: IBMi, oldPassword: string, newPassword: string) {
    try {
      await connection.runSQL(`call ${connection.getConfig().tempLibrary}.${PasswordManager.ID}(?, ?)`, { bindings: [oldPassword, newPassword] });
    }
    catch (error: any) {
      if (error instanceof Tools.SqlError) {
        const message = /(\[.*\] )?(.*), \d+/.exec(error.message)?.[2]; //try to keep only the relevent part of the error
        throw new Error(message || error.message);
      }
      else if (error instanceof Error) {
        throw error
      }

      throw Error(String(error));
    }

  }
}