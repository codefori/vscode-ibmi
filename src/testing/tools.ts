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
    }
  ]
};
