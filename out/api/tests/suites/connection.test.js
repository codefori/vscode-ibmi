"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const CompileTools_1 = require("../../CompileTools");
const Tools_1 = require("../../Tools");
const DebugConfiguration_1 = require("../../configuration/DebugConfiguration");
const connection_1 = require("../connection");
(0, vitest_1.describe)(`connection tests`, { concurrent: true }, () => {
    let connection;
    (0, vitest_1.beforeAll)(async () => {
        connection = await (0, connection_1.newConnection)();
    }, connection_1.CONNECTION_TIMEOUT);
    (0, vitest_1.afterAll)(async () => {
        await (0, connection_1.disposeConnection)(connection);
    });
    (0, vitest_1.it)('sendCommand', async () => {
        const result = await connection.sendCommand({
            command: `echo "Hello world"`,
        });
        (0, vitest_1.expect)(result.code).toBe(0);
        (0, vitest_1.expect)(result.stdout).toBe('Hello world');
    });
    (0, vitest_1.it)('sendCommand with home directory', async () => {
        const resultA = await connection.sendCommand({
            command: `pwd`,
            directory: `/QSYS.LIB`
        });
        (0, vitest_1.expect)(resultA.code).toBe(0);
        (0, vitest_1.expect)(resultA.stdout).toBe('/QSYS.LIB');
        const resultB = await connection.sendCommand({
            command: `pwd`,
            directory: `/home`
        });
        (0, vitest_1.expect)(resultB.code).toBe(0);
        (0, vitest_1.expect)(resultB.stdout).toBe('/home');
        const resultC = await connection.sendCommand({
            command: `pwd`,
            directory: `/badnaughty`
        });
        (0, vitest_1.expect)(resultC.code).toBe(0);
        (0, vitest_1.expect)(resultC.stdout).not.toBe('/badnaughty');
    });
    (0, vitest_1.it)('sendCommand with environment variables', async () => {
        const result = await connection.sendCommand({
            command: `echo "$vara $varB $VARC"`,
            env: {
                vara: `Hello`,
                varB: `world`,
                VARC: `cool`
            }
        });
        (0, vitest_1.expect)(result.code).toBe(0);
        (0, vitest_1.expect)(result.stdout).toBe('Hello world cool');
    });
    (0, vitest_1.it)('getTempRemote', () => {
        const fileA = connection.getTempRemote(`/some/file`);
        const fileB = connection.getTempRemote(`/some/badfile`);
        const fileC = connection.getTempRemote(`/some/file`);
        (0, vitest_1.expect)(fileA).toBe(fileC);
        (0, vitest_1.expect)(fileA).not.toBe(fileB);
    });
    (0, vitest_1.it)('parseMemberPath (simple)', () => {
        const memberA = connection.parserMemberPath(`/thelib/thespf/thembr.mbr`);
        (0, vitest_1.expect)(memberA?.asp).toBeUndefined();
        (0, vitest_1.expect)(memberA?.library).toBe(`THELIB`);
        (0, vitest_1.expect)(memberA?.file).toBe(`THESPF`);
        (0, vitest_1.expect)(memberA?.name).toBe(`THEMBR`);
        (0, vitest_1.expect)(memberA?.extension).toBe(`MBR`);
        (0, vitest_1.expect)(memberA?.basename).toBe(`THEMBR.MBR`);
    });
    (0, vitest_1.it)('parseMemberPath (ASP)', () => {
        const memberA = connection.parserMemberPath(`/theasp/thelib/thespf/thembr.mbr`);
        (0, vitest_1.expect)(memberA?.asp).toBe(`THEASP`);
        (0, vitest_1.expect)(memberA?.library).toBe(`THELIB`);
        (0, vitest_1.expect)(memberA?.file).toBe(`THESPF`);
        (0, vitest_1.expect)(memberA?.name).toBe(`THEMBR`);
        (0, vitest_1.expect)(memberA?.extension).toBe(`MBR`);
        (0, vitest_1.expect)(memberA?.basename).toBe(`THEMBR.MBR`);
    });
    (0, vitest_1.it)('parseMemberPath (no root)', () => {
        const memberA = connection.parserMemberPath(`thelib/thespf/thembr.mbr`);
        (0, vitest_1.expect)(memberA?.asp).toBe(undefined);
        (0, vitest_1.expect)(memberA?.library).toBe(`THELIB`);
        (0, vitest_1.expect)(memberA?.file).toBe(`THESPF`);
        (0, vitest_1.expect)(memberA?.name).toBe(`THEMBR`);
        (0, vitest_1.expect)(memberA?.extension).toBe(`MBR`);
        (0, vitest_1.expect)(memberA?.basename).toBe(`THEMBR.MBR`);
    });
    (0, vitest_1.it)('parseMemberPath (no extension)', () => {
        const memberA = connection.parserMemberPath(`/thelib/thespf/thembr`);
        (0, vitest_1.expect)(memberA?.asp).toBe(undefined);
        (0, vitest_1.expect)(memberA?.library).toBe(`THELIB`);
        (0, vitest_1.expect)(memberA?.file).toBe(`THESPF`);
        (0, vitest_1.expect)(memberA?.name).toBe(`THEMBR`);
        (0, vitest_1.expect)(memberA?.extension).toBe("");
        (0, vitest_1.expect)(memberA?.basename).toBe(`THEMBR`);
        (0, vitest_1.expect)(() => { connection.parserMemberPath(`/thelib/thespf/thembr`, true); }).toThrow(`Source Type extension is required.`);
    });
    (0, vitest_1.it)('parseMemberPath (invalid length)', () => {
        (0, vitest_1.expect)(() => { connection.parserMemberPath(`/thespf/thembr.mbr`); }).toThrow(`Invalid path: /thespf/thembr.mbr. Use format LIB/SPF/NAME.ext`);
    });
    (0, vitest_1.it)('runCommand (ILE)', async () => {
        const result = await connection.runCommand({
            command: `DSPJOB OPTION(*DFNA)`,
            environment: `ile`
        });
        (0, vitest_1.expect)(result?.code).toBe(0);
        (0, vitest_1.expect)(["JOBPTY", "OUTPTY", "ENDSEV", "DDMCNV", "BRKMSG", "STSMSG", "DEVRCYACN", "TSEPOOL", "PRTKEYFMT", "SRTSEQ"].every(attribute => result.stdout.includes(attribute))).toBe(true);
    });
    (0, vitest_1.it)('runCommand (ILE, with error)', async () => {
        const result = await connection.runCommand({
            command: `CHKOBJ OBJ(QSYS/NOEXIST) OBJTYPE(*DTAARA)`,
            noLibList: true
        });
        (0, vitest_1.expect)(result?.code).not.toBe(0);
        (0, vitest_1.expect)(result?.stderr).toBeTruthy();
    });
    (0, vitest_1.it)('runCommand (ILE, custom library list)', async () => {
        const config = connection.getConfig();
        const ogLibl = config.libraryList.slice(0);
        config.libraryList = [`QTEMP`];
        const resultA = await connection?.runCommand({
            command: `DSPLIBL`,
            environment: `ile`
        });
        config.libraryList = ogLibl;
        (0, vitest_1.expect)(resultA?.code).toBe(0);
        (0, vitest_1.expect)(resultA.stdout.includes(`QSYSINC     CUR`)).toBe(false);
        (0, vitest_1.expect)(resultA.stdout.includes(`QSYSINC     USR`)).toBe(false);
        const resultB = await connection?.runCommand({
            command: `DSPLIBL`,
            environment: `ile`,
            env: {
                '&LIBL': `QSYSINC`,
                '&CURLIB': `QSYSINC`
            }
        });
        (0, vitest_1.expect)(resultB?.code).toBe(0);
        (0, vitest_1.expect)(resultB.stdout.includes(`QSYSINC     CUR`)).toBe(true);
        (0, vitest_1.expect)(resultB.stdout.includes(`QSYSINC     USR`)).toBe(true);
    });
    (0, vitest_1.it)('runCommand (ILE, library list order from variable)', async () => {
        const result = await connection?.runCommand({
            command: `DSPLIBL`,
            environment: `ile`,
            env: {
                '&LIBL': `QTEMP QSYSINC`,
            }
        });
        (0, vitest_1.expect)(result?.code).toBe(0);
        const qsysincIndex = result.stdout.indexOf(`QSYSINC     USR`);
        const qtempIndex = result.stdout.indexOf(`QTEMP       USR`);
        // Test that QSYSINC is before QSYS2
        (0, vitest_1.expect)(qtempIndex < qsysincIndex).toBeTruthy();
    });
    (0, vitest_1.it)('runCommand (ILE, library order from config)', async () => {
        const config = connection.getConfig();
        const ogLibl = config.libraryList.slice(0);
        config.libraryList = [`QTEMP`, `QSYSINC`];
        const result = await connection?.runCommand({
            command: `DSPLIBL`,
            environment: `ile`,
        });
        config.libraryList = ogLibl;
        (0, vitest_1.expect)(result?.code).toBe(0);
        const qsysincIndex = result.stdout.indexOf(`QSYSINC     USR`);
        const qtempIndex = result.stdout.indexOf(`QTEMP       USR`);
        // Test that QSYSINC is before QSYS2
        (0, vitest_1.expect)(qtempIndex < qsysincIndex).toBeTruthy();
    });
    (0, vitest_1.it)('runCommand (ILE, variable expansion)', async () => {
        const config = connection.getConfig();
        const result = await CompileTools_1.CompileTools.runCommand(connection, {
            command: `CRTDTAARA DTAARA(&SCOOBY/TEST) TYPE(*CHAR) LEN(10)`,
            environment: `ile`,
            env: { '&SCOOBY': `QTEMP` },
        }, {
            commandConfirm: async (command) => {
                (0, vitest_1.expect)(command).toBe(`CRTDTAARA DTAARA(QTEMP/TEST) TYPE(*CHAR) LEN(10)`);
                return command;
            }
        });
        (0, vitest_1.expect)(result?.code).toBe(0);
    });
    (0, vitest_1.it)('withTempDirectory and countFiles', async () => {
        const content = connection.getContent();
        let temp;
        await connection.withTempDirectory(async (tempDir) => {
            temp = tempDir;
            // Directory must exist
            (0, vitest_1.expect)((await connection.sendCommand({ command: `[ -d ${tempDir} ]` })).code).toBe(0);
            // Directory must be empty
            (0, vitest_1.expect)(await content.countFiles(tempDir)).toBe(0);
            const toCreate = 10;
            for (let i = 0; i < toCreate; i++) {
                (0, vitest_1.expect)((await connection.sendCommand({ command: `echo "Test ${i}" >> ${tempDir}/file${i}` })).code).toBe(0);
            }
            (0, vitest_1.expect)(await content.countFiles(tempDir)).toBe(toCreate);
            // Directory does not exist
            (0, vitest_1.expect)(await content.countFiles(`${tempDir}/${Tools_1.Tools.makeid(20)}`)).toBe(0);
        });
        if (temp) {
            // Directory must be gone
            (0, vitest_1.expect)((await connection.sendCommand({ command: `[ -d ${temp} ]` })).code).toBe(1);
        }
    });
    (0, vitest_1.it)('upperCaseName', () => {
        {
            const variantsBackup = connection.variantChars.local;
            try {
                //CCSID 297 variants
                connection.variantChars.local = '£à$';
                (0, vitest_1.expect)(connection.dangerousVariants).toBe(true);
                (0, vitest_1.expect)(connection.upperCaseName("àTesT£ye$")).toBe("àTEST£YE$");
                (0, vitest_1.expect)(connection.upperCaseName("test_cAsE")).toBe("TEST_CASE");
                //CCSID 37 variants
                connection.variantChars.local = '#@$';
                (0, vitest_1.expect)(connection.dangerousVariants).toBe(false);
                (0, vitest_1.expect)(connection.upperCaseName("@TesT#ye$")).toBe("@TEST#YE$");
                (0, vitest_1.expect)(connection.upperCaseName("test_cAsE")).toBe("TEST_CASE");
            }
            finally {
                connection.variantChars.local = variantsBackup;
            }
        }
    });
    (0, vitest_1.it)('Check Java versions', async () => {
        if (connection.remoteFeatures.jdk80) {
            const jdk8 = (0, DebugConfiguration_1.getJavaHome)(connection, '8');
            (0, vitest_1.expect)(jdk8).toBe(connection.remoteFeatures.jdk80);
        }
        if (connection.remoteFeatures.jdk11) {
            const jdk11 = (0, DebugConfiguration_1.getJavaHome)(connection, '11');
            (0, vitest_1.expect)(jdk11).toBe(connection.remoteFeatures.jdk11);
        }
        if (connection.remoteFeatures.jdk17) {
            const jdk17 = (0, DebugConfiguration_1.getJavaHome)(connection, '17');
            (0, vitest_1.expect)(jdk17).toBe(connection.remoteFeatures.jdk17);
        }
        (0, vitest_1.expect)((0, DebugConfiguration_1.getJavaHome)(connection, '666')).toBeUndefined();
    });
    (0, vitest_1.it)('getLibraryIAsp against QSYSINC', async () => {
        const library = `QSYSINC`;
        const asp = await connection.lookupLibraryIAsp(library);
        (0, vitest_1.expect)(asp).toBeUndefined(); // Because QSYSINC is not an iASP
    });
});
//# sourceMappingURL=connection.test.js.map