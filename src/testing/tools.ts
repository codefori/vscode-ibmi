import assert from "assert";
import { TestSuite } from ".";
import { Tools } from "../api/Tools";

export const ToolsSuite: TestSuite = {
  name: `Tools API tests`,
  tests: [
    {
      name: `unqualifyPath (In a named library)`, test: async () => {
        const qualifiedPath = `/QSYS.LIB/MYLIB.LIB/DEVSRC.FILE/THINGY.MBR`;
        const simplePath = Tools.unqualifyPath(qualifiedPath);

        assert.strictEqual(simplePath, `/MYLIB/DEVSRC/THINGY.MBR`);
      }
    },

    {
      name: `unqualifyPath (In QSYS)`, test: async () => {
        const qualifiedPath = `/QSYS.LIB/DEVSRC.FILE/THINGY.MBR`;
        const simplePath = Tools.unqualifyPath(qualifiedPath);

        assert.strictEqual(simplePath, `/QSYS/DEVSRC/THINGY.MBR`);
      }
    },

    {
      name: `unqualifyPath (In an ASP)`, test: async () => {
        const qualifiedPath = `/myasp/QSYS.LIB/MYLIB.LIB/DEVSRC.FILE/THINGY.MBR`;
        const simplePath = Tools.unqualifyPath(qualifiedPath);

        assert.strictEqual(simplePath, `/myasp/MYLIB/DEVSRC/THINGY.MBR`);
      }
    },

    {
      name: `sanitizeLibraryNames ($ and #)`, test: async () => {
        const rawLibraryNames = [`QTEMP`, `#LIBRARY`, `My$lib`, `qsysinc`];
        const sanitizedLibraryNames = Tools.sanitizeLibraryNames(rawLibraryNames);

        assert.deepStrictEqual(sanitizedLibraryNames, [`QTEMP`, `"#LIBRARY"`, `My\\$lib`, `qsysinc`]);
      },
    },
    {
      name: `fixQZDFMDB2Statement`, test: async () => {
        let statement = Tools.fixSQL('Select * From MYTABLE -- This is a comment')
        assert.deepStrictEqual(statement, 'Select * From MYTABLE \n-- This is a comment');

        statement = Tools.fixSQL("@COMMAND LIB(QTEMP/*ALL) TEXT('Hello!');\nSelect * From QTEMP.MYTABLE -- This is mytable");
        assert.deepStrictEqual(statement, "Call QSYS2.QCMDEXC('COMMAND LIB(QTEMP/*ALL) TEXT(''Hello!'')');\nSelect * From QTEMP.MYTABLE \n-- This is mytable");
      }
    },
    {
      name: `EN result set test`, test: async () => {
        const lines = [
          `DB2>`,
          `  ?>`,
          `  ?>`,
          `  ?>`,
          `  ?>`,
          `  ?>`,
          `  ?>`,
          ``,
          `CUSNUM   LSTNAM   INIT  STREET        CITY   STATE  ZIPCOD  CDTLMT  CHGCOD  BALDUE   CDTDUE  `,
          `-------- -------- ----- ------------- ------ ------ ------- ------- ------- -------- --------`,
          ` 938472  Henning  G K   4859 Elm Ave  Dallas TX      75217   5000    3         37.00     0.00`,
          ``,
          `  1 RECORD(S) SELECTED.`,
        ]

        const rows = Tools.db2Parse(lines.join(`\n`));

        assert.strictEqual(rows.length, 1);

        assert.strictEqual(rows[0].CUSNUM, 938472);
        assert.strictEqual(rows[0].LSTNAM, `Henning`);
        assert.strictEqual(rows[0].INIT, `G K`);
        assert.strictEqual(rows[0].STREET, `4859 Elm Ave`);
        assert.strictEqual(rows[0].CITY, `Dallas`);
        assert.strictEqual(rows[0].STATE, `TX`);
        assert.strictEqual(rows[0].ZIPCOD, 75217);
        assert.strictEqual(rows[0].CDTLMT, 5000);
        assert.strictEqual(rows[0].CHGCOD, 3);
        assert.strictEqual(rows[0].BALDUE, 37);
        assert.strictEqual(rows[0].CDTDUE, 0);
      }
    },
    {
      name: `EN result set, empty columns`, test: async () => {
        const lines = [
          `DB2>`,
          `DB20000I  THE SQL COMMAND COMPLETED SUCCESSFULLY.`,
          `DB2>`,
          `DB20000I  THE SQL COMMAND COMPLETED SUCCESSFULLY.`,
          `DB2>`,
          ``,
          `NAME       TYPE  ATTRIBUTE  TEXT                                               IS_SOURCE   NB_MBR  SOURCE_LENGTH  CCSID  `,
          `---------- ----- ---------- -------------------------------------------------- ----------- ------- -------------- -------`,
          `CMD        *FILE *PHY                                                                    1      3     112             37 `,
          `EVFTEMPF01 *FILE *PHY                                                                    1      2     112             37 `,
          `EVFTEMPF02 *FILE *PHY                                                                    1      2     112             37 `,
          `HEBREW     *FILE *PHY                                                                    1      1      92            424 `,
          `QCPYSRC    *FILE *PHY                                                                    1      1     112             37 `,
          `QDDSSRC    *FILE *PHY                                                                    1      3     112             37 `,
          `QRPGLEREF  *FILE *PHY                                                                    1      1     112             37 `,
          `QRPGLESRC  *FILE *PHY       cool mate                                                    1     11     112             37 `,
          `QSQDSRC    *FILE *PHY       SQL PROCEDURES                                               1      4     160             37 `,
          `VSCODE     *FILE *PHY                                                                    1      1     112             37 `,
          ``,
          ` 10 RECORD(S) SELECTED.`,
          ``,
          `DB2>`,
        ]

        const rows = Tools.db2Parse(lines.join(`\n`));

        assert.strictEqual(rows.length, 10);

        assert.strictEqual(rows[0].NAME, `CMD`);
        assert.strictEqual(rows[0].TYPE, `*FILE`);
        assert.strictEqual(rows[0].ATTRIBUTE, `*PHY`);
        assert.strictEqual(rows[0].TEXT, ``);
        assert.strictEqual(rows[0].IS_SOURCE, 1);
        assert.strictEqual(rows[0].NB_MBR, 3);
        assert.strictEqual(rows[0].SOURCE_LENGTH, 112);
        assert.strictEqual(rows[0].CCSID, 37);
      }
    },
    {
      name: `FR result set test`, test: async () => {
        const lines = [
          `DB2>`,
          `  ?>`,
          `  ?>`,
          `  ?>`,
          `  ?>`,
          `  ?>`,
          `  ?>`,
          ``,
          `ALPHA      NUMÉRIQUE   état       unité      MAJUSCULES minuscules aperçu     hélas      où?    `,
          `---------- ----------- ---------- ---------- ---------- ---------- ---------- ---------- -------`,
          `Valeur1              1 Français   mètre      ÀÉÈÇÙ      àéèçù      déterminé  oui?       LÀ-BAS!`,
          ``,
          `  1 RECORD(S) SELECTED.`,
        ]

        const rows = Tools.db2Parse(lines.join(`\n`));

        assert.strictEqual(rows.length, 1);

        assert.strictEqual(rows[0].ALPHA, `Valeur1`);
        assert.strictEqual(rows[0].NUMÉRIQUE, 1);
        assert.strictEqual(rows[0].état, `Français`);
        assert.strictEqual(rows[0].unité, `mètre`);
        assert.strictEqual(rows[0].MAJUSCULES, `ÀÉÈÇÙ`);
        assert.strictEqual(rows[0].minuscules, `àéèçù`);
        assert.strictEqual(rows[0].aperçu, `déterminé`);
        assert.strictEqual(rows[0].hélas, `oui?`);
        assert.strictEqual(rows[0]["où?"], `LÀ-BAS!`);
      }
    },
    {
      name: `DA result set test`, test: async () => {
        const lines = [
          `DB2>`,
          `  ?>`,
          `  ?>`,
          `  ?>`,
          `  ?>`,
          `  ?>`,
          `  ?>`,
          ``,
          `COL1A      COL2N       COL3Æ      COL4Ø      COL5Å      ÆCOL6      ØCOL7      ÅCOL8      ÆCOL9      ØCOL10     ÅCOL11    `,
          `---------- ----------- ---------- ---------- ---------- ---------- ---------- ---------- ---------- ---------- ----------`,
          `Val1                 1 Val3æÆ     Val4øØ     Val5åÅ     æÆVal6     øØVal7     åÅVal8     ValæÆ9     ValøØ10    ValåÅ11   `,
          ``,
          `  1 RECORD(S) SELECTED.`,
        ]

        const rows = Tools.db2Parse(lines.join(`\n`));

        assert.strictEqual(rows.length, 1);

        assert.strictEqual(rows[0].COL1A, `Val1`);
        assert.strictEqual(rows[0].COL2N, 1);
        assert.strictEqual(rows[0].COL3Æ, `Val3æÆ`);
        assert.strictEqual(rows[0].COL4Ø, `Val4øØ`);
        assert.strictEqual(rows[0].COL5Å, `Val5åÅ`);
        assert.strictEqual(rows[0].ÆCOL6, `æÆVal6`);
        assert.strictEqual(rows[0].ØCOL7, `øØVal7`);
        assert.strictEqual(rows[0].ÅCOL8, `åÅVal8`);
        assert.strictEqual(rows[0].ÆCOL9, `ValæÆ9`);
        assert.strictEqual(rows[0].ØCOL10, `ValøØ10`);
        assert.strictEqual(rows[0].ÅCOL11, `ValåÅ11`);
      }
    },
    {
      name: `JP result set test (A)`, test: async () => {
        const lines = [
          `DB2>`,
          `  ?>`,
          `  ?>`,
          `  ?>`,
          `  ?>`,
          ``,
          ``,
          `LIBRARY    RECORD_LENGTH        ASP    SOURCE_FILE  NAME       TYPE       TEXT                                                                                                                           LINES                CREATED              CHANGED             `,
          `---------- -------------------- ------ ------------ ---------- ---------- ------------------------------------------------------------------------------------------------------------------------------ -------------------- -------------------- --------------------`,
          `SNDLIB                      112      0 QRPGLESRC    SNDDEFD    DSPF       送信定義一覧／追加・修正                                                                                                                      124        1712670631000        1712683676000`,
          `SNDLIB                      112      0 QRPGLESRC    SNDDEFR    RPGLE      送信定義一覧／追加・修正                                                                                                                      386        1712683661000        1712683692000`,
          ``,
          `  2 RECORD(S) SELECTED.`,
        ];

        const rows = Tools.db2Parse(lines.join(`\n`));

        assert.strictEqual(rows.length, 2);

        assert.strictEqual(rows[0].LIBRARY, `SNDLIB`);
        assert.strictEqual(rows[0].RECORD_LENGTH, 112);
        assert.strictEqual(rows[0].ASP, 0);
        assert.strictEqual(rows[0].SOURCE_FILE, `QRPGLESRC`);
        assert.strictEqual(rows[0].NAME, `SNDDEFD`);
        assert.strictEqual(rows[0].TYPE, `DSPF`);
        assert.strictEqual(rows[0].TEXT, `送信定義一覧／追加・修正`);
        assert.strictEqual(rows[0].LINES, 124);
        assert.strictEqual(rows[0].CREATED, 1712670631000);
        assert.strictEqual(rows[0].CHANGED, 1712683676000);
      }
    },
    {
      name: `JP result set test (B)`, test: async () => {
        const lines = [
          `DB2>`,
          `  ?>`,
          `  ?>`,
          `  ?>`,
          `  ?>`,
          ``,
          ``,
          `LIBRARY   RECORD_LENGTH        ASP    SOURCE_FILE  NAME       TYPE       TEXT                                                                                                                           LINES                CREATED              CHANGED`,
          `--------- -------------------- ------ ------------ ---------- ---------- ------------------------------------------------------------------------------------------------------------------------------ -------------------- -------------------- --------------------`,
          `SNDLIB                     112      0 QRPGLESRC    TESTEDTW   RPGLE      日付と時刻を先行０付きで表示-> 8桁では無理？                                                                                                  9        1713451802000        1713453741000`,
          ``,
          `  1 RECORD(S) SELECTED.`,
        ];

        const rows = Tools.db2Parse(lines.join(`\n`));

        assert.strictEqual(rows.length, 1);

        assert.strictEqual(rows[0].LIBRARY, `SNDLIB`);
        assert.strictEqual(rows[0].RECORD_LENGTH, 112);
        assert.strictEqual(rows[0].ASP, 0);
        assert.strictEqual(rows[0].SOURCE_FILE, `QRPGLESRC`);
        assert.strictEqual(rows[0].NAME, `TESTEDTW`);
        assert.strictEqual(rows[0].TYPE, `RPGLE`);
        assert.strictEqual(rows[0].TEXT, `日付と時刻を先行０付きで表示-> 8桁では無理？`);
        assert.strictEqual(rows[0].LINES, 9);
        assert.strictEqual(rows[0].CREATED, 1713451802000);
        assert.strictEqual(rows[0].CHANGED, 1713453741000);
      }
    },
    {
      name: "Date attr parsing", test: async () => {
        const date1Epoch = Tools.parseAttrDate(`Fri Apr  5 09:00:10 2024`);
        assert.strictEqual(date1Epoch, 1712307610000);
        const date1 = new Date(date1Epoch);
        assert.strictEqual(date1.getUTCDay(), 5);
        assert.strictEqual(date1.getUTCMonth(), 3);
        assert.strictEqual(date1.getUTCFullYear(), 2024);
        assert.strictEqual(date1.getUTCHours(), 9);
        assert.strictEqual(date1.getUTCMinutes(), 0);
        assert.strictEqual(date1.getUTCSeconds(), 10);

        const date2Epoch = Tools.parseAttrDate(`Thu Dec 21 21:47:02 2023`);
        assert.strictEqual(date2Epoch, 1703195222000);
        const date2 = new Date(date2Epoch);
        assert.strictEqual(date2.getUTCDay(), 4);
        assert.strictEqual(date2.getUTCMonth(), 11);
        assert.strictEqual(date2.getUTCFullYear(), 2023);
        assert.strictEqual(date2.getUTCHours(), 21);
        assert.strictEqual(date2.getUTCMinutes(), 47);
        assert.strictEqual(date2.getUTCSeconds(), 2);
      }
    }
  ]
};
