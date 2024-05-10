import { posix } from "path";
import IBMi from "../api/IBMi";
import { instance } from "../instantiate";
import { ComponentState, ComponentT } from "./component";

export class IfsWrite implements ComponentT {
  public readonly name = 'IFS_WRITE';
  public state: ComponentState = ComponentState.NotInstalled;
  public currentVersion: number = 3;

  constructor(public connection: IBMi) { }

  async getInstalledVersion(): Promise<number> {
    const config = this.connection.config!
    const lib = config.tempLibrary!;
    const sql = `select LONG_COMMENT from qsys2.sysroutines where routine_schema = '${lib.toUpperCase()}' and routine_name = '${this.name}'`
    const [result] = await this.connection.runSQL(sql);
    if (result && result.LONG_COMMENT) {
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
    return false;
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
call qcmdexc ('crtsrcpf FILE(QTEMP/C) MBR(C) RCDLEN(200)');
insert into qtemp.c (srcdta) values 
    ('{'),
    ('#include <sys/types.h>'),
    ('#include <sys/stat.h>'),
    ('#include <QSYSINC/H/fcntl>'), 
    ('#include <QSYSINC/H/SQLUDF>'),
    ('long chunk, offset, inputLen = 0, len, rc,outfile,l;'),
    ('unsigned char buf [32760];'),
    ('mode_t mode = S_IRUSR | S_IWUSR | S_IXUSR;'),
    ('long option = O_WRONLY | O_CREAT | O_TRUNC | O_CCSID ;'),
    ('IFS_WRITE.NAME.DAT[IFS_WRITE.NAME.LEN] =0;'),
    ('outfile = open(IFS_WRITE.NAME.DAT, option, mode, 1208);'),
    ('rc = sqludf_length(&IFS_WRITE.BUFFER,&inputLen);'),
    ('for (offset = 1; offset <=  inputLen; offset += sizeof(buf) ) { '),
    ('    chunk = inputLen - offset + 1;'),
    ('    if (chunk > sizeof(buf)) chunk = sizeof(buf); '),
    ('    rc = sqludf_substr ('),
    ('         &IFS_WRITE.BUFFER, '),
    ('         offset,'),
    ('         chunk,'),
    ('         buf,'),
    ('         &len'),
    ('    );'),
    ('    l = write(outfile, buf , len);'),
    ('}'),
    ('close (outfile);'),
    ('}')
;

create or replace procedure ${library}.${name}(name varchar(256), buffer clob (16m) ccsid 1208 )
external action 
modifies sql data
specific IFS_WRT
set option output=*print, commit=*ur, dbgview = *source
begin 
    include qtemp/c(c);
end;

comment on procedure ${library}.${name} is '${version} - Write UTF8 contents to streamfile';

call QSYS2.QCMDEXC( 'grtobjaut ${library}/${name} *PGM *PUBLIC *ALL' );
`, 'utf-8');
}