module.exports = [    
  {
    name: `Compile: CRTSQLRPGI (Program)`,
    command: `CRTSQLRPGI OBJ(&OBJLIB/&NAME) SRCSTMF('&SRCSTMF') CLOSQLCSR(*ENDMOD) OPTION(*EVENTF) DBGVIEW(*SOURCE) TGTRLS(*CURRENT)`,
    fileSystem: `ifs`,
    commandEnvironment: `qsys`,
    extensions: [`sqlrpgle`]
  },
  {
    name: `Compile: CRTSQLRPGI (Module)`,
    command: `CRTSQLRPGI OBJ(&OBJLIB/&NAME) SRCSTMF('&SRCSTMF') CLOSQLCSR(*ENDMOD) OPTION(*EVENTF) DBGVIEW(*SOURCE) TGTRLS(*CURRENT) OBJTYPE(*MODULE)`,
    fileSystem: `ifs`,
    commandEnvironment: `qsys`,
    extensions: [`sqlrpgle`]
  },
  {
    name: `Compile: CRTBNDRPG`,
    command: `CRTBNDRPG PGM(&OBJLIB/&NAME) SRCSTMF('&SRCSTMF') OPTION(*EVENTF) DBGVIEW(*SOURCE)`,
    fileSystem: `ifs`,
    commandEnvironment: `qsys`,
    extensions: [`rpgle`]
  },
  {
    name: `Compile: CRTRPGMOD`,
    command: `CRTRPGMOD MODULE(&OBJLIB/&NAME) SRCSTMF('&SRCSTMF') OPTION(*EVENTF) DBGVIEW(*SOURCE)`,
    fileSystem: `ifs`,
    commandEnvironment: `qsys`,
    extensions: [`rpgle`]
  },
  {
    name: `Compile: CRTBNDCBL`,
    command: `CRTBNDCBL PGM(&OBJLIB/&NAME) SRCSTMF('&SRCSTMF') OPTION(*SOURCE *EVENTF) DBGVIEW(*SOURCE)`,
    fileSystem: `ifs`,
    commandEnvironment: `qsys`,
    extensions: [`cbl`, `cbble`, `cob`]
  },
  {
    name: `Compile: CRTBNDCL`,
    command: `CRTBNDCL PGM(&OBJLIB/&NAME) SRCSTMF('&SRCSTMF') OPTION(*EVENTF) DBGVIEW(*SOURCE)`,
    fileSystem: `ifs`,
    commandEnvironment: `qsys`,
    extensions: [`cl`, `clle`]
  },
  {
    name: `RUNSQLSTM`,
    command: `RUNSQLSTM SRCSTMF('&SRCSTMF') COMMIT(*NONE) NAMING(*SYS)`,
    fileSystem: `ifs`,
    commandEnvironment: `qsys`,
    extensions: [`sql`, `table`, `view`, `sqlprc`, `sqlseq`, `sqludf`, `trg`, `index`]
  }
];