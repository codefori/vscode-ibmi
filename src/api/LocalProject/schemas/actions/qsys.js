module.exports = [    
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
    name: `Compile: CRTBNDCL`,
    command: `CRTBNDCL PGM(&OBJLIB/&NAME) SRCFILE(&OBJLIB/&FOLDER) OPTION(*EVENTF) DBGVIEW(*SOURCE)`,
    fileSystem: `qsys`,
    commandEnvironment: `qsys`,
    extensions: [`cl`, `clle`]
  },
  {
    name: `RUNSQLSTM`,
    command: `RUNSQLSTM SRCFILE(&OBJLIB/&FOLDER) SRCMBR(&NAME) COMMIT(*NONE) NAMING(*SYS)`,
    fileSystem: `qsys`,
    commandEnvironment: `qsys`,
    extensions: [`sql`, `table`, `view`, `sqlprc`, `sqlseq`, `sqludf`, `trg`, `index`]
  }
];