import { posix } from "path";
import IBMi from "../IBMi";
import { Tools } from "../Tools";
import { ComponentState, IBMiComponent } from "../components/component";
import { IBMiMember } from "../types";

export class GetMemberInfo implements IBMiComponent {
  static ID = 'GetMemberInfo';
  private readonly procedureName = 'GETMBRINFO';
  private readonly currentVersion = 1;
  private installedVersion = 0;

  reset() {
    this.installedVersion = 0;
  }

  getIdentification() {
    return { name: GetMemberInfo.ID, version: this.installedVersion };
  }

  async getRemoteState(connection: IBMi): Promise<ComponentState> {
    const [result] = await connection.runSQL(`select cast(LONG_COMMENT as VarChar(200)) LONG_COMMENT from qsys2.sysroutines where routine_schema = '${connection.config?.tempLibrary.toUpperCase()}' and routine_name = '${this.procedureName}'`);
    if (result?.LONG_COMMENT) {
      const comment = result.LONG_COMMENT as string;
      const dash = comment.indexOf('-');
      if (dash > -1) {
        this.installedVersion = Number(comment.substring(0, dash).trim());
      }
    }
    if (this.installedVersion < this.currentVersion) {
      return `NeedsUpdate`;
    }

    return `Installed`;
  }

  async update(connection: IBMi): Promise<ComponentState> {
    return connection.withTempDirectory(async tempDir => {
      const tempSourcePath = posix.join(tempDir, `getMemberInfo.sql`);
      await connection.getContent().writeStreamfileRaw(tempSourcePath, getSource(connection.getConfig().tempLibrary, this.procedureName, this.currentVersion));
      const result = await connection.runCommand({
        command: `RUNSQLSTM SRCSTMF('${tempSourcePath}') COMMIT(*NONE) NAMING(*SQL)`,
        cwd: `/`,
        noLibList: true
      });

      if (result.code) {
        return `Error`;
      } else {
        return `Installed`;
      }
    });
  }

  async getMemberInfo(connection: IBMi, library: string, sourceFile: string, member: string): Promise<IBMiMember | undefined> {
    const config = connection.config!;
    const tempLib = config.tempLibrary;
    const statement = `select * from table(${tempLib}.${this.procedureName}('${library}', '${sourceFile}', '${member}'))`;

    let results: Tools.DB2Row[] = [];
    if (config.enableSQL) {
      try {
        results = await connection.runSQL(statement);
      } catch (e) { } // Ignore errors, will return undefined.
    }
    else {
      results = await connection.content.getQTempTable([`create table QTEMP.MEMBERINFO as (${statement}) with data`], "MEMBERINFO");
    }

    if (results.length === 1 && results[0].ISSOURCE === 'Y') {
      const result = results[0];
      const asp = connection.getIAspName(Number(results[0]?.ASP))
      return {
        asp,
        library: result.LIBRARY,
        file: result.FILE,
        name: result.MEMBER,
        extension: result.EXTENSION,
        text: result.DESCRIPTION,
        created: new Date(result.CREATED ? Number(result.CREATED) : 0),
        changed: new Date(result.CHANGED ? Number(result.CHANGED) : 0)
      } as IBMiMember
    }
  }

  async getMultipleMemberInfo(connection: IBMi, members: IBMiMember[]): Promise<IBMiMember[] | undefined> {
    const config = connection.config!;
    const tempLib = config.tempLibrary;
    const statement = members
      .map(member => `select * from table(${tempLib}.${this.procedureName}('${member.library}', '${member.file}', '${member.name}'))`)
      .join(' union all ');

    let results: Tools.DB2Row[] = [];
    if (config.enableSQL) {
      try {
        results = await connection.runSQL(statement);
      } catch (e) { }; // Ignore errors, will return undefined.
    }
    else {
      results = await connection.content.getQTempTable([`create table QTEMP.MEMBERINFO as (${statement}) with data`], "MEMBERINFO");
    }

    return results.filter(row => row.ISSOURCE === 'Y').map(result => {
      const asp = connection.getIAspName(Number(result.ASP));
      return {
        asp,
        library: result.LIBRARY,
        file: result.FILE,
        name: result.MEMBER,
        extension: result.EXTENSION,
        text: result.DESCRIPTION,
        created: new Date(result.CREATED ? Number(result.CREATED) : 0),
        changed: new Date(result.CHANGED ? Number(result.CHANGED) : 0)
      } as IBMiMember
    });
  }
}

function getSource(library: string, name: string, version: number) {
  return Buffer.from([
    `create or replace procedure ${library}.QUSRMBRD(`,
    `  inout Buf     char( 135 )`,
    `, in    BufLen  integer`,
    `, in    Format  char(   8 )`,
    `, in    QObj    char(  20 )`,
    `, in    Mbr     char(  10 )`,
    `, in    Ovr     char(   1 )`,
    `)`,
    `language CL`,
    `parameter style general`,
    `program type main`,
    `external name 'QSYS/QUSRMBRD'`,
    `;`,
    `create or replace function ${library}.${name}( inLib char(10), inFil char(10), inMbr char(10) )`,
    `returns table (`,
    `  Library      varchar( 10 )`,
    `, File         varchar( 10 )`,
    `, Member       varchar( 10 )`,
    `, Attr         varchar( 10 )`,
    `, Extension    varchar( 10 )`,
    `, created      timestamp(0)`,
    `, changed      timestamp(0)`,
    `, Description  varchar( 50 )`,
    `, isSource     char( 1 )`,
    `)`,
    `specific ${name}`,
    `modifies sql data`,
    `begin`,
    `  declare  buffer  char( 135 ) for bit data not null default '';`,
    `  declare  BUFLEN  integer     constant 135 ;`,
    `  declare  FORMAT  char(   8 ) constant 'MBRD0100' ;`,
    `  declare  OVR     char(   1 ) constant '0' ;`,
    ``,
    `  call ${library}.QUSRMBRD( buffer, BUFLEN, FORMAT, upper( inFil ) concat upper( inLib ), upper( inMbr ), OVR );`,
    ``,
    `  pipe ( rtrim( substr( Buffer, 19, 10 ) )`,
    `       , rtrim( substr( Buffer,  9, 10 ) )`,
    `       , rtrim( substr( Buffer, 29, 10 ) )`,
    `       , rtrim( substr( Buffer, 39, 10 ) )`,
    `       , rtrim( substr( Buffer, 49, 10 ) )`,
    `       , timestamp_format( case substr( Buffer, 59, 1 )`,
    `                             when '1' then '20' else '19' end concat `,
    `                           substr( Buffer, 60, 12 ) , 'YYYYMMDDHH24MISS')`,
    `       , timestamp_format( case substr( Buffer, 72, 1 )`,
    `                             when '1' then '20' else '19' end concat `,
    `                           substr( Buffer, 73, 12 ), 'YYYYMMDDHH24MISS')`,
    `       , rtrim( substr( Buffer, 85, 50 ) )`,
    `       , case substr( Buffer, 135, 1 ) when '1' then 'Y' else 'N' end`,
    `       );`,
    `  return;`,
    `end;`,
    ``,
    `comment on function ${library}.${name} is '${version} - Validate member information';`,
    ``,
    `call QSYS2.QCMDEXC( 'grtobjaut ${library}/${name} *SRVPGM *PUBLIC *ALL' );`
  ].join(`\n`));
}