module.exports = `             CMD        PROMPT('Start Code for IBM i')
             PARM       KWD(STMF) TYPE(*PNAME) LEN(5000) EXPR(*YES) +
                          PROMPT('Stream file, or')
             PARM       KWD(SRCFILE) TYPE(QFNAME) PROMPT('Source file')
             PARM       KWD(SRCMBR) TYPE(*NAME) LEN(10) +
                          PROMPT('Source member')
             PARM       KWD(TYPE) TYPE(*SNAME) LEN(10) DFT(*SAME) +
                          SPCVAL((*SAME)) PROMPT('Source type')
             PARM       KWD(TEXT) TYPE(*CHAR) LEN(50) DFT(*BLANK) +
                          SPCVAL((*BLANK ' ')) PROMPT('Text +
                          ''description''')
             PARM       KWD(ASPDEV) TYPE(*NAME) LEN(10) DFT(*NONE) +
                          SPCVAL((*NONE)) PROMPT('ASP device')
             PARM       KWD(TMPPATH) TYPE(*PNAME) LEN(5000) +
                          DFT('/tmp') EXPR(*YES) PROMPT('Code for +
                          IBM i temp. dir.')

             DEP        CTL(*ALWAYS) PARM((STMF) (SRCFILE)) +
                          NBRTRUE(*EQ 1)
             DEP        CTL(*ALWAYS) PARM((STMF) (SRCMBR)) +
                          NBRTRUE(*EQ 1)
             DEP        CTL(ASPDEV) PARM((TYPE)) NBRTRUE(*EQ 1)

 QFNAME:     QUAL       TYPE(*NAME) LEN(10)
             QUAL       TYPE(*NAME) LEN(10) DFT(*LIBL) +
                          PROMPT('Library')`