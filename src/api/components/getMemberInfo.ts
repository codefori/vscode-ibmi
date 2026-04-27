import { posix } from "path";
import IBMi from "../IBMi";
import { Tools } from "../Tools";
import { IBMiComponent, SecureComponentState } from "../components/component";
import { IBMiMember } from "../types";

export class GetMemberInfo implements IBMiComponent {
  static ID = "GetMemberInfo";
  private static readonly VERSION = 4;
  private static readonly SIGNATURE = "D94305996679982EA232458A89C45EC5BE60DA9E17D138CF44981E002A95F7E5";
  private static readonly FUNCTION_NAME = `MBRINF${GetMemberInfo.VERSION.toString().padStart(4, '0')}`;

  getIdentification() {
    return { name: GetMemberInfo.ID, version: GetMemberInfo.VERSION, signature: GetMemberInfo.SIGNATURE };
  }

  async getRemoteState(connection: IBMi): Promise<SecureComponentState> {
    const remoteSignature = await connection.getContent().getSQLRoutineSignature(connection.getConfig().tempLibrary.toUpperCase(), GetMemberInfo.FUNCTION_NAME, "FUNCTION");
    return { status: remoteSignature ? "Installed" : "NotInstalled", remoteSignature };
  }

  async update(connection: IBMi): Promise<SecureComponentState> {
    return connection.withTempDirectory(async tempDir => {
      const library = connection.getConfig().tempLibrary;
      const tempSourcePath = posix.join(tempDir, `getMemberInfo.sql`);
      await connection.getContent().writeStreamfileRaw(tempSourcePath, getSource(library, GetMemberInfo.FUNCTION_NAME, GetMemberInfo.VERSION));
      const result = await connection.runCommand({
        command: `QSYS/RUNSQLSTM SRCSTMF('${tempSourcePath}') COMMIT(*NONE) NAMING(*SQL) DFTRDBCOL(${library})`,
        cwd: `/`,
        noLibList: true,
        getSpooledFiles: true
      });

      if (result.code !== 0) {
        throw Error(result.stderr || result.stdout);
      }

      return this.getRemoteState(connection);
    });
  }

  private static parseDateString(tsString: string | undefined): Date | undefined {
    if (!tsString) {
      return undefined;
    }

    let possibleDate = new Date(tsString);
    if (!isNaN(possibleDate.getTime())) {
      return possibleDate;
    }

    const dateParts = tsString.split('-');
    const timeParts = dateParts[3].split('.');

    const year = parseInt(dateParts[0], 10);
    const month = parseInt(dateParts[1], 10) - 1; // Months are zero-based in JavaScript
    const day = parseInt(dateParts[2], 10);
    const hours = parseInt(timeParts[0], 10);
    const minutes = parseInt(timeParts[1], 10);
    const seconds = parseInt(timeParts[2], 10);

    return new Date(year, month, day, hours, minutes, seconds);
  }

  async getMemberInfo(connection: IBMi, library: string, sourceFile: string, member: string): Promise<IBMiMember | undefined> {
    const config = connection.getConfig();
    const tempLib = config.tempLibrary;
    const statement = `select * from table(${tempLib}.${GetMemberInfo.FUNCTION_NAME}('${connection.upperCaseName(library)}', '${connection.upperCaseName(sourceFile)}', '${connection.upperCaseName(member)}'))`;

    let results: Tools.DB2Row[] = [];
    if (connection.enableSQL) {
      try {
        results = await connection.runSQL(statement);
      } catch (e) { } // Ignore errors, will return undefined.
    }
    else {
      results = await connection.getContent().getQTempTable([`create table QTEMP.MEMBERINFO as (${statement}) with data`], "MEMBERINFO");
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
        created: GetMemberInfo.parseDateString(String(result.CREATED)),
        changed: GetMemberInfo.parseDateString(String(result.CHANGED))
      } as IBMiMember
    }
  }

  async getMultipleMemberInfo(connection: IBMi, members: IBMiMember[]): Promise<IBMiMember[] | undefined> {
    const config = connection.getConfig();
    const tempLib = config.tempLibrary;
    const statement = members
      .map(member => `select * from table(${tempLib}.${GetMemberInfo.FUNCTION_NAME}('${member.library}', '${member.file}', '${member.name}'))`)
      .join(' union all ');

    let results: Tools.DB2Row[] = [];
    if (connection.enableSQL) {
      try {
        results = await connection.runSQL(statement);
      } catch (e) { }; // Ignore errors, will return undefined.
    }
    else {
      results = await connection.getContent().getQTempTable([`create table QTEMP.MEMBERINFO as (${statement}) with data`], "MEMBERINFO");
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
        created: GetMemberInfo.parseDateString(String(result.CREATED)),
        changed: GetMemberInfo.parseDateString(String(result.CHANGED))
      } as IBMiMember
    });
  }
}

function getSource(library:string, name: string, version: number) {
  return Buffer.from(/* sql */`
    create or replace procedure QUSRMBRD(
      inout Buf     char( 135 ),
      in    BufLen  integer,
      in    Format  char(   8 ),
      in    QObj    char(  20 ),
      in    Mbr     char(  10 ),
      in    Ovr     char(   1 )
    )
    language CL
    parameter style general
    program type main
    external name 'QSYS/QUSRMBRD';
    
    create or replace function ${name}( inLib char(10), inFil char(10), inMbr char(10) )
    returns table (
      Library      varchar( 10 ),
      File         varchar( 10 ),
      Member       varchar( 10 ),
      Attr         varchar( 10 ),
      Extension    varchar( 10 ),
      created      timestamp(0),
      changed      timestamp(0),
      Description  varchar( 50 ),
      isSource     char( 1 )
    )
    modifies sql data
    set option usrprf=*user, dynusrprf=*user
    begin
      declare  buffer  char( 135 ) not null default '';
      declare  BUFLEN  integer     constant 135 ;
      declare  FORMAT  char(   8 ) constant 'MBRD0100' ;
      declare  OVR     char(   1 ) constant '0' ;
    
      call ${library}.QUSRMBRD( buffer, BUFLEN, FORMAT, inFil concat inLib, inMbr, OVR );
    
      pipe (rtrim( substr( Buffer, 19, 10 ) ),
            rtrim( substr( Buffer,  9, 10 ) ),
            rtrim( substr( Buffer, 29, 10 ) ),
            rtrim( substr( Buffer, 39, 10 ) ),
            rtrim( substr( Buffer, 49, 10 ) ),
            timestamp_format( case substr( Buffer, 59, 1 )
                                 when '1' then '20' concat substr( Buffer, 60, 12 )
                                 when '0' then '19' concat substr( Buffer, 60, 12 )
                                 else '19700101000000'
                               end, 'YYYYMMDDHH24MISS'),
            timestamp_format( case substr( Buffer, 72, 1 )
                                 when '1' then '20' concat substr( Buffer, 73, 12 )
                                 when '0' then '19' concat substr( Buffer, 73, 12 )
                                 else '19700101000000'
                               end, 'YYYYMMDDHH24MISS'),
           rtrim( substr( Buffer, 85, 50 ) ),
           case substr( Buffer, 135, 1 ) when '1' then 'Y' else 'N' end
           );
      return;
    end;
    
    comment on function ${name} is '${version} - Validate member information';
    grant execute on function ${name} to public;
    call QSYS2.QCMDEXC('CHGOBJOWN OBJ(${library}/${name}) OBJTYPE(*SRVPGM) NEWOWN(QUSER)');`,
    "utf-8");
}