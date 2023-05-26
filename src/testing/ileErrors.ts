import assert from "assert";
import { TestSuite } from ".";
import { parseErrors } from "../api/errors/handler";
import { commands } from "vscode";

export const ILEErrorSuite: TestSuite = {
  name: `ILE Error API tests`,
  tests: [
    {name: `Basic test (CRTSQLRPGI, member)`, test: async () => {
      const lines = [
        `TIMESTAMP  0 20230524115628`,
        `PROCESSOR  0 999 1`,
        `FILEID     0 999 000000 026 QTEMP/QSQLTEMP1(EMPLOYEES) 20230524115628 0`,
        `FILEID     0 001 000000 026 LIAMA/QRPGLESRC(EMPLOYEES) 20230516152429 0`,
        `ERROR      0 001 1 000044 000044 000 000044 000 SQL1001 S 30 048 External file definition for EMPLOYEE not found.`,
        `ERROR      0 001 1 000093 000093 020 000093 020 SQL1103 W 10 069 Position 20 Column definitions for table EMPLOYEE in *LIBL not found.`,
        `ERROR      0 001 1 000103 000103 019 000103 019 SQL0312 S 30 212 Position 19 Variable EMPLOYEE not defined or not usable. Reason: No declaration for the variable exists, the declaration is not within the current scope, or the variable does not have an equivalent SQL data type.`,
        `ERROR      0 001 1 000103 000103 028 000103 028 SQL0312 S 30 209 Position 28 Variable EMPNO not defined or not usable. Reason: No declaration for the variable exists, the declaration is not within the current scope, or the variable does not have an equivalent SQL data type.`,
        `ERROR      0 001 1 000104 000104 016 000104 016 SQL0312 S 30 212 Position 16 Variable EMPLOYEE not defined or not usable. Reason: No declaration for the variable exists, the declaration is not within the current scope, or the variable does not have an equivalent SQL data type.`,
        `ERROR      0 001 1 000104 000104 025 000104 025 SQL0312 S 30 212 Position 25 Variable FIRSTNME not defined or not usable. Reason: No declaration for the variable exists, the declaration is not within the current scope, or the variable does not have an equivalent SQL data type.`,
        `ERROR      0 001 1 000105 000105 016 000105 016 SQL0312 S 30 212 Position 16 Variable EMPLOYEE not defined or not usable. Reason: No declaration for the variable exists, the declaration is not within the current scope, or the variable does not have an equivalent SQL data type.`,
        `ERROR      0 001 1 000105 000105 025 000105 025 SQL0312 S 30 212 Position 25 Variable LASTNAME not defined or not usable. Reason: No declaration for the variable exists, the declaration is not within the current scope, or the variable does not have an equivalent SQL data type.`,
        `ERROR      0 001 1 000106 000106 016 000106 016 SQL0312 S 30 212 Position 16 Variable EMPLOYEE not defined or not usable. Reason: No declaration for the variable exists, the declaration is not within the current scope, or the variable does not have an equivalent SQL data type.`,
        `ERROR      0 001 1 000106 000106 025 000106 025 SQL0312 S 30 207 Position 25 Variable JOB not defined or not usable. Reason: No declaration for the variable exists, the declaration is not within the current scope, or the variable does not have an equivalent SQL data type.`,
        `EXPANSION  0 001 000000 000000 999 000049 000113`,
        `EXPANSION  0 001 000096 000096 999 000154 000171`,
        `EXPANSION  0 001 000096 000096 999 000180 000193`,
        `EXPANSION  0 001 000106 000106 999 000204 000207`,
        `EXPANSION  0 001 000121 000121 999 000223 000234`,
        `FILEEND    0 001 000151`,
        `FILEEND    0 999 000264`,
      ];

      const errors = parseErrors(lines);

      const filePath = `LIAMA/QRPGLESRC/EMPLOYEES`;

      assert.strictEqual(errors.size, 1);
      assert.strictEqual(errors.has(filePath), true);

      const fileErrors = errors.get(filePath);
      assert.notStrictEqual(fileErrors, undefined);
      assert.strictEqual(fileErrors?.length, 10);

      const errorA = fileErrors.find(err => err.linenum === 44);
      assert.notStrictEqual(errorA, undefined);

      assert.strictEqual(errorA?.code, `SQL1001`);
      assert.strictEqual(errorA?.linenum, 44);
      assert.strictEqual(errorA?.column, 0);
      assert.strictEqual(errorA?.toColumn, 0);
      assert.strictEqual(errorA?.sev, 30);
      assert.strictEqual(errorA?.text, `External file definition for EMPLOYEE not found.`);

      const lineErrors = fileErrors.filter(err => err.linenum === 104);
      assert.strictEqual(lineErrors.length, 2);

      assert.strictEqual(lineErrors[0]?.code, `SQL0312`);
      assert.strictEqual(lineErrors[0]?.linenum, 104);
      assert.strictEqual(lineErrors[0]?.column, 16);
      assert.strictEqual(lineErrors[0]?.toColumn, 16);
      assert.strictEqual(lineErrors[0]?.sev, 30);
      assert.strictEqual(lineErrors[0]?.text, `Position 16 Variable EMPLOYEE not defined or not usable. Reason: No declaration for the variable exists, the declaration is not within the current scope, or the variable does not have an equivalent SQL data type.`);

      assert.strictEqual(lineErrors[1]?.code, `SQL0312`);
      assert.strictEqual(lineErrors[1]?.linenum, 104);
      assert.strictEqual(lineErrors[1]?.column, 25);
      assert.strictEqual(lineErrors[1]?.toColumn, 25);
      assert.strictEqual(lineErrors[1]?.sev, 30);
      assert.strictEqual(lineErrors[1]?.text, `Position 25 Variable FIRSTNME not defined or not usable. Reason: No declaration for the variable exists, the declaration is not within the current scope, or the variable does not have an equivalent SQL data type.`);
    }},

    {name: `Basic test (CRTSQLRPGI, streamfile)`, test: async () => {
      const lines = [
        `TIMESTAMP  0 20230524122108`,
        `PROCESSOR  0 999 1`,
        `FILEID     0 999 000000 026 QTEMP/QSQLTEMP1(EMPLOYEES) 20230524122108 0`,
        `FILEID     0 001 000000 071 /home/LINUX/builds/ibmi-company_system/qrpglesrc/employees.pgm.sqlrpgle 20230429182220 0`,
        `ERROR      0 001 1 000041 000041 000 000041 000 SQL1001 S 30 048 External file definition for EMPLOYEE not found.`,
        `ERROR      0 001 1 000095 000095 020 000095 020 SQL1103 W 10 069 Position 20 Column definitions for table EMPLOYEE in *LIBL not found.`,
        `ERROR      0 001 1 000105 000105 025 000105 025 SQL0312 S 30 212 Position 25 Variable EMPLOYEE not defined or not usable. Reason: No declaration for the variable exists, the declaration is not within the current scope, or the variable does not have an equivalent SQL data type.`,
        `ERROR      0 001 1 000105 000105 034 000105 034 SQL0312 S 30 209 Position 34 Variable EMPNO not defined or not usable. Reason: No declaration for the variable exists, the declaration is not within the current scope, or the variable does not have an equivalent SQL data type.`,
        `ERROR      0 001 1 000106 000106 025 000106 025 SQL0312 S 30 212 Position 25 Variable EMPLOYEE not defined or not usable. Reason: No declaration for the variable exists, the declaration is not within the current scope, or the variable does not have an equivalent SQL data type.`,
        `ERROR      0 001 1 000106 000106 034 000106 034 SQL0312 S 30 212 Position 34 Variable FIRSTNME not defined or not usable. Reason: No declaration for the variable exists, the declaration is not within the current scope, or the variable does not have an equivalent SQL data type.`,
        `ERROR      0 001 1 000107 000107 025 000107 025 SQL0312 S 30 212 Position 25 Variable EMPLOYEE not defined or not usable. Reason: No declaration for the variable exists, the declaration is not within the current scope, or the variable does not have an equivalent SQL data type.`,
        `ERROR      0 001 1 000107 000107 034 000107 034 SQL0312 S 30 212 Position 34 Variable LASTNAME not defined or not usable. Reason: No declaration for the variable exists, the declaration is not within the current scope, or the variable does not have an equivalent SQL data type.`,
        `ERROR      0 001 1 000108 000108 025 000108 025 SQL0312 S 30 212 Position 25 Variable EMPLOYEE not defined or not usable. Reason: No declaration for the variable exists, the declaration is not within the current scope, or the variable does not have an equivalent SQL data type.`,
        `ERROR      0 001 1 000108 000108 034 000108 034 SQL0312 S 30 207 Position 34 Variable JOB not defined or not usable. Reason: No declaration for the variable exists, the declaration is not within the current scope, or the variable does not have an equivalent SQL data type.`,
        `EXPANSION  0 001 000000 000000 999 000051 000115`,
        `EXPANSION  0 001 000098 000098 999 000154 000171`,
        `EXPANSION  0 001 000098 000098 999 000182 000195`,
        `EXPANSION  0 001 000108 000108 999 000206 000209`,
        `EXPANSION  0 001 000123 000123 999 000225 000236`,
        `FILEEND    0 001 000153`,
        `FILEEND    0 999 000266`,
      ];

      const errors = parseErrors(lines);

      const filePath = `/home/LINUX/builds/ibmi-company_system/qrpglesrc/employees.pgm.sqlrpgle`;

      assert.strictEqual(errors.size, 1);
      assert.strictEqual(errors.has(filePath), true);

      const fileErrors = errors.get(filePath);
      assert.notStrictEqual(fileErrors, undefined);
      assert.strictEqual(fileErrors?.length, 10);

      const errorA = fileErrors.find(err => err.linenum === 41);
      assert.notStrictEqual(errorA, undefined);

      assert.strictEqual(errorA?.code, `SQL1001`);
      assert.strictEqual(errorA?.linenum, 41);
      assert.strictEqual(errorA?.column, 0);
      assert.strictEqual(errorA?.toColumn, 0);
      assert.strictEqual(errorA?.sev, 30);
      assert.strictEqual(errorA?.text, `External file definition for EMPLOYEE not found.`);

      const lineErrors = fileErrors.filter(err => err.linenum === 106);
      assert.strictEqual(lineErrors.length, 2);

      assert.strictEqual(lineErrors[0]?.code, `SQL0312`);
      assert.strictEqual(lineErrors[0]?.linenum, 106);
      assert.strictEqual(lineErrors[0]?.column, 25);
      assert.strictEqual(lineErrors[0]?.toColumn, 25);
      assert.strictEqual(lineErrors[0]?.sev, 30);
      assert.strictEqual(lineErrors[0]?.text, `Position 25 Variable EMPLOYEE not defined or not usable. Reason: No declaration for the variable exists, the declaration is not within the current scope, or the variable does not have an equivalent SQL data type.`);

      assert.strictEqual(lineErrors[1]?.code, `SQL0312`);
      assert.strictEqual(lineErrors[1]?.linenum, 106);
      assert.strictEqual(lineErrors[1]?.column, 34);
      assert.strictEqual(lineErrors[1]?.toColumn, 34);
      assert.strictEqual(lineErrors[1]?.sev, 30);
      assert.strictEqual(lineErrors[1]?.text, `Position 34 Variable FIRSTNME not defined or not usable. Reason: No declaration for the variable exists, the declaration is not within the current scope, or the variable does not have an equivalent SQL data type.`);
    }}
  ]
}