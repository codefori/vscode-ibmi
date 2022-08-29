/** @type {{[language: string]: Action[]}} */
module.exports = {
  RPGLE: [
    {
      name: `Create RPGLE Program`,
      command: `CRTBNDRPG PGM(&CURLIB/&NAME) SRCSTMF('&RELATIVEPATH') OPTION(*EVENTF) DBGVIEW(*SOURCE) TGTCCSID(*JOB)`,
      deployFirst: true,
      environment: `ile`,
      extensions: [`RPGLE`]
    },
    {
      name: `Create RPGLE Module`,
      command: `CRTRPGMOD MODULE(&CURLIB/&NAME) SRCSTMF('&RELATIVEPATH') OPTION(*EVENTF) DBGVIEW(*SOURCE) TGTCCSID(*JOB)`,
      deployFirst: true,
      environment: `ile`,
      extensions: [`RPGLE`]
    },
    {
      name: `Create SQLRPGLE Program`,
      command: `CRTSQLRPGI OBJ(&CURLIB/&NAME) SRCSTMF('&RELATIVEPATH') OPTION(*EVENTF) DBGVIEW(*SOURCE) CLOSQLCSR(*ENDMOD) CVTCCSID(*JOB) COMPILEOPT('TGTCCSID(*JOB)')`,
      deployFirst: true,
      environment: `ile`,
      extensions: [`SQLRPGLE`]
    },
    {
      name: `Create SQLRPGLE Module`,
      command: `CRTSQLRPGI OBJ(&CURLIB/&NAME) SRCSTMF('&RELATIVEPATH') OBJTYPE(*MODULE) OPTION(*EVENTF) DBGVIEW(*SOURCE) CLOSQLCSR(*ENDMOD) CVTCCSID(*JOB) COMPILEOPT('TGTCCSID(*JOB)')`,
      deployFirst: true,
      environment: `ile`,
      extensions: [`SQLRPGLE`]
    }
  ],
  COBOL: [
    {
      name: `Create COBOL Program`,
      command: `CRTBNDCBL PGM(&CURLIB/&NAME) SRCSTMF('&RELATIVEPATH') OPTION(*EVENTF) DBGVIEW(*SOURCE)`,
      deployFirst: true,
      environment: `ile`,
      extensions: [`CBL`, `CBBLE`]
    },
    {
      name: `Create COBOL Module`,
      command: `CRTBNDRPG MODULE(&CURLIB/&NAME) SRCSTMF('&RELATIVEPATH') OPTION(*EVENTF) DBGVIEW(*SOURCE)`,
      deployFirst: true,
      environment: `ile`,
      extensions: [`CBL`, `CBBLE`]
    },
    {
      name: `Create SQLCOBOL Program`,
      command: `CRTSQLCBLI OBJ(&CURLIB/&NAME) SRCSTMF('&RELATIVEPATH') OPTION(*EVENTF) DBGVIEW(*SOURCE) CLOSQLCSR(*ENDMOD) CVTCCSID(*JOB)`,
      deployFirst: true,
      environment: `ile`,
      extensions: [`SQLCBL`, `SQLCBBLE`]
    },
    {
      name: `Create SQLCOBOL Module`,
      command: `CRTSQLCBLI OBJ(&CURLIB/&NAME) SRCSTMF('&RELATIVEPATH') OBJTYPE(*MODULE) OPTION(*EVENTF) DBGVIEW(*SOURCE) CLOSQLCSR(*ENDMOD) CVTCCSID(*JOB)`,
      deployFirst: true,
      environment: `ile`,
      extensions: [`SQLCBL`, `SQLCBBLE`]
    }
  ],
  C: [
    {
      name: `Create C Program`,
      command: `CRTBNDC PGM(&CURLIB/&NAME) SRCSTMF('&RELATIVEPATH') OPTION(*EVENTF) DBGVIEW(*SOURCE) TGTCCSID(*JOB)`,
      deployFirst: true,
      environment: `ile`,
      extensions: [
        `C`
      ]
    },
    {
      name: `Create C Module`,
      command: `CRTCMOD MODULE(&CURLIB/&NAME) SRCSTMF('&RELATIVEPATH') OPTION(*EVENTF) DBGVIEW(*SOURCE) TGTCCSID(*JOB)`,
      deployFirst: true,
      environment: `ile`,
      extensions: [
        `C`
      ]
    }
  ],
  CPP: [
    {
      "name": `Create CPP Program`,
      "command": `CRTBNDCPP PGM(&CURLIB/&NAME) SRCSTMF('&RELATIVEPATH') OPTION(*EVENTF) DBGVIEW(*SOURCE) TGTCCSID(*JOB)`,
      "deployFirst": true,
      "environment": `ile`,
      "extensions": [
        `CPP`
      ]
    },
    {
      "name": `Create CPP Module`,
      "command": `CRTCPPMOD MODULE(&CURLIB/&NAME) SRCSTMF('&RELATIVEPATH') OPTION(*EVENTF) DBGVIEW(*SOURCE) TGTCCSID(*JOB)`,
      "deployFirst": true,
      "environment": `ile`,
      "extensions": [
        `CPP`
      ]
    }
  ],
  CLLE: [
    {
      extensions: [
        `CLP`,
        `CLLE`
      ],
      name: `Create Bound CL Program`,
      command: `CRTBNDCL PGM(&CURLIB/&NAME) SRCSTMF('&RELATIVEPATH') OPTION(*EVENTF) DBGVIEW(*SOURCE)`,
      deployFirst: true,
      environment: `ile`,
    },
  ],
  CMD: [
    {
      "extensions": [
        `cmd`
      ],
      "name": `Create Command`,
      "command": `CRTCMD CMD(&CURLIB/&NAME) PGM(&CURLIB/&NAME) SRCSTMF('&RELATIVEPATH') OPTION(*EVENTF)`,
      deployFirst: true,
      environment: `ile`,
    },
  ],
  SQL: [
    {
      extensions: [
        `SQL`
      ],
      name: `Run SQL Statements (RUNSQLSTM)`,
      command: `RUNSQLSTM SRCSTMF('&FULLPATH') COMMIT(*NONE) NAMING(*SQL)`,
      deployFirst: true,
      environment: `ile`,
    }
  ],
  "Service Programs": [
    {
      "extensions": [
        `GLOBAL`
      ],
      "name": `Create Service Program (CRTSRVPGM)`,
      "command": `CRTSRVPGM SRVPGM(&CURLIB/&NAME) EXPORT(*ALL) BNDSRVPGM(*NONE) BNDDIR(*NONE) ACTGRP(*CALLER)`,
      environment: `ile`
    },
  ],
  "GNU Make": [
    {
      "extensions": [
        `GLOBAL`
      ],
      "name": `Build all`,
      "command": `/QOpenSys/pkgs/bin/gmake BUILDLIB=&CURLIB ERR=*EVENTF`,
      environment: `pase`,
      deployFirst: true,
    },
    {
      "extensions": [
        `GLOBAL`
      ],
      "name": `Build current`,
      "command": `/QOpenSys/pkgs/bin/gmake &BASENAME BUILDLIB=&CURLIB ERR=*EVENTF`,
      environment: `pase`,
      deployFirst: true,
    }
  ],
  "ibmi-bob": [
    {
      "extensions": [
        `GLOBAL`
      ],
      "name": `Build all`,
      "command": `OPT=*EVENTF BUILDLIB=&CURLIB /QOpenSys/pkgs/bin/makei build`,
      environment: `pase`,
      deployFirst: true,
    },
    {
      "extensions": [
        `GLOBAL`
      ],
      "name": `Build current`,
      "command": `OPT=*EVENTF BUILDLIB=&CURLIB /QOpenSys/pkgs/bin/makei compile -f &BASENAME`,
      environment: `pase`,
      deployFirst: true,
    }
  ]
}