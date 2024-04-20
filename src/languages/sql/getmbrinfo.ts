import { window } from "vscode";
import Instance from "../../api/Instance";
import { GlobalStorage } from "../../api/Storage";

export async function initGetMemberInfo(instance: Instance) {
  const connection = instance.getConnection();
  const config = instance.getConfig();

  // Check if the remote member info tool is installed
  if (connection && config && !connection.remoteFeatures[`GETMBRINFO.SQL`]) {
    // Time to install our new library list fetcher program

    const content = instance.getContent();

    const tempSourcePath = connection.getTempRemote(`getmbrinfo.sql`) || `/tmp/getmbrinfo.sql`;

    content!.writeStreamfile(tempSourcePath, getSource(config.tempLibrary)).then(() => {
      connection.runCommand({
        command: `RUNSQLSTM SRCSTMF('${tempSourcePath}') COMMIT(*NONE) NAMING(*SQL)`,
        cwd: `/`,
        noLibList: true
      })
      .then((result) => {
        if (result.code === 0) {
          connection.remoteFeatures[`GETMBRINFO.SQL`] = `${config.tempLibrary}.GETMBRINFO`;
          GlobalStorage.get().setServerSettingsCacheSpecific(connection.currentConnectionName, { remoteFeatures: connection.remoteFeatures });
        } else {
          window.showWarningMessage(`Unable to install GETMBRINFO. See Code for IBM i output for details.`);
        }
      })
    })
  }
}

function getSource(library: string) {
  return [
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
    `create or replace function ${library}.GETMBRINFO( inLib char(10), inFil char(10), inMbr char(10) )`,
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
    `specific GETMBRINFO`,
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
    `end`,
    `;`,
  ].join(`\n`);
}