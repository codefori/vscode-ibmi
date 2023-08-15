import assert from "assert";
import { TestSuite } from ".";
import { parseErrors } from "../api/errors/parser";

export const ILEErrorSuite: TestSuite = {
  name: `ILE Error API tests`,
  tests: [
    {
      name: `Basic test (CRTSQLRPGI, member)`, test: async () => {
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
          `FILEEND    0 999 000264`
        ];

        const errors = parseErrors(lines);

        const filePath = `LIAMA/QRPGLESRC/EMPLOYEES`;

        assert.strictEqual(errors.size, 1);
        assert.strictEqual(errors.has(filePath), true);

        const fileErrors = errors.get(filePath);
        assert.notStrictEqual(fileErrors, undefined);
        assert.strictEqual(fileErrors?.length, 10);

        const errorA = fileErrors.find(err => err.lineNum === 44);
        assert.notStrictEqual(errorA, undefined);

        assert.strictEqual(errorA?.code, `SQL1001`);
        assert.strictEqual(errorA?.lineNum, 44);
        assert.strictEqual(errorA?.toLineNum, 44);
        assert.strictEqual(errorA?.column, 0);
        assert.strictEqual(errorA?.toColumn, 0);
        assert.strictEqual(errorA?.sev, 30);
        assert.strictEqual(errorA?.text, `External file definition for EMPLOYEE not found.`);

        const lineErrors = fileErrors.filter(err => err.lineNum === 104);
        assert.strictEqual(lineErrors.length, 2);

        assert.strictEqual(lineErrors[0]?.code, `SQL0312`);
        assert.strictEqual(lineErrors[0]?.lineNum, 104);
        assert.strictEqual(lineErrors[0]?.toLineNum, 104);
        assert.strictEqual(lineErrors[0]?.column, 16);
        assert.strictEqual(lineErrors[0]?.toColumn, 16);
        assert.strictEqual(lineErrors[0]?.sev, 30);
        assert.strictEqual(lineErrors[0]?.text, `Position 16 Variable EMPLOYEE not defined or not usable. Reason: No declaration for the variable exists, the declaration is not within the current scope, or the variable does not have an equivalent SQL data type.`);

        assert.strictEqual(lineErrors[1]?.code, `SQL0312`);
        assert.strictEqual(lineErrors[1]?.lineNum, 104);
        assert.strictEqual(lineErrors[1]?.toLineNum, 104);
        assert.strictEqual(lineErrors[1]?.column, 25);
        assert.strictEqual(lineErrors[1]?.toColumn, 25);
        assert.strictEqual(lineErrors[1]?.sev, 30);
        assert.strictEqual(lineErrors[1]?.text, `Position 25 Variable FIRSTNME not defined or not usable. Reason: No declaration for the variable exists, the declaration is not within the current scope, or the variable does not have an equivalent SQL data type.`);
      }
    },

    {
      name: `Basic test (CRTSQLRPGI, streamfile)`, test: async () => {
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
          `FILEEND    0 999 000266`
        ];

        const errors = parseErrors(lines);

        const filePath = `/home/LINUX/builds/ibmi-company_system/qrpglesrc/employees.pgm.sqlrpgle`;

        assert.strictEqual(errors.size, 1);
        assert.strictEqual(errors.has(filePath), true);

        const fileErrors = errors.get(filePath);
        assert.notStrictEqual(fileErrors, undefined);
        assert.strictEqual(fileErrors?.length, 10);

        const errorA = fileErrors.find(err => err.lineNum === 41);
        assert.notStrictEqual(errorA, undefined);

        assert.strictEqual(errorA?.code, `SQL1001`);
        assert.strictEqual(errorA?.lineNum, 41);
        assert.strictEqual(errorA?.toLineNum, 41);
        assert.strictEqual(errorA?.column, 0);
        assert.strictEqual(errorA?.toColumn, 0);
        assert.strictEqual(errorA?.sev, 30);
        assert.strictEqual(errorA?.text, `External file definition for EMPLOYEE not found.`);

        const lineErrors = fileErrors.filter(err => err.lineNum === 106);
        assert.strictEqual(lineErrors.length, 2);

        assert.strictEqual(lineErrors[0]?.code, `SQL0312`);
        assert.strictEqual(lineErrors[0]?.lineNum, 106);
        assert.strictEqual(lineErrors[0]?.toLineNum, 106);
        assert.strictEqual(lineErrors[0]?.column, 25);
        assert.strictEqual(lineErrors[0]?.toColumn, 25);
        assert.strictEqual(lineErrors[0]?.sev, 30);
        assert.strictEqual(lineErrors[0]?.text, `Position 25 Variable EMPLOYEE not defined or not usable. Reason: No declaration for the variable exists, the declaration is not within the current scope, or the variable does not have an equivalent SQL data type.`);

        assert.strictEqual(lineErrors[1]?.code, `SQL0312`);
        assert.strictEqual(lineErrors[1]?.lineNum, 106);
        assert.strictEqual(lineErrors[1]?.toLineNum, 106);
        assert.strictEqual(lineErrors[1]?.column, 34);
        assert.strictEqual(lineErrors[1]?.toColumn, 34);
        assert.strictEqual(lineErrors[1]?.sev, 30);
        assert.strictEqual(lineErrors[1]?.text, `Position 34 Variable FIRSTNME not defined or not usable. Reason: No declaration for the variable exists, the declaration is not within the current scope, or the variable does not have an equivalent SQL data type.`);
      }
    },

    {
      name: `Long source file path containing whitespaces (CRTSQLRPGI, streamfile)`, test: async () => {
        const lines = [
          `TIMESTAMP  0 20230405035632`,
          `PROCESSOR  0 999 1`,
          `FILEID     0 999 000000 024 QTEMP/QSQLTEMP1(FIX1200) 20230405035632 0`,
          `FILEID     0 001 000000 646 /home/ANGELORPA/builds/sources/long-directory-name-for-testing-long-paths/subdirectory-with-a-long-name-for-testing-long-paths/another-subdirectory-with-a-long-name-for-testing-long-paths/one-more-subdirectory-this-is-the-last-one/01-long directory name w`,
          `FILEIDCONT 0 001 000000 000 ith spaces in/02-long directory with space in his name/03-long directory name with space in for testing prupouse/04-long directory name with space in for testing event file parser/05-long directory name with space in for testing event file parser/06-long `,
          `FILEIDCONT 0 001 000000 000 directory name with space in for testing event file parser/sorce file long name with space in for testing event file parser.pmg.sqlrpgle 20230403024018 0`,
          `ERROR      0 999 2 000000 000000 000 000000 000 SQL0053 W 10 024 No SQL statements found.`,
          `EXPANSION  0 001 000000 000000 999 000006 000070`,
          `FILEEND    0 001 000009`,
          `FILEEND    0 999 000074`,
          `PROCESSOR  0 000 1`,
          `FILEID     0 001 000000 046 /QSYS.LIB/QTEMP.LIB/QSQLTEMP1.FILE/FIX1200.MBR 20230405035632 0`,
          `ERROR      0 001 1 000072 000072 001 000072 005 RNF5377 E 20 038 The end of the expression is expected.`,
          `ERROR      0 001 1 000072 000072 001 000072 005 RNF7030 S 30 043 The name or indicator DSPLY is not defined.`,
          `ERROR      0 001 1 000070 000070 014 000070 019 RNF7031 I 00 047 The name or indicator SQFAPP is not referenced.`,
          `ERROR      0 001 1 000068 000068 014 000068 019 RNF7031 I 00 047 The name or indicator SQFCRT is not referenced.`,
          `ERROR      0 001 1 000069 000069 014 000069 019 RNF7031 I 00 047 The name or indicator SQFOVR is not referenced.`,
          `ERROR      0 001 1 000067 000067 014 000067 018 RNF7031 I 00 046 The name or indicator SQFRD is not referenced.`,
          `ERROR      0 001 1 000010 000010 011 000010 016 RNF7031 I 00 047 The name or indicator SQLAID is not referenced.`,
          `ERROR      0 001 1 000012 000012 011 000012 016 RNF7031 I 00 047 The name or indicator SQLABC is not referenced.`,
          `ERROR      0 001 1 000014 000014 011 000014 016 RNF7031 I 00 047 The name or indicator SQLCOD is not referenced.`,
          `ERROR      0 001 1 000016 000016 011 000016 016 RNF7031 I 00 047 The name or indicator SQLERL is not referenced.`,
          `ERROR      0 001 1 000018 000018 011 000018 016 RNF7031 I 00 047 The name or indicator SQLERM is not referenced.`,
          `ERROR      0 001 1 000020 000020 011 000020 016 RNF7031 I 00 047 The name or indicator SQLERP is not referenced.`,
          `ERROR      0 001 1 000022 000022 011 000022 016 RNF7031 I 00 047 The name or indicator SQLER1 is not referenced.`,
          `ERROR      0 001 1 000023 000023 011 000023 016 RNF7031 I 00 047 The name or indicator SQLER2 is not referenced.`,
          `ERROR      0 001 1 000024 000024 011 000024 016 RNF7031 I 00 047 The name or indicator SQLER3 is not referenced.`,
          `ERROR      0 001 1 000025 000025 011 000025 016 RNF7031 I 00 047 The name or indicator SQLER4 is not referenced.`,
          `ERROR      0 001 1 000026 000026 011 000026 016 RNF7031 I 00 047 The name or indicator SQLER5 is not referenced.`,
          `ERROR      0 001 1 000027 000027 011 000027 016 RNF7031 I 00 047 The name or indicator SQLER6 is not referenced.`,
          `ERROR      0 001 1 000028 000028 011 000028 017 RNF7031 I 00 048 The name or indicator SQLERRD is not referenced.`,
          `ERROR      0 001 1 000030 000030 011 000030 016 RNF7031 I 00 047 The name or indicator SQLWN0 is not referenced.`,
          `ERROR      0 001 1 000031 000031 011 000031 016 RNF7031 I 00 047 The name or indicator SQLWN1 is not referenced.`,
          `ERROR      0 001 1 000032 000032 011 000032 016 RNF7031 I 00 047 The name or indicator SQLWN2 is not referenced.`,
          `ERROR      0 001 1 000033 000033 011 000033 016 RNF7031 I 00 047 The name or indicator SQLWN3 is not referenced.`,
          `ERROR      0 001 1 000034 000034 011 000034 016 RNF7031 I 00 047 The name or indicator SQLWN4 is not referenced.`,
          `ERROR      0 001 1 000035 000035 011 000035 016 RNF7031 I 00 047 The name or indicator SQLWN5 is not referenced.`,
          `ERROR      0 001 1 000036 000036 011 000036 016 RNF7031 I 00 047 The name or indicator SQLWN6 is not referenced.`,
          `ERROR      0 001 1 000037 000037 011 000037 016 RNF7031 I 00 047 The name or indicator SQLWN7 is not referenced.`,
          `ERROR      0 001 1 000038 000038 011 000038 016 RNF7031 I 00 047 The name or indicator SQLWN8 is not referenced.`,
          `ERROR      0 001 1 000039 000039 011 000039 016 RNF7031 I 00 047 The name or indicator SQLWN9 is not referenced.`,
          `ERROR      0 001 1 000040 000040 011 000040 016 RNF7031 I 00 047 The name or indicator SQLWNA is not referenced.`,
          `ERROR      0 001 1 000041 000041 011 000041 017 RNF7031 I 00 048 The name or indicator SQLWARN is not referenced.`,
          `ERROR      0 001 1 000043 000043 011 000043 016 RNF7031 I 00 047 The name or indicator SQLSTT is not referenced.`,
          `ERROR      0 001 1 000054 000054 015 000054 026 RNF7031 I 00 051 The name or indicator SQLCLSE... is not referenced.`,
          `ERROR      0 001 1 000058 000058 015 000058 026 RNF7031 I 00 051 The name or indicator SQLCMIT... is not referenced.`,
          `ERROR      0 001 1 000050 000050 015 000050 026 RNF7031 I 00 051 The name or indicator SQLOPEN... is not referenced.`,
          `ERROR      0 001 1 000045 000045 015 000045 027 RNF7031 I 00 051 The name or indicator SQLROUT... is not referenced.`,
          `ERROR      0 001 0 000000 000000 000 000000 000 RNS9308 T 50 057 Compilation stopped. Severity 30 errors found in program.`,
          `FILEEND    0 001 000074`
        ];

        const errors = parseErrors(lines);

        // path containing whitespaces
        const filePath = `/home/ANGELORPA/builds/sources/long-directory-name-for-testing-long-paths/subdirectory-with-a-long` +
          `-name-for-testing-long-paths/another-subdirectory-with-a-long-name-for-testing-long-paths/one-more-subdirectory-this` +
          `-is-the-last-one/01-long directory name with spaces in/02-long directory with space in his name/03-long directory name` +
          ` with space in for testing prupouse/04-long directory name with space in for testing event file parser/05-long directory` +
          ` name with space in for testing event file parser/06-long directory name with space in for testing event file parser/` +
          `sorce file long name with space in for testing event file parser.pmg.sqlrpgle`;

        // erros.size is equal 1 as even the error in the intermediate file can be mapped to the original source file
        assert.strictEqual(errors.size, 1);
        assert.strictEqual(errors.has(filePath), true);
      }
    },
    {
      name: `Nested Copybook (CRTRPGLE, streamfile)`, test: async () => {
        const lines = [
          `TIMESTAMP  0 20230619181512`,
          `PROCESSOR  0 000 1`,
          `FILEID     0 001 000000 060 /home/ANGELORPA/builds/fix1200/display/qrpglesrc/hello.rpgle 20230619181454 0`,
          `FILEID     0 002 000004 063 /home/ANGELORPA/builds/fix1200/display/qprotsrc/constants.rpgle 20230619180115 0`,
          `FILEID     0 003 000007 064 /home/ANGELORPA/builds/fix1200/display/qprotsrc/constLeve2.rpgle 20230619181501 0`,
          `ERROR      0 003 1 000004 000004 002 000004 002 RNF0734 S 30 052 The statement must be complete before the file ends.`,
          `FILEEND    0 003 000004`,
          `ERROR      0 003 1 000004 000004 002 000004 002 RNF0734 S 30 052 The statement must be complete before the file ends.`,
          `FILEEND    0 002 000007`,
          `ERROR      0 001 1 000006 000006 001 000006 005 RNF3312 E 20 075 A keyword is specified more than once for a definition; keyword is ignored.`,
          `ERROR      0 001 1 000006 000006 007 000006 011 RNF3312 E 20 075 A keyword is specified more than once for a definition; keyword is ignored.`,
          `ERROR      0 001 1 000006 000006 013 000006 025 RNF3312 E 20 075 A keyword is specified more than once for a definition; keyword is ignored.`,
          `ERROR      0 001 1 000012 000012 001 000012 001 RNF0637 S 30 068 An operand was expected but was not found; specification is ignored.`,
          `ERROR      0 001 1 000012 000012 007 000012 007 RNF0637 S 30 068 An operand was expected but was not found; specification is ignored.`,
          `ERROR      0 003 1 000003 000003 007 000003 010 RNF7031 I 00 045 The name or indicator FILE is not referenced.`,
          `ERROR      0 002 1 000003 000003 007 000003 015 RNF7031 I 00 050 The name or indicator FIRST_DAY is not referenced.`,
          `ERROR      0 001 1 000012 000012 002 000012 005 RNF7030 S 30 042 The name or indicator INLR is not defined.`,
          `ERROR      0 002 1 000004 000004 007 000004 016 RNF7031 I 00 051 The name or indicator SECOND_DAY is not referenced.`,
          `ERROR      0 001 0 000000 000000 000 000000 000 RNS9308 T 50 057 Compilation stopped.Severity 30 errors found in program.`,
          `FILEEND    0 001 000013`
        ]


        const errors = parseErrors(lines);

        // 3 files (one main, one copybook and a nested copybook)
        const filePath = `/home/ANGELORPA/builds/fix1200/display/qrpglesrc/hello.rpgle`;
        const copybook_file_path = `/home/ANGELORPA/builds/fix1200/display/qprotsrc/constants.rpgle`;
        const nested_copybook_file_path = `/home/ANGELORPA/builds/fix1200/display/qprotsrc/constLeve2.rpgle`;

        // erros.size is equal to the number of PROCESSOR records in the events file
        assert.strictEqual(errors.size, 3);

        // should be 3 diferents files paths
        assert.strictEqual(errors.has(filePath), true);
        assert.strictEqual(errors.has(copybook_file_path), true);
        assert.strictEqual(errors.has(nested_copybook_file_path), true);

        // main file errors
        const fileErrors = errors.get(filePath);
        assert.notStrictEqual(fileErrors, undefined);
        assert.strictEqual(fileErrors?.length, 7);

        // copybook file errors
        const copybook_fileErrors = errors.get(copybook_file_path);
        assert.notStrictEqual(copybook_fileErrors, undefined);
        assert.strictEqual(copybook_fileErrors?.length, 2);

        // nested copybook file errors
        const nested_copybook_fileErrors = errors.get(nested_copybook_file_path);
        assert.notStrictEqual(nested_copybook_fileErrors, undefined);
        assert.strictEqual(nested_copybook_fileErrors?.length, 3);
      }
    },
    {
      name: `Filter errors (CRTSQLRPGI, streamfile)`, test: async () => {
        const lines = [
          "TIMESTAMP  0 20230815094609",
          "PROCESSOR  0 999 1",
          "FILEID     0 999 000000 024 QTEMP/QSQLPRE(EMPLOYEES) 20230815094609 0",
          "FILEID     0 001 000000 077 /home/LINUX/builds/ibmi-company_system-rmake/qrpglesrc/employees.pgm.sqlrpgle 20230805131228 0",
          "FILEID     0 002 000010 073 /home/LINUX/builds/ibmi-company_system-rmake/qrpgleref/constants.rpgleinc 20230804103719 0",
          "EXPANSION  0 000 000000 000000 999 000011 000011",
          "FILEEND    0 002 000026",
          "EXPANSION  0 000 000000 000000 999 000038 000038",
          "FILEEND    0 001 000145",
          "FILEEND    0 999 000173",
          "PROCESSOR  0 999 1",
          "FILEID     0 999 000000 026 QTEMP/QSQLTEMP1(EMPLOYEES) 20230815094609 0",
          "FILEID     0 001 000000 024 QTEMP/QSQLPRE(EMPLOYEES) 20230815094609 0",
          "EXPANSION  0 001 000000 000000 999 000074 000138",
          "EXPANSION  0 001 000118 000118 999 000176 000205",
          "EXPANSION  0 001 000118 000118 999 000214 000227",
          "EXPANSION  0 001 000128 000128 999 000238 000248",
          "EXPANSION  0 001 000143 000143 999 000264 000275",
          "FILEEND    0 001 000173",
          "FILEEND    0 999 000305",
          "PROCESSOR  0 000 1",
          "FILEID     0 001 000000 048 /QSYS.LIB/QTEMP.LIB/QSQLTEMP1.FILE/EMPLOYEES.MBR 20230815094609 0",
          "ERROR      0 001 1 000200 000200 009 000200 017 RNF7031 I 00 050 The name or indicator SQL_00016 is not referenced.",
          "ERROR      0 001 1 000202 000202 009 000202 017 RNF7031 I 00 050 The name or indicator SQL_00018 is not referenced.",
          "ERROR      0 001 1 000203 000203 009 000203 017 RNF7031 I 00 050 The name or indicator SQL_00019 is not referenced.",
          "ERROR      0 001 1 000204 000204 009 000204 017 RNF7031 I 00 050 The name or indicator SQL_00020 is not referenced.",
          "ERROR      0 001 1 000188 000188 009 000188 017 RNF7031 I 00 050 The name or indicator SQL_00007 is not referenced.",
          "ERROR      0 001 1 000189 000189 009 000189 017 RNF7031 I 00 050 The name or indicator SQL_00008 is not referenced.",
          "ERROR      0 001 1 000191 000191 009 000191 017 RNF7031 I 00 050 The name or indicator SQL_00010 is not referenced.",
          "ERROR      0 001 1 000179 000179 009 000179 017 RNF7031 I 00 050 The name or indicator SQL_00001 is not referenced.",
          "ERROR      0 001 1 000182 000182 009 000182 017 RNF7031 I 00 050 The name or indicator SQL_00004 is not referenced.",
          "ERROR      0 001 1 000173 000173 009 000173 014 RNF7031 I 00 047 The name or indicator ACTION is not referenced.",
          "ERROR      0 001 1 000070 000070 008 000070 015 RNF7031 I 00 048 The name or indicator MIDINIT is not referenced.",
          "ERROR      0 001 1 000070 000070 008 000070 015 RNF7031 I 00 049 The name or indicator WORKDEPT is not referenced.",
          "ERROR      0 001 1 000070 000070 008 000070 015 RNF7031 I 00 048 The name or indicator PHONENO is not referenced.",
          "ERROR      0 001 1 000070 000070 008 000070 015 RNF7031 I 00 049 The name or indicator HIREDATE is not referenced.",
          "ERROR      0 001 1 000070 000070 008 000070 015 RNF7031 I 00 048 The name or indicator EDLEVEL is not referenced.",
          "ERROR      0 001 1 000070 000070 008 000070 015 RNF7031 I 00 044 The name or indicator SEX is not referenced.",
          "ERROR      0 001 1 000070 000070 008 000070 015 RNF7031 I 00 050 The name or indicator BIRTHDATE is not referenced.",
          "ERROR      0 001 1 000070 000070 008 000070 015 RNF7031 I 00 047 The name or indicator SALARY is not referenced.",
          "ERROR      0 001 1 000070 000070 008 000070 015 RNF7031 I 00 046 The name or indicator BONUS is not referenced.",
          "ERROR      0 001 1 000070 000070 008 000070 015 RNF7031 I 00 045 The name or indicator COMM is not referenced.",
          "ERROR      0 001 1 000004 000004 008 000004 016 RNF7031 I 00 050 The name or indicator EMPLOYEES is not referenced.",
          "ERROR      0 001 1 000042 000042 001 000042 000 RNF7089 I 00 051 RPG provides Separate-Indicator area for file EMPS.",
          "ERROR      0 001 1 000012 000012 015 000012 017 RNF7031 I 00 044 The name or indicator F01 is not referenced.",
          "ERROR      0 001 1 000013 000013 015 000013 017 RNF7031 I 00 044 The name or indicator F02 is not referenced.",
          "ERROR      0 001 1 000014 000014 015 000014 017 RNF7031 I 00 044 The name or indicator F03 is not referenced.",
          "ERROR      0 001 1 000015 000015 015 000015 017 RNF7031 I 00 044 The name or indicator F04 is not referenced.",
          "ERROR      0 001 1 000016 000016 015 000016 017 RNF7031 I 00 044 The name or indicator F05 is not referenced.",
          "ERROR      0 001 1 000017 000017 015 000017 017 RNF7031 I 00 044 The name or indicator F06 is not referenced.",
          "ERROR      0 001 1 000018 000018 015 000018 017 RNF7031 I 00 044 The name or indicator F07 is not referenced.",
          "ERROR      0 001 1 000019 000019 015 000019 017 RNF7031 I 00 044 The name or indicator F08 is not referenced.",
          "ERROR      0 001 1 000020 000020 015 000020 017 RNF7031 I 00 044 The name or indicator F09 is not referenced.",
          "ERROR      0 001 1 000021 000021 015 000021 017 RNF7031 I 00 044 The name or indicator F10 is not referenced.",
          "ERROR      0 001 1 000022 000022 015 000022 017 RNF7031 I 00 044 The name or indicator F11 is not referenced.",
          "ERROR      0 001 1 000024 000024 015 000024 017 RNF7031 I 00 044 The name or indicator F13 is not referenced.",
          "ERROR      0 001 1 000025 000025 015 000025 017 RNF7031 I 00 044 The name or indicator F14 is not referenced.",
          "ERROR      0 001 1 000026 000026 015 000026 017 RNF7031 I 00 044 The name or indicator F15 is not referenced.",
          "ERROR      0 001 1 000027 000027 015 000027 017 RNF7031 I 00 044 The name or indicator F16 is not referenced.",
          "ERROR      0 001 1 000028 000028 015 000028 017 RNF7031 I 00 044 The name or indicator F17 is not referenced.",
          "ERROR      0 001 1 000029 000029 015 000029 017 RNF7031 I 00 044 The name or indicator F18 is not referenced.",
          "ERROR      0 001 1 000030 000030 015 000030 017 RNF7031 I 00 044 The name or indicator F19 is not referenced.",
          "ERROR      0 001 1 000031 000031 015 000031 017 RNF7031 I 00 044 The name or indicator F20 is not referenced.",
          "ERROR      0 001 1 000032 000032 015 000032 017 RNF7031 I 00 044 The name or indicator F21 is not referenced.",
          "ERROR      0 001 1 000033 000033 015 000033 017 RNF7031 I 00 044 The name or indicator F22 is not referenced.",
          "ERROR      0 001 1 000034 000034 015 000034 017 RNF7031 I 00 044 The name or indicator F24 is not referenced.",
          "ERROR      0 001 1 000036 000036 015 000036 018 RNF7031 I 00 045 The name or indicator HELP is not referenced.",
          "ERROR      0 001 1 000068 000068 007 000068 011 RNF7031 I 00 046 The name or indicator INDEX is not referenced.",
          "ERROR      0 001 1 000172 000172 009 000172 014 RNF7031 I 00 047 The name or indicator LCOUNT is not referenced.",
          "ERROR      0 001 1 000174 000174 009 000174 015 RNF7031 I 00 048 The name or indicator LONGACT is not referenced.",
          "ERROR      0 001 1 000037 000037 015 000037 019 RNF7031 I 00 046 The name or indicator PRINT is not referenced.",
          "ERROR      0 001 1 000138 000138 014 000138 019 RNF7031 I 00 047 The name or indicator SQFAPP is not referenced.",
          "ERROR      0 001 1 000136 000136 014 000136 019 RNF7031 I 00 047 The name or indicator SQFCRT is not referenced.",
          "ERROR      0 001 1 000137 000137 014 000137 019 RNF7031 I 00 047 The name or indicator SQFOVR is not referenced.",
          "ERROR      0 001 1 000135 000135 014 000135 018 RNF7031 I 00 046 The name or indicator SQFRD is not referenced.",
          "ERROR      0 001 1 000078 000078 011 000078 016 RNF7031 I 00 047 The name or indicator SQLAID is not referenced.",
          "ERROR      0 001 1 000080 000080 011 000080 016 RNF7031 I 00 047 The name or indicator SQLABC is not referenced.",
          "ERROR      0 001 1 000082 000082 011 000082 016 RNF7031 I 00 047 The name or indicator SQLCOD is not referenced.",
          "ERROR      0 001 1 000084 000084 011 000084 016 RNF7031 I 00 047 The name or indicator SQLERL is not referenced.",
          "ERROR      0 001 1 000086 000086 011 000086 016 RNF7031 I 00 047 The name or indicator SQLERM is not referenced.",
          "ERROR      0 001 1 000088 000088 011 000088 016 RNF7031 I 00 047 The name or indicator SQLERP is not referenced.",
          "ERROR      0 001 1 000090 000090 011 000090 016 RNF7031 I 00 047 The name or indicator SQLER1 is not referenced.",
          "ERROR      0 001 1 000091 000091 011 000091 016 RNF7031 I 00 047 The name or indicator SQLER2 is not referenced.",
          "ERROR      0 001 1 000092 000092 011 000092 016 RNF7031 I 00 047 The name or indicator SQLER3 is not referenced.",
          "ERROR      0 001 1 000093 000093 011 000093 016 RNF7031 I 00 047 The name or indicator SQLER4 is not referenced.",
          "ERROR      0 001 1 000094 000094 011 000094 016 RNF7031 I 00 047 The name or indicator SQLER5 is not referenced.",
          "ERROR      0 001 1 000096 000096 011 000096 017 RNF7031 I 00 048 The name or indicator SQLERRD is not referenced.",
          "ERROR      0 001 1 000098 000098 011 000098 016 RNF7031 I 00 047 The name or indicator SQLWN0 is not referenced.",
          "ERROR      0 001 1 000099 000099 011 000099 016 RNF7031 I 00 047 The name or indicator SQLWN1 is not referenced.",
          "ERROR      0 001 1 000100 000100 011 000100 016 RNF7031 I 00 047 The name or indicator SQLWN2 is not referenced.",
          "ERROR      0 001 1 000101 000101 011 000101 016 RNF7031 I 00 047 The name or indicator SQLWN3 is not referenced.",
          "ERROR      0 001 1 000102 000102 011 000102 016 RNF7031 I 00 047 The name or indicator SQLWN4 is not referenced.",
          "ERROR      0 001 1 000103 000103 011 000103 016 RNF7031 I 00 047 The name or indicator SQLWN5 is not referenced.",
          "ERROR      0 001 1 000104 000104 011 000104 016 RNF7031 I 00 047 The name or indicator SQLWN6 is not referenced.",
          "ERROR      0 001 1 000105 000105 011 000105 016 RNF7031 I 00 047 The name or indicator SQLWN7 is not referenced.",
          "ERROR      0 001 1 000106 000106 011 000106 016 RNF7031 I 00 047 The name or indicator SQLWN8 is not referenced.",
          "ERROR      0 001 1 000107 000107 011 000107 016 RNF7031 I 00 047 The name or indicator SQLWN9 is not referenced.",
          "ERROR      0 001 1 000108 000108 011 000108 016 RNF7031 I 00 047 The name or indicator SQLWNA is not referenced.",
          "ERROR      0 001 1 000109 000109 011 000109 017 RNF7031 I 00 048 The name or indicator SQLWARN is not referenced.",
          "ERROR      0 001 1 000111 000111 011 000111 016 RNF7031 I 00 047 The name or indicator SQLSTT is not referenced.",
          "ERROR      0 001 1 000126 000126 015 000126 026 RNF7031 I 00 051 The name or indicator SQLCMIT... is not referenced.",
          "ERROR      0 001 1 000049 000049 003 000049 012 RNF7031 I 00 051 The name or indicator PROCESSSCF is not referenced.",
          "ERROR      0 001 1 000050 000050 003 000050 012 RNF7031 I 00 051 The name or indicator REPRINTSCF is not referenced.",
          "ERROR      0 001 1 000051 000051 003 000051 007 RNF7031 I 00 046 The name or indicator ERROR is not referenced.",
          "ERROR      0 001 1 000052 000052 003 000052 010 RNF7031 I 00 049 The name or indicator PAGEDOWN is not referenced.",
          "ERROR      0 001 1 000053 000053 003 000053 008 RNF7031 I 00 047 The name or indicator PAGEUP is not referenced.",
          "ERROR      0 001 1 000054 000054 003 000054 008 RNF7031 I 00 047 The name or indicator SFLEND is not referenced.",
          "ERROR      0 001 1 000055 000055 003 000055 010 RNF7031 I 00 049 The name or indicator SFLBEGIN is not referenced.",
          "ERROR      0 001 1 000056 000056 003 000056 010 RNF7031 I 00 049 The name or indicator NORECORD is not referenced.",
          "ERROR      0 001 1 000058 000058 003 000058 008 RNF7031 I 00 047 The name or indicator SFLCLR is not referenced.",
          "FILEEND    0 001 000305"
        ];

        const errors = parseErrors(lines);

        // 2 files (one main and one copybook)
        const filePath = `/home/LINUX/builds/ibmi-company_system-rmake/qrpglesrc/employees.pgm.sqlrpgle`;
        const copybook_file_path = `/home/LINUX/builds/ibmi-company_system-rmake/qrpgleref/constants.rpgleinc`;
        assert.strictEqual(errors.size, 2);
        assert.strictEqual(errors.has(filePath), true);
        assert.strictEqual(errors.has(copybook_file_path), true);

        // main file errors
        const fileErrors = errors.get(filePath);
        assert.notStrictEqual(fileErrors, undefined);
        assert.strictEqual(fileErrors?.length, 25);

        // copybook file errors
        const copybook_fileErrors = errors.get(copybook_file_path);
        assert.notStrictEqual(copybook_fileErrors, undefined);
        assert.strictEqual(copybook_fileErrors?.length, 24);
      }
    }
  ]
}
