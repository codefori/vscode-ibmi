import { posix } from "path";
import IBMi from "../api/IBMi";
import { instance } from "../instantiate";
import { ComponentState, ComponentT } from "./component";

export class IfsWrite implements ComponentT {
  public readonly name = 'IFS_WRITE';
  public state: ComponentState = ComponentState.NotInstalled;
  public currentVersion: number = 2;

  constructor(public connection: IBMi) { }

  async getInstalledVersion(): Promise<number> {
    const config = this.connection.config!
    const lib = config.tempLibrary!;
    const sql = `select LONG_COMMENT from qsys2.sysroutines where routine_schema = '${lib.toUpperCase()}' and routine_name = '${this.name}'`
    const [result] = await this.connection.runSQL(sql);
    if (result) {
      const comment = result.LONG_COMMENT as string;
      const dash = comment.indexOf('-');
      if (dash > -1) {
        const version = comment.substring(0, dash).trim();
        return parseInt(version);
      }
    }

    return 0;
  }

  async checkState(): Promise<boolean> {
    const installedVersion = await this.getInstalledVersion();

    if (installedVersion === this.currentVersion) {
      this.state = ComponentState.Installed;
      return true;
    }

    const config = this.connection.config!
    const content = instance.getContent();

    return this.connection.withTempDirectory(async tempDir => {
      const tempSourcePath = posix.join(tempDir, `ifs_write.sql`);

      await content!.writeStreamfileRaw(tempSourcePath, getSource(config.tempLibrary, this.name, this.currentVersion));
      const result = await this.connection.runCommand({
        command: `RUNSQLSTM SRCSTMF('${tempSourcePath}') COMMIT(*NONE) NAMING(*SQL)`,
        cwd: `/`,
        noLibList: true
      });

      if (result.code === 0) {
        this.state = ComponentState.Installed;
      } else {
        this.state = ComponentState.Error;
      }

      return this.state === ComponentState.Installed;
    });
  }

  getState(): ComponentState {
    return this.state;
  }
}

// todo: support CLOB instead of varchar
function getSource(library: string, name: string, version: number) {
  return Buffer.from(`
call qcmdexc ('addlible qsysinc');
call qcmdexc ('crtsrcpf FILE(QTEMP/C) MBR(C)');
delete  from qtemp.c;
insert into qtemp.c (srcdta) values 
    ('{'),
    ('#include <sys/types.h>'),
    ('#include <sys/stat.h>'),
    ('#include <fcntl.h>'), 
    ('int f,l,o;'),
    ('mode_t mode = S_IRUSR | S_IWUSR | S_IXUSR;'),
    ('o = O_WRONLY | O_CREAT | O_TRUNC | O_CCSID ;'),
    ('IFS_WRITE.NAME.DAT[IFS_WRITE.NAME.LEN] =0;'),
    ('f = open(IFS_WRITE.NAME.DAT, o, mode, 1208);'),
    ('l = write(f, IFS_WRITE.BUF.DAT,IFS_WRITE.BUF.LEN);'),
    ('close (f);'),
    ('}')
;

create or replace procedure ${library}.${name}(name varchar(256), buf varchar(32700) ccsid 1208 )
external action 
modifies sql data
set option output=*print, commit=*none, dbgview = *source
begin 
    if buf is not null then 
        include qtemp/c(c);
    end if;
end;

comment on procedure ${library}.${name} is '${version} - Write UTF8 contents to streamfile';
  `, 'utf-8');
}