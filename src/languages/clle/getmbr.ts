import Instance from "../../api/Instance";

export async function initGetMbr(instance: Instance) {
  const connection = instance.getConnection();
  const config = instance.getConfig();

  // Check if the remote library list tool is installed
  if (connection && config && !connection.remoteFeatures[`GETMBR.PGM`]) {
    // Time to install our new library list fetcher program
    const content = instance.getContent()!;
  
    const tempLib = config.tempLibrary;
  
    try {
      await connection.remoteCommand(`CRTSRCPF ${tempLib}/QTOOLS`, undefined)
    } catch (e) {
      //It may exist already so we just ignore the error
    }
  
    await content.uploadMemberContent(undefined, tempLib, `QTOOLS`, `GETMBR`, getSource());
    await connection.remoteCommand(
      `CRTBNDCL PGM(${tempLib}/GETMBR) SRCFILE(${tempLib}/QTOOLS) DBGVIEW(*SOURCE) TEXT('vscode-ibmi member resolver')`
    );

    connection.remoteFeatures[`GETMBR.PGM`] = `${config.tempLibrary}.GETMBR`;
  }
}

function getSource() {
  return [
    `PGM PARM(&SRCPF &NAME)`,
    `DCL VAR(&SRCPF) TYPE(*CHAR) LEN(10)`,
    `DCL VAR(&NAME) TYPE(*CHAR) LEN(10)`,
    `DCL VAR(&LIB) TYPE(*CHAR) LEN(10)`,
    `DCL VAR(&EXT) TYPE(*CHAR) LEN(10)`,
    `DCL VAR(&MSG) TYPE(*CHAR) LEN(50)`,
    `dcl &NL *char 1 value( x'25' )`,
    ``,
    `RTVMBRD FILE(*LIBL/&SRCPF) MBR(&NAME) RTNLIB(&LIB) SRCTYPE(&EXT)`,
    `CHGVAR VAR(&MSG) VALUE( +`,
    `  &LIB *TCAT '/' *TCAT +`,
    `  &SRCPF *TCAT '/' *TCAT +`,
    `  &NAME *TCAT '.' *TCAT +`,
    `  &EXT *TCAT &NL +`,
    `)`,
    `CALLPRC PRC('printf') PARM(&MSG)`,
    `ENDPGM`,
  ].join(`\n`);
}