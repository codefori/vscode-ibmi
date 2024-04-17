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
      name: `JP result set test`, test: async () => {
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
    }
  ]
};
