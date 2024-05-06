import assert from "assert";
import { TestSuite } from ".";
import { instance } from "../instantiate";

export const ConnectionSuite: TestSuite = {
  name: `Connection tests`,
  tests: [
    {
      name: `Test sendCommand`, test: async () => {
        const connection = instance.getConnection();

        const result = await connection?.sendCommand({
          command: `echo "Hello world"`,
        });

        assert.strictEqual(result?.code, 0);
        assert.strictEqual(result?.stdout, `Hello world`);
      }
    },

    {
      name: `Test sendCommand home directory`, test: async () => {
        const connection = instance.getConnection();

        const resultA = await connection?.sendCommand({
          command: `pwd`,
          directory: `/QSYS.LIB`
        });

        assert.strictEqual(resultA?.code, 0);
        assert.strictEqual(resultA?.stdout, `/QSYS.LIB`);

        const resultB = await connection?.sendCommand({
          command: `pwd`,
          directory: `/home`
        });

        assert.strictEqual(resultB?.code, 0);
        assert.strictEqual(resultB?.stdout, `/home`);

        const resultC = await connection?.sendCommand({
          command: `pwd`,
          directory: `/badnaughty`
        });

        assert.notStrictEqual(resultC?.stdout, `/badnaughty`);
      }
    },

    {
      name: `Test sendCommand with environment variables`, test: async () => {
        const connection = instance.getConnection();

        const result = await connection?.sendCommand({
          command: `echo "$vara $varB $VARC"`,
          env: {
            vara: `Hello`,
            varB: `world`,
            VARC: `cool`
          }
        });

        assert.strictEqual(result?.code, 0);
        assert.strictEqual(result?.stdout, `Hello world cool`);
      }
    },

    {
      name: `Test getTempRemote`, test: async () => {
        const connection = instance.getConnection();

        const fileA = connection?.getTempRemote(`/some/file`);
        const fileB = connection?.getTempRemote(`/some/badfile`);
        const fileC = connection?.getTempRemote(`/some/file`);

        assert.strictEqual(fileA, fileC);
        assert.notStrictEqual(fileA, fileB);
      }
    },

    {
      name: `Test parserMemberPath (simple)`, test: async () => {
        const connection = instance.getConnection();

        const memberA = connection?.parserMemberPath(`/thelib/thespf/thembr.mbr`);

        assert.strictEqual(memberA?.asp, undefined);
        assert.strictEqual(memberA?.library, `THELIB`);
        assert.strictEqual(memberA?.file, `THESPF`);
        assert.strictEqual(memberA?.name, `THEMBR`);
        assert.strictEqual(memberA?.extension, `MBR`);
        assert.strictEqual(memberA?.basename, `THEMBR.MBR`);
      }
    },

    {
      name: `Test parserMemberPath (ASP)`, test: async () => {
        const connection = instance.getConnection();

        const memberA = connection?.parserMemberPath(`/theasp/thelib/thespf/thembr.mbr`);

        assert.strictEqual(memberA?.asp, `THEASP`);
        assert.strictEqual(memberA?.library, `THELIB`);
        assert.strictEqual(memberA?.file, `THESPF`);
        assert.strictEqual(memberA?.name, `THEMBR`);
        assert.strictEqual(memberA?.extension, `MBR`);
        assert.strictEqual(memberA?.basename, `THEMBR.MBR`);
      }
    },

    {
      name: `Test parserMemberPath (no root)`, test: async () => {
        const connection = instance.getConnection();

        const memberA = connection?.parserMemberPath(`thelib/thespf/thembr.mbr`);

        assert.strictEqual(memberA?.asp, undefined);
        assert.strictEqual(memberA?.library, `THELIB`);
        assert.strictEqual(memberA?.file, `THESPF`);
        assert.strictEqual(memberA?.name, `THEMBR`);
        assert.strictEqual(memberA?.extension, `MBR`);
        assert.strictEqual(memberA?.basename, `THEMBR.MBR`);
      }
    },

    {
      name: `Test parserMemberPath (no extension)`, test: async () => {
        const connection = instance.getConnection();

        try {
          const memberA = connection?.parserMemberPath(`thelib/thespf/thembr`);
        } catch (e: any) {
          assert.strictEqual(e.message, `Source Type extension is required.`);
        }
      }
    },

    {
      name: `Test parserMemberPath (invalid length)`, test: async () => {
        const connection = instance.getConnection();

        try {
          const memberA = connection?.parserMemberPath(`/thespf/thembr.mbr`);
        } catch (e: any) {
          assert.strictEqual(e.message, `Invalid path: /thespf/thembr.mbr. Use format LIB/SPF/NAME.ext`);
        }
      }
    },

    {
      name: `Test runCommand (ILE)`, test: async () => {
        const connection = instance.getConnection();

        const result = await connection!.runCommand({
          command: `DSPJOB OPTION(*DFNA)`,
          environment: `ile`
        });

        assert.strictEqual(result?.code, 0);
        assert.strictEqual(["JOBPTY", "OUTPTY", "ENDSEV", "DDMCNV", "BRKMSG", "STSMSG", "DEVRCYACN", "TSEPOOL", "PRTKEYFMT", "SRTSEQ"].every(attribute => result.stdout.includes(attribute)), true);
      }
    },

    {
      name: `Test runCommand (with error)`, test: async () => {
        const connection = instance.getConnection();

        // One day it'd be cool to test different locales/CCSIDs here
        // const profileMatix = [{ccsid: 277, language: `DAN`, region: `DK`}];
        // for (const setup of profileMatix) {
        // const profileChange = await connection?.runCommand({
        //   command: `CHGUSRPRF USRPRF(${connection.currentUser}) CCSID(${setup.ccsid}) LANGID(${setup.language}) CNTRYID(${setup.region})`,
        //   noLibList: true
        // });

        // console.log(profileChange);
        // assert.strictEqual(profileChange?.code, 0);
        // }

        console.log((await connection?.runCommand({ command: `DSPUSRPRF USRPRF(${connection.currentUser}) OUTPUT(*PRINT)`, noLibList: true }))?.stdout);

        const result = await connection?.runCommand({
          command: `CHKOBJ OBJ(QSYS/NOEXIST) OBJTYPE(*DTAARA)`,
          noLibList: true
        });

        assert.notStrictEqual(result?.code, 0);
        assert.ok(result?.stderr);
      }
    },

    {
      name: `Test runCommand (ILE, custom libl)`, test: async () => {
        const connection = instance.getConnection();
        const config = instance.getConfig();

        const ogLibl = config!.libraryList.slice(0);

        config!.libraryList = [`QTEMP`];

        const resultA = await connection?.runCommand({
          command: `DSPLIBL`,
          environment: `ile`
        });

        config!.libraryList = ogLibl;

        assert.strictEqual(resultA?.code, 0);
        assert.strictEqual(resultA.stdout.includes(`QSYSINC     CUR`), false);
        assert.strictEqual(resultA.stdout.includes(`QSYSINC     USR`), false);

        const resultB = await connection?.runCommand({
          command: `DSPLIBL`,
          environment: `ile`,
          env: {
            '&LIBL': `QSYSINC`,
            '&CURLIB': `QSYSINC`
          }
        });

        assert.strictEqual(resultB?.code, 0);
        assert.strictEqual(resultB.stdout.includes(`QSYSINC     CUR`), true);
        assert.strictEqual(resultB.stdout.includes(`QSYSINC     USR`), true);
      }
    },

    {
      name: `Test runCommand (ILE, libl order from variable)`, test: async () => {
        const connection = instance.getConnection();

        const result = await connection?.runCommand({
          command: `DSPLIBL`,
          environment: `ile`,
          env: {
            '&LIBL': `QTEMP QSYSINC`,
          }
        });

        assert.strictEqual(result?.code, 0);

        const qsysincIndex = result.stdout.indexOf(`QSYSINC     USR`);
        const qtempIndex = result.stdout.indexOf(`QTEMP       USR`);

        // Test that QSYSINC is before QSYS2
        assert.ok(qtempIndex < qsysincIndex);
      }
    },

    {
      name: `Test runCommand (ILE, libl order from config)`, test: async () => {
        const connection = instance.getConnection();
        const config = instance.getConfig();

        const ogLibl = config!.libraryList.slice(0);

        config!.libraryList = [`QTEMP`, `QSYSINC`];

        const result = await connection?.runCommand({
          command: `DSPLIBL`,
          environment: `ile`,
        });

        config!.libraryList = ogLibl;

        assert.strictEqual(result?.code, 0);

        const qsysincIndex = result.stdout.indexOf(`QSYSINC     USR`);
        const qtempIndex = result.stdout.indexOf(`QTEMP       USR`);

        // Test that QSYSINC is before QSYS2
        assert.ok(qtempIndex < qsysincIndex);
      }
    },
    {
      name: `Test withTempDirectory and countFiles`, test: async () => {
        const connection = instance.getConnection()!;
        const content = instance.getContent()!;
        let temp;        

        await connection.withTempDirectory(async tempDir => {
          temp = tempDir;
          //Directory must exist
          assert.strictEqual((await connection.sendCommand({ command: `[ -d ${tempDir} ]` })).code, 0);

          //Directory must be empty
          assert.strictEqual(await content.countFiles(tempDir), 0);

          const toCreate = 10;
          for (let i = 0; i < toCreate; i++) {
            assert.strictEqual((await connection.sendCommand({ command: `echo "Test ${i}" >> ${tempDir}/file${i}` })).code, 0);
          }

          assert.strictEqual(await content.countFiles(tempDir), toCreate);
        });

        if (temp) {
          //Directory must be gone
          assert.strictEqual((await connection.sendCommand({ command: `[ -d ${temp} ]` })).code, 1);
        }
      }
    },
    {
      name: `Test upperCaseName`, test: async () => {
        const connection = instance.getConnection()!;
        const variantsBackup = connection.variantChars.local;

        try {
          const checkVariants = () => connection.variantChars.local !== connection.variantChars.local.toLocaleUpperCase();
          //CCSID 297 variants
          connection.variantChars.local = '£à$';
          connection.dangerousVariants = checkVariants();
          assert.strictEqual(connection.dangerousVariants, true);
          assert.strictEqual(connection.upperCaseName("àTesT£ye$"), "àTEST£YE$");
          assert.strictEqual(connection.upperCaseName("test_cAsE"), "TEST_CASE");

          //CCSID 37 variants
          connection.variantChars.local = '#@$';
          connection.dangerousVariants = checkVariants();
          assert.strictEqual(connection.dangerousVariants, false);
          assert.strictEqual(connection.upperCaseName("@TesT#ye$"), "@TEST#YE$");
          assert.strictEqual(connection.upperCaseName("test_cAsE"), "TEST_CASE");
        }
        finally {
          connection.variantChars.local = variantsBackup;
        }
      }
    }
  ]
};
