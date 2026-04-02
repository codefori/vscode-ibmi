import { posix } from "path";
import IBMi from "../IBMi";
import { Tools } from "../Tools";
import { ComponentIdentification, ComponentState, IBMiComponent } from "./component";

export class PasswordManager implements IBMiComponent {
  static readonly ID = "CHGPWD";
  static readonly VERSION = 1;
  static readonly SIGNATURE = "";

  getIdentification(): ComponentIdentification {
    return { name: PasswordManager.ID, version: PasswordManager.VERSION, signature: PasswordManager.SIGNATURE };
  }

  async setInstallDirectory?(_installDirectory: string) {
    //Not used
  }

  async getRemoteState(connection: IBMi, _installDirectory: string, signature: string): Promise<ComponentState> {
    const info = await connection.getContent().getSQLComponentInfo(connection.getConfig().tempLibrary.toUpperCase(), PasswordManager.ID, "PROCEDURE");
    if (info) {
      if (info.signature !== signature) {
        return "HashMismatch";
      }
      if (Number(info.version) >= PasswordManager.VERSION) {
        return "Installed";
      }
    }
    return "NeedsUpdate";
  }

  async update(connection: IBMi, _installDirectory: string, signature: string): Promise<ComponentState> {
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
      const info = await connection.getContent().getSQLComponentInfo(connection.getConfig().tempLibrary.toUpperCase(), PasswordManager.ID, "PROCEDURE");
      if (!info) {
        throw new Error("Could not read procedure information");
      }
      return info.signature === signature ? "Installed" : "HashMismatch";
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