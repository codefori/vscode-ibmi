module.exports = `             PGM        PARM(&STMF &SRCFILE &SRCMBR &TYPE &TEXT +
                          &ASPDEV &TMPPATH)
             DCL        VAR(&STMF) TYPE(*CHAR) LEN(5000)
             DCL        VAR(&SRCFILE) TYPE(*CHAR) LEN(20)
             DCL        VAR(&SRCMBR) TYPE(*CHAR) LEN(10)
             DCL        VAR(&TYPE) TYPE(*CHAR) LEN(10)
             DCL        VAR(&TEXT) TYPE(*CHAR) LEN(50)
             DCL        VAR(&ASPDEV) TYPE(*CHAR) LEN(10)
             DCL        VAR(&TMPPATH) TYPE(*CHAR) LEN(5000)

             DCL        VAR(&USER) TYPE(*CHAR) LEN(10)
             DCL        VAR(&FIFO) TYPE(*CHAR) LEN(5000)
             DCL        VAR(&FIFONTS) TYPE(*CHAR) LEN(5001)
             DCL        VAR(&ZERO) TYPE(*CHAR) LEN(1) VALUE(X'00')
             DCL        VAR(&STATOUT) TYPE(*CHAR) LEN(1000)
             DCL        VAR(&RET) TYPE(*INT) LEN(4)
             DCL        VAR(&TOWRITE) TYPE(*CHAR) LEN(5000)
             DCL        VAR(&SIZE) TYPE(*INT) LEN(4)
             DCL        VAR(&MODE) TYPE(*INT) LEN(4) VALUE(16777250)
             DCL        VAR(&HANDLE) TYPE(*INT) LEN(4)
             DCL        VAR(&CONVID) TYPE(*UINT) LEN(4) VALUE(0)
             DCL        VAR(&ERRNOPTR) TYPE(*PTR)
             DCL        VAR(&ERRNO) TYPE(*INT) STG(*BASED) LEN(4) +
                          BASPTR(&ERRNOPTR)
             DCL        VAR(&MBRTYPE) TYPE(*CHAR) LEN(10)

             RTVJOBA    CURUSER(&USER)
             CALLPRC    PRC('__errno') RTNVAL(&ERRNOPTR)

             CHGVAR     VAR(&FIFO) VALUE(&TMPPATH *TCAT +
                          '/vscodetemp-O__' *CAT &USER)
             CHGVAR     VAR(&FIFONTS) VALUE(&FIFO *TCAT &ZERO)
             CALLPRC    PRC('stat') PARM((&FIFONTS) (&STATOUT)) +
                          RTNVAL(&RET)
             IF         COND(&RET *NE 0 *OR %SST(&STATOUT 49 10) *NE +
                          '*FIFO') THEN(DO)
             GOTO       CMDLBL(ERROR)
             ENDDO

             IF         COND(&STMF *NE ' ') THEN(DO)
             CHGVAR     VAR(&TOWRITE) VALUE(&STMF)
             GOTO       CMDLBL(WRITE)
             ENDDO

             IF         COND(&ASPDEV *EQ '*NONE') THEN(DO)
             RTVMBRD    FILE(%SST(&SRCFILE 11 10)/%SST(&SRCFILE 1 +
                          10)) MBR(&SRCMBR) SRCTYPE(&MBRTYPE)
             MONMSG     MSGID(CPF0000) EXEC(DO)
             SNDPGMMSG  MSGID(CPF9898) MSGF(QCPFMSG) MSGDTA('Unable +
                          to access member') TOPGMQ(*PRV) +
                          MSGTYPE(*ESCAPE)
             ENDDO
             ENDDO
             CHGVAR     VAR(&TOWRITE) VALUE(' ')
             IF         COND(&ASPDEV *NE '*NONE') THEN(CHGVAR +
                          VAR(&TOWRITE) VALUE(&ASPDEV *TCAT '/'))
             CHGVAR     VAR(&TOWRITE) VALUE(&TOWRITE *TCAT +
                          %SST(&SRCFILE 11 10) *TCAT '/' *TCAT +
                          %SST(&SRCFILE 1 10) *TCAT '/' *TCAT +
                          &SRCMBR *TCAT '.')
             IF         COND(&TYPE *EQ '*SAME') THEN(CHGVAR +
                          VAR(&TOWRITE) VALUE(&TOWRITE *TCAT &MBRTYPE))
             ELSE       CMD(CHGVAR VAR(&TOWRITE) VALUE(&TOWRITE +
                          *TCAT &TYPE))


WRITE:
             CALLPRC    PRC('open') PARM((&FIFONTS) (&MODE *BYVAL) +
                          (&MODE *BYVAL) (&CONVID *BYVAL)) +
                          RTNVAL(&HANDLE)
             IF         COND(&HANDLE = -1) THEN(GOTO CMDLBL(ERROR))

             CHGVAR     VAR(&SIZE) VALUE(%SIZE(&TOWRITE))
             CALLPRC    PRC('write') PARM((&HANDLE *BYVAL) +
                          (&TOWRITE) (&SIZE *BYVAL)) RTNVAL(&RET)
             CALLPRC    PRC('close') PARM((&HANDLE *BYVAL)) +
                          RTNVAL(&RET)
             GOTO       CMDLBL(END)

ERROR:
             SNDPGMMSG  MSGID(CPF9898) MSGF(QCPFMSG) MSGDTA('Unable +
                          to communicate with Code for IBM i, +
                          enable Open from IBM i and check +
                          temporary directory') TOPGMQ(*PRV) +
                          MSGTYPE(*ESCAPE)

END:
             ENDPGM`