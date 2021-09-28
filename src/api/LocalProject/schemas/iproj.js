module.exports = {
  version: `0.0.1`,
  description: `IBM i Project`,
  repository: ``,
  objlib: `&DEVLIB`,
  curlib: `&DEVLIB`,
  includePath: [],
  preUsrlibl: [],
  postUsrlibl: [],
  setIBMiEnvCmd: [],
  actions: [
    {
      name: `Compile: CRTSQLRPGI (Program)`,
      command: `CRTSQLRPGI OBJ(&OBJLIB/&NAME) SRCFILE(&OBJLIB/&FOLDER) CLOSQLCSR(*ENDMOD) OPTION(*EVENTF) DBGVIEW(*SOURCE) TGTRLS(*CURRENT)`,
      fileSystem: `qsys`,
      commandEnvironment: `qsys`,
      extensions: [`sqlrpgle`]
    },
    {
      name: `Compile: CRTBNDRPG`,
      command: `CRTBNDRPG PGM(&OBJLIB/&NAME) SRCFILE(&OBJLIB/&FOLDER) SRCMBR(&NAME) OPTION(*EVENTF) DBGVIEW(*SOURCE)`,
      fileSystem: `qsys`,
      commandEnvironment: `qsys`,
      extensions: [`rpgle`]
    },
    {
      name: `Compile: CRTRPGMOD`,
      command: `CRTRPGMOD MODULE(&OBJLIB/&NAME) SRCFILE(&OBJLIB/&FOLDER) SRCMBR(&NAME) OPTION(*EVENTF) DBGVIEW(*SOURCE)`,
      fileSystem: `qsys`,
      commandEnvironment: `qsys`,
      extensions: [`rpgle`]
    },
    {
      name: `Compile: CRTBNDCBL`,
      command: `CRTBNDCBL PGM(&OBJLIB/&NAME) SRCFILE(&OBJLIB/&FOLDER) OPTION(*SOURCE *EVENTF) DBGVIEW(*SOURCE)`,
      fileSystem: `qsys`,
      commandEnvironment: `qsys`,
      extensions: [`cbl`, `cbble`, `cob`]
    },
    {
      name: `Compile: CRTCMD`,
      command: `CRTCMD CMD(&OBJLIB/&NAME) PGM(&OBJLIB/&NAME) SRCFILE(&OBJLIB/&FOLDER) ALLOW(*ALL) CURLIB(*NOCHG) PRDLIB(*NOCHG)`,
      fileSystem: `qsys`,
      commandEnvironment: `qsys`,
      extensions: [`cmd`]
    },
    {
      name: `Compile: CRTBNDCL`,
      command: `CRTBNDCL PGM(&OBJLIB/&NAME) SRCFILE(&OBJLIB/&FOLDER) OPTION(*EVENTF) DBGVIEW(*SOURCE)`,
      fileSystem: `qsys`,
      commandEnvironment: `qsys`,
      extensions: [`cl`, `clle`]
    },
    {
      name: `Compile: CRTPGM`,
      command: `CRTPGM PGM(&OBJLIB/&NAME) MODULE(*PGM) ENTMOD(*FIRST) BNDSRVPGM(*NONE) BNDDIR(*NONE) ACTGRP(*ENTMOD) TGTRLS(*CURRENT)`,
      fileSystem: `qsys`,
      commandEnvironment: `qsys`
    },
    {
      name: `RUNSQLSTM`,
      command: `RUNSQLSTM SRCFILE(&OBJLIB/&FOLDER) SRCMBR(&NAME) COMMIT(*NONE) NAMING(*SYS)`,
      fileSystem: `qsys`,
      commandEnvironment: `qsys`,
      extensions: [`sql`, `table`, `view`, `sqlprc`, `sqlseq`, `sqludf`, `trg`, `index`]
    }
  ]
}