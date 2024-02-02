import assert from "assert";
import tmp from 'tmp';
import util from 'util';
import { Uri, workspace } from "vscode";
import { TestSuite } from ".";
import { Tools } from "../api/Tools";
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
        const config = instance.getConfig();
        const content = instance.getContent();

        const resetValue = config!.enableSQL;

        // SQL needs to be disabled for this test.
        config!.enableSQL = false;
        const rows = await content?.getTable(`qiws`, `qcustcdt`, `*all`);

        config!.enableSQL = resetValue;

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

        assert.strictEqual(config!.enableSQL, true, `SQL must be enabled for this test`);

        // First we fetch the table in SQL mode
        const tempLib = config!.tempLibrary;
        const TempName = Tools.makeid();
        await connection?.runCommand({
          command: `DSPOBJD OBJ(QSYS/QSYSINC) OBJTYPE(*LIB) DETAIL(*TEXTATR) OUTPUT(*OUTFILE) OUTFILE(${tempLib}/${TempName})`,
          noLibList: true
        });
        const tableA = await content?.getTable(tempLib, TempName, TempName, true);

        config!.enableSQL = false;

        // Then we fetch the table without SQL
        const tableB = await content?.getTable(tempLib, TempName, TempName, true);

        // Reset the config
        config!.enableSQL = true;

        assert.notDeepStrictEqual(tableA, tableB);
      }
    },

    {
      name: `Test getTable (SQL enabled)`, test: async () => {
        const config = instance.getConfig();
        const content = instance.getContent();

        assert.strictEqual(config!.enableSQL, true, `SQL must be enabled for this test`);

        const rows = await content?.getTable(`qiws`, `qcustcdt`, `qcustcdt`);

        assert.notStrictEqual(rows?.length, 0);
      }
    },

    {
      name: `Test validateLibraryList`, test: async () => {
        const content = instance.getContent();

        const badLibs = await content?.validateLibraryList([`QSYSINC`, `BEEPBOOP`]);

        assert.strictEqual(badLibs?.includes(`BEEPBOOP`), true);
        assert.strictEqual(badLibs?.includes(`QSYSINC`), false);
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
        const config = instance.getConfig();
        const content = instance.getContent();

        assert.strictEqual(config!.enableSQL, true, `SQL must be enabled for this test`);

        // First we fetch the members in SQL mode
        const membersA = await content?.getMemberList({ library: `qsysinc`, sourceFile: `mih` });
        config!.enableSQL = false;

        // Then we fetch the members without SQL
        const membersB = await content?.getMemberList({ library: `qsysinc`, sourceFile: `mih` });
        // Reset the config
        config!.enableSQL = true;

        assert.deepStrictEqual(membersA, membersB);
      }
    },

    {
      name: `getMemberList (name filter, SQL compared to nosql)`, test: async () => {
        const config = instance.getConfig();
        const content = instance.getContent();

        assert.strictEqual(config!.enableSQL, true, `SQL must be enabled for this test`);

        // First we fetch the members in SQL mode
        const membersA = await content?.getMemberList({ library: `qsysinc`, sourceFile: `mih`, members: 'C*' });

        config!.enableSQL = false;

        // Then we fetch the members without SQL
        const membersB = await content?.getMemberList({ library: `qsysinc`, sourceFile: `mih`, members: 'C*' });

        // Reset the config
        config!.enableSQL = true;

        assert.deepStrictEqual(membersA, membersB);
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
      }
    }
  ]
};
