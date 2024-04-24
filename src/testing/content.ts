import assert from "assert";
import tmp from 'tmp';
import util, { TextDecoder } from 'util';
import { Uri, workspace } from "vscode";
import { TestSuite } from ".";
import { Tools } from "../api/Tools";
import { getMemberUri } from "../filesystems/qsys/QSysFs";
import { instance } from "../instantiate";
import { CommandResult } from "../typings";

export const ContentSuite: TestSuite = {
  name: `Content API tests`,
  tests: [
    {
      name: `Test memberResolve`, test: async () => {
        const content = instance.getContent();

        const member = await content?.memberResolve(`MATH`, [
          { library: `QSYSINC`, name: `MIH` }, // Doesn't exist here
          { library: `QSYSINC`, name: `H` } // Does exist
        ]);

        assert.deepStrictEqual(member, {
          asp: undefined,
          library: `QSYSINC`,
          file: `H`,
          name: `MATH`,
          extension: `MBR`,
          basename: `MATH.MBR`
        });
      }
    },


    {
      name: `Test memberResolve (with invalid ASP)`, test: async () => {
        const content = instance.getContent();

        const member = await content?.memberResolve(`MATH`, [
          { library: `QSYSINC`, name: `MIH` }, // Doesn't exist here
          { library: `QSYSINC`, name: `H`, asp: `myasp` } // Does exist, but not in the ASP
        ]);

        assert.deepStrictEqual(member, {
          asp: undefined,
          library: `QSYSINC`,
          file: `H`,
          name: `MATH`,
          extension: `MBR`,
          basename: `MATH.MBR`
        });
      }
    },

    {
      name: `Test memberResolve with variants`, test: async () => {
        const content = instance.getContent();
        const config = instance.getConfig();
        const connection = instance.getConnection();
        const tempLib = config!.tempLibrary,
              tempSPF = `O_ABC`.concat(connection!.variantChars.local),
              tempMbr = `O_ABC`.concat(connection!.variantChars.local);

        const result = await connection!.runCommand({
          command: `CRTSRCPF ${tempLib}/${tempSPF} MBR(${tempMbr})`,
          environment: `ile`
        });

        const member = await content?.memberResolve(tempMbr, [
          { library: `QSYSINC`, name: `MIH` }, // Doesn't exist here
          { library: `NOEXIST`, name: `SUP` }, // Doesn't exist here
          { library: tempLib, name: tempSPF } // Doesn't exist here
        ]);

        assert.deepStrictEqual(member, {
          asp: undefined,
          library: tempLib,
          file: tempSPF,
          name: tempMbr,
          extension: `MBR`,
          basename: `${tempMbr}.MBR`
        });

        // Cleanup...
        await connection!.runCommand({
          command: `DLTF ${tempLib}/${tempSPF}`,
          environment: `ile`
        });
      }
    },

    {
      name: `Test memberResolve with bad name`, test: async () => {
        const content = instance.getContent();

        const member = await content?.memberResolve(`BOOOP`, [
          { library: `QSYSINC`, name: `MIH` }, // Doesn't exist here
          { library: `NOEXIST`, name: `SUP` }, // Doesn't exist here
          { library: `QSYSINC`, name: `H` } // Doesn't exist here
        ]);

        assert.deepStrictEqual(member, undefined);
      }
    },

    {
      name: `Test objectResolve .FILE`, test: async () => {
        const content = instance.getContent();

        const lib = await content?.objectResolve(`MIH`, [
          "QSYS2", // Doesn't exist here
          "QSYSINC" // Does exist
        ]);

        assert.strictEqual(lib, "QSYSINC");
      }
    },

    {
      name: `Test objectResolve .PGM`, test: async () => {
        const content = instance.getContent();

        const lib = await content?.objectResolve(`CMRCV`, [
          "QSYSINC", // Doesn't exist here
          "QSYS2" // Does exist
        ]);

        assert.strictEqual(lib, "QSYS2");
      }
    },

    {
      name: `Test objectResolve .DTAARA with variants`, test: async () => {
        const content = instance.getContent();
        const config = instance.getConfig();
        const connection = instance.getConnection();
        const tempLib = config!.tempLibrary,
              tempObj = `O_ABC`.concat(connection!.variantChars.local);

        await connection!.runCommand({
          command: `CRTDTAARA ${tempLib}/${tempObj} TYPE(*CHAR)`,
          environment: `ile`
        });

        const lib = await content?.objectResolve(tempObj, [
          "QSYSINC", // Doesn't exist here
          "QSYS2", // Doesn't exist here
          tempLib // Does exist here
        ]);

        assert.strictEqual(lib, tempLib);

        // Cleanup...
        await connection!.runCommand({
          command: `DLTDTAARA ${tempLib}/${tempObj}`,
          environment: `ile`
        });
      }
    },

    {
      name: `Test objectResolve with bad name`, test: async () => {
        const content = instance.getContent();

        const lib = await content?.objectResolve(`BOOOP`, [
          "BADLIB", // Doesn't exist here
          "QSYS2", // Doesn't exist here
          "QSYSINC", // Doesn't exist here
        ]);

        assert.strictEqual(lib, undefined);

      }
    },

    {
      name: `Test streamfileResolve`, test: async () => {
        const content = instance.getContent();

        const streamfilePath = await content?.streamfileResolve([`git`], [`/QOpenSys/pkgs/sbin`, `/QOpenSys/pkgs/bin`])

        assert.strictEqual(streamfilePath, `/QOpenSys/pkgs/bin/git`);
      }
    },

    {
      name: `Test streamfileResolve with bad name`, test: async () => {
        const content = instance.getContent();

        const streamfilePath = await content?.streamfileResolve([`sup`], [`/QOpenSys/pkgs/sbin`, `/QOpenSys/pkgs/bin`])

        assert.strictEqual(streamfilePath, undefined);
      }
    },

    {
      name: `Test streamfileResolve with multiple names`, test: async () => {
        const content = instance.getContent();

        const streamfilePath = await content?.streamfileResolve([`sup`, `sup2`, `git`], [`/QOpenSys/pkgs/sbin`, `/QOpenSys/pkgs/bin`])

        assert.strictEqual(streamfilePath, `/QOpenSys/pkgs/bin/git`);
      }
    },



    {
      name: `Test streamfileResolve with blanks in names`, test: async () => {
        const connection = instance.getConnection();
        const content = instance.getContent();
        const files = [`normalname`, `name with blank`, `name_with_quote'`, `name_with_dollar$`];
        const dir = `/tmp/${Date.now()}`;
        const dirWithSubdir = `${dir}/${files[0]}`;

        let result: CommandResult | undefined;

        result = await connection?.sendCommand({ command: `mkdir -p "${dir}"` });
        assert.strictEqual(result?.code, 0);
        try {
          for (const file of files) {
            result = await connection?.sendCommand({ command: `touch "${dir}/${file}"` });
            assert.strictEqual(result?.code, 0);
          };

          for (const file of files) {
            let result = await content?.streamfileResolve([`${Date.now()}`, file], [`${Date.now()}`, dir]);
            assert.strictEqual(result, `${dir}/${file}`, `Resolving file "${dir}/${file}" failed`);
          }
        }
        finally {
          result = await connection?.sendCommand({ command: `rm -r "${dir}"` });
          assert.strictEqual(result?.code, 0);
        }
      }
    },

    {
      name: `Test downloadMemberContent`, test: async () => {
        const content = instance.getContent();

        const tmpFile = await util.promisify(tmp.file)();
        const memberContent = await content?.downloadMemberContent(undefined, 'QSYSINC', 'H', 'MATH', tmpFile);
        const tmpFileContent = (await workspace.fs.readFile(Uri.file(tmpFile))).toString();

        assert.strictEqual(tmpFileContent, memberContent);
      }
    },

    {
      name: `Test runSQL (basic select)`, test: async () => {
        const content = instance.getContent();

        const rows = await content?.runSQL(`select * from qiws.qcustcdt`);
        assert.notStrictEqual(rows?.length, 0);

        const firstRow = rows![0];
        assert.strictEqual(typeof firstRow[`BALDUE`], `number`);
        assert.strictEqual(typeof firstRow[`CITY`], `string`);
      }
    },

    {
      name: `Test runSQL (bad basic select)`, test: async () => {
        const content = instance.getContent();

        try {
          await content?.runSQL(`select from qiws.qcustcdt`);
        } catch (e: any) {
          assert.strictEqual(e.message, `Token . was not valid. Valid tokens: , FROM INTO. (42601)`);
          assert.strictEqual(e.sqlstate, `42601`);
        }
      }
    },

    {
      name: `Test runSQL (with comments)`, test: async () => {
        const content = instance.getContent();

        const rows = await content?.runSQL([
          `-- myselect`,
          `select *`,
          `from qiws.qcustcdt --my table`,
          `limit 1`,
        ].join(`\n`));

        assert.strictEqual(rows?.length, 1);
      }
    },

    {
      name: `Test getTable (SQL disabled)`, test: async () => {
        const connection = instance.getConnection();
        const content = instance.getContent();

        // SQL needs to be disabled for this test.
        connection!.enableSQL = false;
        const rows = await content?.getTable(`qiws`, `qcustcdt`, `*all`);

        assert.notStrictEqual(rows?.length, 0);
        const firstRow = rows![0];

        assert.strictEqual(typeof firstRow[`BALDUE`], `number`);
        assert.strictEqual(typeof firstRow[`CITY`], `string`);
      }
    },

    {
      name: `Test getTable (SQL compared to nosql)`, test: async () => {
        const config = instance.getConfig();
        const content = instance.getContent();
        const connection = instance.getConnection();

        const tempLib = config!.tempLibrary;
        const TempName = Tools.makeid();
        await connection?.runCommand({
          command: `DSPOBJD OBJ(QSYS/QSYSINC) OBJTYPE(*LIB) DETAIL(*TEXTATR) OUTPUT(*OUTFILE) OUTFILE(${tempLib}/${TempName})`,
          noLibList: true
        });

        // First we fetch the table in SQL mode
        connection!.enableSQL = true;
        const tableA = await content?.getTable(tempLib, TempName, TempName, false);

        // Then we fetch the table without SQL
        connection!.enableSQL = false;
        const tableB = await content?.getTable(tempLib, TempName, TempName, true);

        assert.deepStrictEqual(tableA, tableB);
      }
    },

    {
      name: `Test getTable (SQL enabled)`, test: async () => {
        const connection = instance.getConnection();
        const content = instance.getContent();
        const config = instance.getConfig();

        const tempLib = config!.tempLibrary;
        const TempName = Tools.makeid();
        await connection?.runCommand({
          command: `DSPOBJD OBJ(QSYS/QSYSINC) OBJTYPE(*LIB) DETAIL(*TEXTATR) OUTPUT(*OUTFILE) OUTFILE(${tempLib}/${TempName})`,
          noLibList: true
        });

        connection!.enableSQL = true;

        const rows = await content?.getTable(tempLib, TempName, TempName);

        assert.notStrictEqual(rows?.length, 0);
      }
    },

    {
      name: `Test validateLibraryList`, test: async () => {
        const content = instance.getContent();

        const badLibs = await content?.validateLibraryList([`SCOOBY`, `QSYSINC`, `BEEPBOOP`]);

        assert.strictEqual(badLibs?.includes(`BEEPBOOP`), true);
        assert.strictEqual(badLibs?.includes(`QSYSINC`), false);
        assert.strictEqual(badLibs?.includes(`SCOOBY`), true);
      }
    },

    {
      name: `Test getFileList`, test: async () => {
        const content = instance.getContent();

        const objects = await content?.getFileList(`/`);

        const qsysLib = objects?.find(obj => obj.name === `QSYS.LIB`);

        assert.strictEqual(qsysLib?.name, `QSYS.LIB`);
        assert.strictEqual(qsysLib?.path, `/QSYS.LIB`);
        assert.strictEqual(qsysLib?.type, `directory`);
        assert.strictEqual(qsysLib?.owner, `qsys`);
      }
    },

    {
      name: `Test getFileList (non-existing file)`, test: async () => {
        const content = instance.getContent();

        const objects = await content?.getFileList(`/tmp/${Date.now()}`);

        assert.strictEqual(objects?.length, 0);
      }
    },

    {
      name: `Test getFileList (special chars)`, test: async () => {
        const connection = instance.getConnection();
        const content = instance.getContent();
        const files = [`name with blank`, `name_with_quote'`, `name_with_dollar$`];
        const dir = `/tmp/${Date.now()}`;
        const dirWithSubdir = `${dir}/${files[0]}`;

        let result: CommandResult | undefined;

        result = await connection?.sendCommand({ command: `mkdir -p "${dirWithSubdir}"` });
        assert.strictEqual(result?.code, 0);
        try {
          for (const file of files) {
            result = await connection?.sendCommand({ command: `touch "${dirWithSubdir}/${file}"` });
            assert.strictEqual(result?.code, 0);
          };

          const objects = await content?.getFileList(`${dirWithSubdir}`);
          assert.strictEqual(objects?.length, files.length);
          assert.deepStrictEqual(objects?.map(a => a.name).sort(), files.sort());
        }
        finally {
          result = await connection?.sendCommand({ command: `rm -r "${dir}"` });
          assert.strictEqual(result?.code, 0);
        }
      }
    },

    {
      name: `Test getObjectList (all objects)`, test: async () => {
        const content = instance.getContent();

        const objects = await content?.getObjectList({ library: `QSYSINC` });

        assert.notStrictEqual(objects?.length, 0);
      }
    },

    {
      name: `Test getObjectList (pgm filter)`, test: async () => {
        const content = instance.getContent();

        const objects = await content?.getObjectList({ library: `QSYSINC`, types: [`*PGM`] });

        assert.notStrictEqual(objects?.length, 0);

        const containsNonPgms = objects?.some(obj => obj.type !== `*PGM`);

        assert.strictEqual(containsNonPgms, false);
      }
    },

    {
      name: `Test getObjectList (source files only)`, test: async () => {
        const content = instance.getContent();

        const objects = await content?.getObjectList({ library: `QSYSINC`, types: [`*SRCPF`] });

        assert.notStrictEqual(objects?.length, 0);

        const containsNonFiles = objects?.some(obj => obj.type !== `*FILE`);

        assert.strictEqual(containsNonFiles, false);
      }
    },
    {
      name: `Test getObjectList (source files only, named filter)`, test: async () => {
        const content = instance.getContent();

        const objects = await content?.getObjectList({ library: `QSYSINC`, types: [`*SRCPF`], object: `MIH` });

        assert.strictEqual(objects?.length, 1);

        assert.strictEqual(objects[0].type, `*FILE`);
        assert.strictEqual(objects[0].text, `DATA BASE FILE FOR C INCLUDES FOR MI`);
      }
    },
    {
      name: `getLibraries (simple filters)`, test: async () => {
        const content = instance.getContent();

        const qsysLibraries = await content?.getLibraries({ library: "QSYS*" })
        assert.notStrictEqual(qsysLibraries?.length, 0);
        assert.strictEqual(qsysLibraries?.every(l => l.name.startsWith("QSYS")), true);

        const includeSYSLibraries = await content?.getLibraries({ library: "*SYS*" });
        assert.notStrictEqual(includeSYSLibraries?.length, 0);
        assert.strictEqual(includeSYSLibraries?.every(l => l.name.includes("SYS")), true);
      }
    },
    {
      name: `getLibraries (regexp filters)`, test: async () => {
        const content = instance.getContent();

        const qsysLibraries = await content?.getLibraries({ library: "^.*SYS[^0-9]*$", filterType: "regex" })
        assert.notStrictEqual(qsysLibraries?.length, 0);
        assert.strictEqual(qsysLibraries?.every(l => /^.*SYS[^0-9]*$/.test(l.name)), true);
      }
    },
    {
      name: `getObjectList (advanced filtering)`, test: async () => {
        const content = instance.getContent();
        const objects = await content?.getObjectList({ library: `QSYSINC`, object: "L*OU*" });

        assert.notStrictEqual(objects?.length, 0);
        assert.strictEqual(objects?.map(o => o.name).every(n => n.startsWith("L") && n.includes("OU")), true);
      }
    },
    {
      name: `getMemberList (SQL, no filter)`, test: async () => {
        const content = instance.getContent();

        let members = await content?.getMemberList({ library: `qsysinc`, sourceFile: `mih`, members: `*inxen` });

        assert.strictEqual(members?.length, 3);

        members = await content?.getMemberList({ library: `qsysinc`, sourceFile: `mih` });

        const actbpgm = members?.find(mbr => mbr.name === `ACTBPGM`);

        assert.strictEqual(actbpgm?.name, `ACTBPGM`);
        assert.strictEqual(actbpgm?.extension, `C`);
        assert.strictEqual(actbpgm?.text, `ACTIVATE BOUND PROGRAM`);
        assert.strictEqual(actbpgm?.library, `QSYSINC`);
        assert.strictEqual(actbpgm?.file, `MIH`);
      }
    },

    {
      name: `getMemberList (SQL compared to nosql)`, test: async () => {
        const connection = instance.getConnection();
        const content = instance.getContent();

        // First we fetch the members in SQL mode
        const membersA = await content?.getMemberList({ library: `qsysinc`, sourceFile: `mih` });

        assert.notStrictEqual(membersA?.length, 0);

        // Then we fetch the members without SQL
        connection!.enableSQL = false;

        try {
          await content?.getMemberList({ library: `qsysinc`, sourceFile: `mih` });
          assert.fail(`Should have thrown an error`);
        } catch (e) {
          // This fails because getMemberList has no ability   to fetch members without SQL
          assert.ok(e);
        }
      }
    },

    {
      name: `getMemberList (name filter, SQL compared to nosql)`, test: async () => {
        const connection = instance.getConnection();
        const content = instance.getContent();

        // First we fetch the members in SQL mode
        connection!.enableSQL = true;
        const membersA = await content?.getMemberList({ library: `qsysinc`, sourceFile: `mih`, members: 'C*' });

        assert.notStrictEqual(membersA?.length, 0);

        // Then we fetch the members without SQL
        connection!.enableSQL = false;

        try {
          await content?.getMemberList({ library: `qsysinc`, sourceFile: `mih`, members: 'C*' });
          assert.fail(`Should have thrown an error`);
        } catch (e) {
          // This fails because getMemberList has no ability   to fetch members without SQL
          assert.ok(e);
        }
      }
    },
    {
      name: `getMemberList (advanced filtering)`, test: async () => {
        const content = instance.getContent();

        const members = await content?.getMemberList({ library: `QSYSINC`, sourceFile: `QRPGLESRC`, members: 'SYS*,I*,*EX' });
        assert.notStrictEqual(members?.length, 0)
        assert.strictEqual(members!.map(m => m.name).every(n => n.startsWith('SYS') || n.startsWith('I') || n.endsWith('EX')), true);

        const membersRegex = await content?.getMemberList({ library: `QSYSINC`, sourceFile: `QRPGLESRC`, members: '^QSY(?!RTV).*$', filterType: "regex" });
        assert.notStrictEqual(membersRegex?.length, 0);
        assert.strictEqual(membersRegex!.map(m => m.name).every(n => n.startsWith('QSY') && !n.includes('RTV')), true);
      }
    },
    {
      name: `Test getQtempTable`, test: async () => {
        const content = instance.getContent();

        const queries = [
          `CALL QSYS2.QCMDEXC('DSPOBJD OBJ(QSYSINC/*ALL) OBJTYPE(*ALL) OUTPUT(*OUTFILE) OUTFILE(QTEMP/DSPOBJD)')`,
          `Create Table QTEMP.OBJECTS As (
          Select ODLBNM as LIBRARY,
            ODOBNM as NAME,
            ODOBAT as ATTRIBUTE,
            ODOBTP as TYPE,
            Coalesce(ODOBTX, '') as TEXT
          From QTEMP.DSPOBJD
        ) With Data`
        ];


        const nosqlContent = await content?.getQTempTable(queries, "OBJECTS");
        const objects = nosqlContent?.map(row => ({
          library: row.LIBRARY,
          name: row.NAME,
          attribute: row.ATTRIBUTE,
          type: row.TYPE,
          text: row.TEXT,
        }));

        assert.notStrictEqual(objects?.length, 0);
        assert.strictEqual(objects?.every(obj => obj.library === "QSYSINC"), true);

        const qrpglesrc = objects.find(obj => obj.name === "QRPGLESRC");
        assert.notStrictEqual(qrpglesrc, undefined);
        assert.strictEqual(qrpglesrc?.attribute === "PF", true);
        assert.strictEqual(qrpglesrc?.type === "*FILE", true);
      },
    },
    {
      name: `To CL`, test: async () => {
        const command = instance.getContent()!.toCl("TEST", {
          ZERO: 0,
          NONE:'*NONE',
          EMPTY: `''`,
          OBJNAME: `OBJECT`,
          OBJCHAR: `ObJect`,
          IFSPATH: `/hello/world`
        });

        assert.strictEqual(command, "TEST ZERO(0) NONE(*NONE) EMPTY('') OBJNAME(OBJECT) OBJCHAR('ObJect') IFSPATH('/hello/world')");
      }
    },
    {
      name: `Check object (file)`, test: async () => {
        const content = instance.getContent();

        const exists = await content?.checkObject({ library: `QSYSINC`, name: `MIH`, type: `*FILE` });
        assert.ok(exists);
      }
    },
    {
      name: `Check object (no exist)`, test: async () => {
        const content = instance.getContent();

        const exists = await content?.checkObject({ library: `QSYSINC`, name: `BOOOP`, type: `*FILE` });
        assert.strictEqual(exists, false);
      }
    },
    {
      name: `Check object (source member)`, test: async () => {
        const content = instance.getContent();

        const exists = await content?.checkObject({ library: `QSYSINC`, name: `H`, type: `*FILE`, member: `MATH` });
        assert.ok(exists);
      }
    },
    {
      name: `Check getMemberInfo`, test: async () => {
        const content = instance.getContent();

        const memberInfoA = await content?.getMemberInfo(`QSYSINC`, `H`, `MATH` );
        assert.ok(memberInfoA);
        assert.strictEqual(memberInfoA?.library === `QSYSINC`, true);
        assert.strictEqual(memberInfoA?.file === `H`, true);
        assert.strictEqual(memberInfoA?.name === `MATH`, true);
        assert.strictEqual(memberInfoA?.extension === `C`, true);
        assert.strictEqual(memberInfoA?.text === `STANDARD HEADER FILE MATH`, true);

        const memberInfoB = await content?.getMemberInfo(`QSYSINC`, `H`, `MEMORY` );
        assert.ok(memberInfoB);
        assert.strictEqual(memberInfoB?.library === `QSYSINC`, true);
        assert.strictEqual(memberInfoB?.file === `H`, true);
        assert.strictEqual(memberInfoB?.name === `MEMORY`, true);
        assert.strictEqual(memberInfoB?.extension === `CPP`, true);
        assert.strictEqual(memberInfoB?.text === `C++ HEADER`, true);

        const memberInfoC = await content?.getMemberInfo(`QSYSINC`, `H`, `OH_NONO` );
        assert.ok(!memberInfoC);
      }
    },
    {
      name: `Test @clCommand + select statement`, test: async () => {
        const content = instance.getContent()!;

        const [resultA] = await content.runSQL(`@CRTSAVF FILE(QTEMP/UNITTEST) TEXT('Code for i test');\nSelect * From Table(QSYS2.OBJECT_STATISTICS('QTEMP', '*FILE')) Where OBJATTRIBUTE = 'SAVF';`);

        assert.deepStrictEqual(resultA.OBJNAME, "UNITTEST");
        assert.deepStrictEqual(resultA.OBJTEXT, "Code for i test");

        const [resultB] = await content.runStatements(
          `@CRTSAVF FILE(QTEMP/UNITTEST) TEXT('Code for i test')`,
          `Select * From Table(QSYS2.OBJECT_STATISTICS('QTEMP', '*FILE')) Where OBJATTRIBUTE = 'SAVF'`
        );

        assert.deepStrictEqual(resultB.OBJNAME, "UNITTEST");
        assert.deepStrictEqual(resultB.OBJTEXT, "Code for i test");
      }
    },
    {
      name: `Write tab to member using SQL`, test: async () => {
        // Note: This is a known failure.
        const lines = [
          `if (a) {`,
          `\tcoolstuff();\t`,
          `}`
        ].join(`\n`);

        const connection = instance.getConnection();
        const config = instance.getConfig()!;

        assert.ok(config.enableSourceDates, `Source dates must be enabled for this test.`);

        const tempLib = config!.tempLibrary;

        await connection!.runCommand({ command: `CRTSRCPF FILE(${tempLib}/TABTEST) RCDLEN(112)`, noLibList: true });
        await connection!.runCommand({ command: `ADDPFM FILE(${tempLib}/TABTEST) MBR(THEBADONE) SRCTYPE(HELLO)` });

        const theBadOneUri = getMemberUri({library: tempLib, file: `TABTEST`, name: `THEBADONE`, extension: `HELLO`});

        // We have to read it first to create the alias!
        await workspace.fs.readFile(theBadOneUri);

        await workspace.fs.writeFile(theBadOneUri, Buffer.from(lines, `utf8`));

        const memberContentBuf = await workspace.fs.readFile(theBadOneUri);
        const fileContent = new TextDecoder().decode(memberContentBuf)
        
        assert.strictEqual(fileContent, lines);

      }
    }
  ]
};
