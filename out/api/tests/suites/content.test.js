"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const path_1 = require("path");
const tmp_1 = __importDefault(require("tmp"));
const util_1 = __importDefault(require("util"));
const vitest_1 = require("vitest");
const Tools_1 = require("../../Tools");
const connection_1 = require("../connection");
(0, vitest_1.describe)('Content Tests', { concurrent: true }, () => {
    let connection;
    (0, vitest_1.beforeAll)(async () => {
        connection = await (0, connection_1.newConnection)();
    }, connection_1.CONNECTION_TIMEOUT);
    (0, vitest_1.afterAll)(async () => {
        await (0, connection_1.disposeConnection)(connection);
    });
    (0, vitest_1.it)('memberResolve', async () => {
        const content = connection.getContent();
        const member = await content?.memberResolve('MATH', [
            { library: 'QSYSINC', name: 'MIH' },
            { library: 'QSYSINC', name: 'H' } // Does exist
        ]);
        (0, vitest_1.expect)(member).toEqual({
            asp: undefined,
            library: 'QSYSINC',
            file: 'H',
            name: 'MATH',
            extension: 'MBR',
            basename: 'MATH.MBR'
        });
    });
    (0, vitest_1.it)('memberResolve (with invalid ASP)', async () => {
        const content = connection.getContent();
        const member = await content?.memberResolve('MATH', [
            { library: 'QSYSINC', name: 'MIH' },
            { library: 'QSYSINC', name: 'H', asp: 'myasp' } // Does exist, but not in the ASP
        ]);
        (0, vitest_1.expect)(member).toEqual({
            asp: undefined,
            library: 'QSYSINC',
            file: 'H',
            name: 'MATH',
            extension: 'MBR',
            basename: 'MATH.MBR'
        });
    });
    (0, vitest_1.it)('memberResolve with variants', async () => {
        const content = connection.getContent();
        const config = connection.getConfig();
        const tempLib = config.tempLibrary, tempSPF = `O_ABC`.concat(connection.variantChars.local), tempMbr = `O_ABC`.concat(connection.variantChars.local);
        const result = await connection.runCommand({
            command: `CRTSRCPF ${tempLib}/${tempSPF} MBR(${tempMbr})`,
            environment: 'ile'
        });
        const member = await content?.memberResolve(tempMbr, [
            { library: 'QSYSINC', name: 'MIH' },
            { library: 'NOEXIST', name: 'SUP' },
            { library: tempLib, name: tempSPF } // Does exist here
        ]);
        (0, vitest_1.expect)(member).toEqual({
            asp: undefined,
            library: tempLib,
            file: tempSPF,
            name: tempMbr,
            extension: 'MBR',
            basename: `${tempMbr}.MBR`
        });
        // Cleanup...
        await connection.runCommand({
            command: `DLTF ${tempLib}/${tempSPF}`,
            environment: 'ile'
        });
    });
    (0, vitest_1.it)('memberResolve with bad name', async () => {
        const content = connection.getContent();
        const member = await content?.memberResolve('BOOOP', [
            { library: 'QSYSINC', name: 'MIH' },
            { library: 'NOEXIST', name: 'SUP' },
            { library: 'QSYSINC', name: 'H' } // Doesn't exist here
        ]);
        (0, vitest_1.expect)(member).toBeUndefined();
    });
    (0, vitest_1.it)('objectResolve .FILE', async () => {
        const content = connection.getContent();
        const lib = await content?.objectResolve('MIH', [
            'QSYS2',
            'QSYSINC' // Does exist
        ]);
        (0, vitest_1.expect)(lib).toBe('QSYSINC');
    });
    (0, vitest_1.it)('objectResolve .PGM', async () => {
        const content = connection.getContent();
        const lib = await content?.objectResolve('CMRCV', [
            'QSYSINC',
            'QSYS2' // Does exist
        ]);
        (0, vitest_1.expect)(lib).toBe('QSYS2');
    });
    (0, vitest_1.it)('objectResolve .DTAARA with variants', async () => {
        const content = connection.getContent();
        const config = connection.getConfig();
        const tempLib = config.tempLibrary, tempObj = `O_ABC`.concat(connection.variantChars.local);
        await connection.runCommand({
            command: `CRTDTAARA ${tempLib}/${tempObj} TYPE(*CHAR)`,
            environment: 'ile'
        });
        const lib = await content?.objectResolve(tempObj, [
            'QSYSINC',
            'QSYS2',
            tempLib // Does exist here
        ]);
        (0, vitest_1.expect)(lib).toBe(tempLib);
        // Cleanup...
        await connection.runCommand({
            command: `DLTDTAARA ${tempLib}/${tempObj}`,
            environment: 'ile'
        });
    });
    (0, vitest_1.it)('objectResolve with bad name', async () => {
        const content = connection.getContent();
        const lib = await content?.objectResolve('BOOOP', [
            'BADLIB',
            'QSYS2',
            'QSYSINC', // Doesn't exist here
        ]);
        (0, vitest_1.expect)(lib).toBeUndefined();
    });
    (0, vitest_1.it)('streamfileResolve', async () => {
        const content = connection.getContent();
        const streamfilePath = await content?.streamfileResolve(['git'], ['/QOpenSys/pkgs/sbin', '/QOpenSys/pkgs/bin']);
        (0, vitest_1.expect)(streamfilePath).toBe('/QOpenSys/pkgs/bin/git');
    });
    (0, vitest_1.it)('streamfileResolve with bad name', async () => {
        const content = connection.getContent();
        const streamfilePath = await content?.streamfileResolve(['sup'], ['/QOpenSys/pkgs/sbin', '/QOpenSys/pkgs/bin']);
        (0, vitest_1.expect)(streamfilePath).toBeUndefined();
    });
    (0, vitest_1.it)('streamfileResolve with multiple names', async () => {
        const content = connection.getContent();
        const streamfilePath = await content?.streamfileResolve(['sup', 'sup2', 'git'], ['/QOpenSys/pkgs/sbin', '/QOpenSys/pkgs/bin']);
        (0, vitest_1.expect)(streamfilePath).toBe('/QOpenSys/pkgs/bin/git');
    });
    (0, vitest_1.it)('streamfileResolve with blanks in names', async () => {
        const content = connection.getContent();
        const files = ['normalname', 'name with blank', 'name_with_quote\'', 'name_with_dollar$'];
        const dir = `/tmp/${Date.now()}`;
        const dirWithSubdir = `${dir}/${files[0]}`;
        let result;
        result = await connection?.sendCommand({ command: `mkdir -p "${dir}"` });
        (0, vitest_1.expect)(result?.code).toBe(0);
        try {
            for (const file of files) {
                result = await connection?.sendCommand({ command: `touch "${dir}/${file}"` });
                (0, vitest_1.expect)(result?.code).toBe(0);
            }
            ;
            for (const file of files) {
                let result = await content?.streamfileResolve([`${Date.now()}`, file], [`${Date.now()}`, dir]);
                (0, vitest_1.expect)(result).toBe(`${dir}/${file}`);
            }
        }
        finally {
            result = await connection?.sendCommand({ command: `rm -r "${dir}"` });
            (0, vitest_1.expect)(result?.code).toBe(0);
        }
    });
    (0, vitest_1.it)('Test downloadMemberContent', async () => {
        const content = connection.getContent();
        const tmpFile = await util_1.default.promisify(tmp_1.default.file)();
        const memberContent = await content?.downloadMemberContent('QSYSINC', 'H', 'MATH', tmpFile);
        (0, vitest_1.expect)(memberContent).toBeTruthy();
    });
    (0, vitest_1.it)('Test runSQL (basic select)', async () => {
        const rows = await connection.runSQL('select * from qiws.qcustcdt');
        (0, vitest_1.expect)(rows?.length).not.toBe(0);
        const firstRow = rows[0];
        (0, vitest_1.expect)(typeof firstRow['BALDUE']).toBe('number');
        (0, vitest_1.expect)(typeof firstRow['CITY']).toBe('string');
    });
    (0, vitest_1.it)('Test runSQL (bad basic select)', async () => {
        try {
            await connection.runSQL('select from qiws.qcustcdt');
            vitest_1.expect.fail('Should have thrown an error');
        }
        catch (e) {
            (0, vitest_1.expect)(e.message.endsWith(': , FROM INTO. (42601)')).toBeTruthy();
            (0, vitest_1.expect)(e.sqlstate).toBe('42601');
        }
    });
    (0, vitest_1.it)('Test runSQL (with comments)', async () => {
        const rows = await connection.runSQL([
            '-- myselect',
            'select *',
            'from qiws.qcustcdt --my table',
            'limit 1',
        ].join('\n'));
        (0, vitest_1.expect)(rows?.length).toBe(1);
    });
    (0, vitest_1.it)('Test getTable', async () => {
        const content = connection.getContent();
        const rows = await content.getTable('qiws', 'qcustcdt', '*all');
        (0, vitest_1.expect)(rows?.length).not.toBe(0);
        const firstRow = rows[0];
        (0, vitest_1.expect)(typeof firstRow['BALDUE']).toBe('number');
        (0, vitest_1.expect)(typeof firstRow['CITY']).toBe('string');
    });
    (0, vitest_1.it)('Test validateLibraryList', async () => {
        const content = connection.getContent();
        const badLibs = await content.validateLibraryList(['SCOOBY', 'QSYSINC', 'BEEPBOOP']);
        (0, vitest_1.expect)(badLibs?.includes('BEEPBOOP')).toBe(true);
        (0, vitest_1.expect)(badLibs?.includes('QSYSINC')).toBe(false);
        (0, vitest_1.expect)(badLibs?.includes('SCOOBY')).toBe(true);
    });
    (0, vitest_1.it)('Test getFileList', async () => {
        const content = connection.getContent();
        const objects = await content?.getFileList('/');
        const qsysLib = objects?.find(obj => obj.name === 'QSYS.LIB');
        (0, vitest_1.expect)(qsysLib?.name).toBe('QSYS.LIB');
        (0, vitest_1.expect)(qsysLib?.path).toBe('/QSYS.LIB');
        (0, vitest_1.expect)(qsysLib?.type).toBe('directory');
        (0, vitest_1.expect)(qsysLib?.owner).toBe('qsys');
    });
    (0, vitest_1.it)('Test getFileList (non-existing file)', async () => {
        const content = connection.getContent();
        const objects = await content?.getFileList(`/tmp/${Date.now()}`);
        (0, vitest_1.expect)(objects?.length).toBe(0);
    });
    (0, vitest_1.it)('Test getFileList (special chars)', async () => {
        const content = connection.getContent();
        const files = ['name with blank', 'name_with_quote\'', 'name_with_dollar$'];
        const dir = `/tmp/${Date.now()}`;
        const dirWithSubdir = `${dir}/${files[0]}`;
        let result;
        result = await connection?.sendCommand({ command: `mkdir -p "${dirWithSubdir}"` });
        (0, vitest_1.expect)(result?.code).toBe(0);
        try {
            for (const file of files) {
                result = await connection?.sendCommand({ command: `touch "${dirWithSubdir}/${file}"` });
                (0, vitest_1.expect)(result?.code).toBe(0);
            }
            ;
            const objects = await content?.getFileList(`${dirWithSubdir}`);
            (0, vitest_1.expect)(objects?.length).toBe(files.length);
            (0, vitest_1.expect)(objects?.map(a => a.name).sort()).toEqual(files.sort());
        }
        finally {
            result = await connection?.sendCommand({ command: `rm -r "${dir}"` });
            (0, vitest_1.expect)(result?.code).toBe(0);
        }
    });
    (0, vitest_1.it)('Test getObjectList (all objects)', async () => {
        const content = connection.getContent();
        const objects = await content?.getObjectList({ library: 'QSYSINC' });
        (0, vitest_1.expect)(objects?.length).not.toBe(0);
    });
    (0, vitest_1.it)('Test getObjectList (pgm filter)', async () => {
        const content = connection.getContent();
        const objects = await content?.getObjectList({ library: 'QSYSINC', types: ['*PGM'] });
        (0, vitest_1.expect)(objects?.length).not.toBe(0);
        const containsNonPgms = objects?.some(obj => obj.type !== '*PGM');
        (0, vitest_1.expect)(containsNonPgms).toBe(false);
    });
    (0, vitest_1.it)('Test getObjectList (source files only)', async () => {
        const content = connection.getContent();
        const objects = await content?.getObjectList({ library: 'QSYSINC', types: ['*SRCPF'] });
        (0, vitest_1.expect)(objects?.length).not.toBe(0);
        const containsNonFiles = objects?.some(obj => obj.type !== '*FILE');
        (0, vitest_1.expect)(containsNonFiles).toBe(false);
    });
    (0, vitest_1.it)('Test getObjectList (single source file only, detailed)', async () => {
        const content = connection.getContent();
        const objectsA = await content?.getObjectList({ library: 'QSYSINC', types: ['*SRCPF'], object: 'MIH' });
        (0, vitest_1.expect)(objectsA?.length).toBe(1);
    });
    (0, vitest_1.it)('Test getObjectList (source files only, named filter)', async () => {
        const content = connection.getContent();
        const objects = await content?.getObjectList({ library: 'QSYSINC', types: ['*SRCPF'], object: 'MIH' });
        (0, vitest_1.expect)(objects?.length).toBe(1);
        (0, vitest_1.expect)(objects[0].type).toBe('*FILE');
        (0, vitest_1.expect)(objects[0].text).toBe('DATA BASE FILE FOR C INCLUDES FOR MI');
    });
    (0, vitest_1.it)('getLibraries (simple filters)', async () => {
        const content = connection.getContent();
        const qsysLibraries = await content?.getLibraries({ library: 'QSYS*' });
        (0, vitest_1.expect)(qsysLibraries?.length).not.toBe(0);
        (0, vitest_1.expect)(qsysLibraries?.every(l => l.name.startsWith('QSYS'))).toBe(true);
        const includeSYSLibraries = await content?.getLibraries({ library: '*SYS*' });
        (0, vitest_1.expect)(includeSYSLibraries?.length).not.toBe(0);
        (0, vitest_1.expect)(includeSYSLibraries?.every(l => l.name.includes('SYS'))).toBe(true);
        const libraries = ['QSYSINC', 'QGPL', 'QTEMP'];
        const multipleLibraries = await content?.getLibraries({ library: libraries.join(',') });
        (0, vitest_1.expect)(multipleLibraries?.length).toBe(libraries.length);
        (0, vitest_1.expect)(libraries.every(l => multipleLibraries.some(o => o.name === l))).toBe(true);
    });
    (0, vitest_1.it)('getLibraries (regexp filters)', async () => {
        const content = connection.getContent();
        const qsysLibraries = await content?.getLibraries({ library: '^.*SYS[^0-9]*$', filterType: 'regex' });
        (0, vitest_1.expect)(qsysLibraries?.length).not.toBe(0);
        (0, vitest_1.expect)(qsysLibraries?.every(l => /^.*SYS[^0-9]*$/.test(l.name))).toBe(true);
    });
    (0, vitest_1.it)('getObjectList (advanced filtering)', async () => {
        const content = connection.getContent();
        const objects = await content?.getObjectList({ library: 'QSYSINC', object: 'L*OU*' });
        (0, vitest_1.expect)(objects?.length).not.toBe(0);
        (0, vitest_1.expect)(objects?.map(o => o.name).every(n => n.startsWith('L') && n.includes('OU'))).toBe(true);
    });
    (0, vitest_1.it)('getMemberList (SQL, no filter)', async () => {
        const content = connection.getContent();
        let members = await content?.getMemberList({ library: 'qsysinc', sourceFile: 'mih', members: '*inxen' });
        (0, vitest_1.expect)(members?.length).toBe(3);
        members = await content?.getMemberList({ library: 'qsysinc', sourceFile: 'mih' });
        const actbpgm = members?.find(mbr => mbr.name === 'ACTBPGM');
        (0, vitest_1.expect)(actbpgm?.name).toBe('ACTBPGM');
        (0, vitest_1.expect)(actbpgm?.extension).toBe('C');
        (0, vitest_1.expect)(actbpgm?.text).toBe('ACTIVATE BOUND PROGRAM');
        (0, vitest_1.expect)(actbpgm?.library).toBe('QSYSINC');
        (0, vitest_1.expect)(actbpgm?.file).toBe('MIH');
    });
    (0, vitest_1.it)('getMemberList (advanced filtering)', async () => {
        const content = connection.getContent();
        const members = await content?.getMemberList({ library: 'QSYSINC', sourceFile: 'QRPGLESRC', members: 'SYS*,I*,*EX' });
        (0, vitest_1.expect)(members?.length).not.toBe(0);
        (0, vitest_1.expect)(members.map(m => m.name).every(n => n.startsWith('SYS') || n.startsWith('I') || n.endsWith('EX'))).toBe(true);
        const membersRegex = await content?.getMemberList({ library: 'QSYSINC', sourceFile: 'QRPGLESRC', members: '^QSY(?!RTV).*$', filterType: 'regex' });
        (0, vitest_1.expect)(membersRegex?.length).not.toBe(0);
        (0, vitest_1.expect)(membersRegex.map(m => m.name).every(n => n.startsWith('QSY') && !n.includes('RTV'))).toBe(true);
    });
    (0, vitest_1.it)('getQtempTable', async () => {
        const content = connection.getContent();
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
        (0, vitest_1.expect)(objects?.length).not.toBe(0);
        (0, vitest_1.expect)(objects?.every(obj => obj.library === "QSYSINC")).toBe(true);
        const qrpglesrc = objects?.find(obj => obj.name === "QRPGLESRC");
        (0, vitest_1.expect)(qrpglesrc).toBeDefined();
        (0, vitest_1.expect)(qrpglesrc?.attribute).toBe("PF");
        (0, vitest_1.expect)(qrpglesrc?.type).toBe("*FILE");
    });
    (0, vitest_1.it)('toCl', () => {
        const command = connection.getContent().toCl("TEST", {
            ZERO: 0,
            NONE: '*NONE',
            EMPTY: `''`,
            OBJNAME: `OBJECT`,
            OBJCHAR: `ObJect`,
            IFSPATH: `/hello/world`
        });
        (0, vitest_1.expect)(command).toBe("TEST ZERO(0) NONE(*NONE) EMPTY('') OBJNAME(OBJECT) OBJCHAR('ObJect') IFSPATH('/hello/world')");
    });
    (0, vitest_1.it)('Check object (no exist)', async () => {
        const content = connection.getContent();
        const exists = await content?.checkObject({ library: 'QSYSINC', name: 'BOOOP', type: '*FILE' });
        (0, vitest_1.expect)(exists).toBe(false);
    });
    (0, vitest_1.it)('Check object (source member)', async () => {
        const content = connection.getContent();
        const exists = await content?.checkObject({ library: 'QSYSINC', name: 'H', type: '*FILE', member: 'MATH' });
        (0, vitest_1.expect)(exists).toBeTruthy();
    });
    (0, vitest_1.it)('Check getMemberInfo', async () => {
        const content = connection.getContent();
        const memberInfoA = await content?.getMemberInfo('QSYSINC', 'H', 'MATH');
        (0, vitest_1.expect)(memberInfoA).toBeTruthy();
        (0, vitest_1.expect)(memberInfoA?.library).toBe('QSYSINC');
        (0, vitest_1.expect)(memberInfoA?.file).toBe('H');
        (0, vitest_1.expect)(memberInfoA?.name).toBe('MATH');
        (0, vitest_1.expect)(memberInfoA?.extension).toBe('C');
        (0, vitest_1.expect)(memberInfoA?.text).toBe('STANDARD HEADER FILE MATH');
        const memberInfoB = await content?.getMemberInfo('QSYSINC', 'H', 'MEMORY');
        (0, vitest_1.expect)(memberInfoB).toBeTruthy();
        (0, vitest_1.expect)(memberInfoB?.library).toBe('QSYSINC');
        (0, vitest_1.expect)(memberInfoB?.file).toBe('H');
        (0, vitest_1.expect)(memberInfoB?.name).toBe('MEMORY');
        (0, vitest_1.expect)(memberInfoB?.extension).toBe('CPP');
        (0, vitest_1.expect)(memberInfoB?.text).toBe('C++ HEADER');
        try {
            await content?.getMemberInfo('QSYSINC', 'H', 'OH_NONO');
        }
        catch (error) {
            (0, vitest_1.expect)(error).toBeInstanceOf(Tools_1.Tools.SqlError);
            (0, vitest_1.expect)(error.sqlstate).toBe('38501');
        }
    });
    (0, vitest_1.it)('Test @clCommand + select statement', async () => {
        const content = connection.getContent();
        const [resultA] = await connection.runSQL(`@CRTSAVF FILE(QTEMP/UNITTEST) TEXT('Code for i test');\nSelect * From Table(QSYS2.OBJECT_STATISTICS('QTEMP', '*FILE')) Where OBJATTRIBUTE = 'SAVF';`);
        (0, vitest_1.expect)(resultA.OBJNAME).toBe('UNITTEST');
        (0, vitest_1.expect)(resultA.OBJTEXT).toBe('Code for i test');
        const [resultB] = await content.runStatements(`@CRTSAVF FILE(QTEMP/UNITTEST) TEXT('Code for i test')`, `Select * From Table(QSYS2.OBJECT_STATISTICS('QTEMP', '*FILE')) Where OBJATTRIBUTE = 'SAVF'`);
        (0, vitest_1.expect)(resultB.OBJNAME).toBe('UNITTEST');
        (0, vitest_1.expect)(resultB.OBJTEXT).toBe('Code for i test');
    });
    (0, vitest_1.it)('should get attributes', async () => {
        const content = connection.getContent();
        await connection.withTempDirectory(async (directory) => {
            (0, vitest_1.expect)((await connection.sendCommand({ command: 'echo "I am a test file" > test.txt', directory })).code).toBe(0);
            const fileAttributes = await content.getAttributes(path_1.posix.join(directory, 'test.txt'), 'DATA_SIZE', 'OBJTYPE');
            (0, vitest_1.expect)(fileAttributes).toBeTruthy();
            (0, vitest_1.expect)(fileAttributes.OBJTYPE).toBe('*STMF');
            (0, vitest_1.expect)(fileAttributes.DATA_SIZE).toBe('17');
            const directoryAttributes = await content.getAttributes(directory, 'DATA_SIZE', 'OBJTYPE');
            (0, vitest_1.expect)(directoryAttributes).toBeTruthy();
            (0, vitest_1.expect)(directoryAttributes.OBJTYPE).toBe('*DIR');
            (0, vitest_1.expect)(directoryAttributes.DATA_SIZE).toBe('8192');
        });
        const qsysLibraryAttributes = await content.getAttributes('/QSYS.LIB/QSYSINC.LIB', 'ASP', 'OBJTYPE');
        (0, vitest_1.expect)(qsysLibraryAttributes).toBeTruthy();
        (0, vitest_1.expect)(qsysLibraryAttributes.OBJTYPE).toBe('*LIB');
        (0, vitest_1.expect)(qsysLibraryAttributes.ASP).toBe('1');
        const qsysFileAttributes = await content.getAttributes({ library: "QSYSINC", name: "H" }, 'ASP', 'OBJTYPE');
        (0, vitest_1.expect)(qsysFileAttributes).toBeTruthy();
        (0, vitest_1.expect)(qsysFileAttributes.OBJTYPE).toBe('*FILE');
        (0, vitest_1.expect)(qsysFileAttributes.ASP).toBe('1');
        const qsysMemberAttributes = await content.getAttributes({ library: "QSYSINC", name: "H", member: "MATH" }, 'ASP', 'OBJTYPE');
        (0, vitest_1.expect)(qsysMemberAttributes).toBeTruthy();
        (0, vitest_1.expect)(qsysMemberAttributes.OBJTYPE).toBe('*MBR');
        (0, vitest_1.expect)(qsysMemberAttributes.ASP).toBe('1');
    });
    (0, vitest_1.it)('should count members', async () => {
        const content = connection.getContent();
        const tempLib = connection.getConfig().tempLibrary;
        if (tempLib) {
            const file = Tools_1.Tools.makeid(8);
            const deleteSPF = async () => await connection.runCommand({ command: `DLTF FILE(${tempLib}/${file})`, noLibList: true });
            await deleteSPF();
            const createSPF = await connection.runCommand({ command: `CRTSRCPF FILE(${tempLib}/${file}) RCDLEN(112)`, noLibList: true });
            if (createSPF.code === 0) {
                try {
                    const expectedCount = Math.floor(Math.random() * (10 - 5 + 1)) + 5;
                    for (let i = 0; i < expectedCount; i++) {
                        const createMember = await connection.runCommand({ command: `ADDPFM FILE(${tempLib}/${file}) MBR(MEMBER${i}) SRCTYPE(TXT)` });
                        if (createMember.code) {
                            throw new Error(`Failed to create member ${tempLib}/${file},MEMBER${i}: ${createMember.stderr}`);
                        }
                    }
                    const count = await content.countMembers({ library: tempLib, name: file });
                    (0, vitest_1.expect)(count).toBe(expectedCount);
                }
                finally {
                    await deleteSPF();
                }
            }
            else {
                throw new Error(`Failed to create source physical file ${tempLib}/${file}: ${createSPF.stderr}`);
            }
        }
        else {
            throw new Error("No temporary library defined in configuration");
        }
    });
    (0, vitest_1.it)('should create streamfile', async () => {
        const content = connection.getContent();
        await connection.withTempDirectory(async (dir) => {
            const file = path_1.posix.join(dir, Tools_1.Tools.makeid());
            const fileExists = async () => content.testStreamFile(file, "f");
            (0, vitest_1.expect)(await fileExists()).toBe(false);
            await content.createStreamFile(file);
            (0, vitest_1.expect)(await fileExists()).toBe(true);
            const attributes = await content.getAttributes(file, "CCSID");
            (0, vitest_1.expect)(attributes).toBeTruthy();
            (0, vitest_1.expect)(attributes.CCSID).toBe("1208");
        });
    });
    (0, vitest_1.it)('should handle long library name', async () => {
        const content = connection.getContent();
        const longName = Tools_1.Tools.makeid(18);
        const shortName = Tools_1.Tools.makeid(8);
        const createLib = await connection.runCommand({ command: `RUNSQL 'create schema "${longName}" for ${shortName}' commit(*none)`, noLibList: true });
        if (createLib.code === 0) {
            try {
                const asp = await connection.lookupLibraryIAsp(shortName);
                await connection.runCommand({ command: `CRTSRCPF FILE(${shortName}/SFILE) MBR(MBR) TEXT('Test long library name')` });
                const libraries = await content.getLibraries({ library: `${shortName}` });
                (0, vitest_1.expect)(libraries?.length).toBe(1);
                const objects = await content.getObjectList({ library: `${shortName}`, types: [`*SRCPF`], object: `SFILE` });
                (0, vitest_1.expect)(objects?.length).toBe(1);
                (0, vitest_1.expect)(objects[0].type).toBe(`*FILE`);
                (0, vitest_1.expect)(objects[0].text).toBe(`Test long library name`);
                const memberCount = await content.countMembers({ library: `${shortName}`, name: `SFILE`, asp });
                (0, vitest_1.expect)(memberCount).toBe(1);
                const members = await content.getMemberList({ library: `${shortName}`, sourceFile: `SFILE` });
                (0, vitest_1.expect)(members?.length).toBe(1);
            }
            finally {
                await connection.runCommand({ command: `RUNSQL 'drop schema "${longName}"' commit(*none)`, noLibList: true });
            }
        }
        else {
            throw new Error(`Failed to create schema "${longName}"`);
        }
    });
    (0, vitest_1.it)('getModuleExport', async () => {
        const content = connection.getContent();
        const config = connection.getConfig();
        const tempLib = config.tempLibrary;
        const id = `${Tools_1.Tools.makeid().toUpperCase()}`;
        await connection.withTempDirectory(async (directory) => {
            const source = `${directory}/vscodetemp-${id}.clle`;
            console.log(source);
            try {
                await content.runStatements(`CALL QSYS2.IFS_WRITE(PATH_NAME =>'${source}', 
                           LINE => 'PGM', 
                           OVERWRITE => 'NONE', 
                           END_OF_LINE => 'CRLF')`, `CALL QSYS2.IFS_WRITE(PATH_NAME =>'${source}', 
                           LINE => 'ENDPGM', 
                           OVERWRITE => 'APPEND', 
                           END_OF_LINE => 'CRLF')`, `@CRTCLMOD MODULE(${tempLib}/${id}) SRCSTMF('${source}')`, `select 1 from sysibm.sysdummy1`);
                let exports = await content.getModuleExports(tempLib, id);
                (0, vitest_1.expect)(exports.length).toBe(1);
                (0, vitest_1.expect)(exports.at(0)?.symbolName).toBe(id);
            }
            finally {
                await connection.runCommand({
                    command: `DLTMOD MODULE(${tempLib}/${id})`,
                    environment: 'ile'
                });
            }
        });
    });
    (0, vitest_1.it)('getProgramExportImportInfo', async () => {
        const content = connection.getContent();
        const config = connection.getConfig();
        const tempLib = config.tempLibrary;
        const id = `${Tools_1.Tools.makeid().toUpperCase()}`;
        await connection.withTempDirectory(async (directory) => {
            const source = `${directory}/vscodetemp-${id}.clle`;
            try {
                await content.runStatements(`CALL QSYS2.IFS_WRITE(PATH_NAME =>'${source}', 
                           LINE => 'PGM', 
                           OVERWRITE => 'NONE', 
                           END_OF_LINE => 'CRLF')`, `CALL QSYS2.IFS_WRITE(PATH_NAME =>'${source}', 
                           LINE => 'ENDPGM', 
                           OVERWRITE => 'APPEND', 
                           END_OF_LINE => 'CRLF')`, `@CRTCLMOD MODULE(${tempLib}/${id}) SRCSTMF('${source}')`, `@CRTSRVPGM SRVPGM(${tempLib}/${id}) MODULE(${tempLib}/${id}) EXPORT(*ALL)`, `select 1 from sysibm.sysdummy1`);
                const info = (await content.getProgramExportImportInfo(tempLib, id, '*SRVPGM'))
                    .filter(info => info.symbolUsage === '*PROCEXP');
                (0, vitest_1.expect)(info.length).toBe(1);
                (0, vitest_1.expect)(info.at(0)?.symbolName).toBe(id);
            }
            finally {
                await connection.runCommand({
                    command: `DLTSRVPGM SRVPGM(${tempLib}/${id})`,
                    environment: 'ile'
                });
                await connection.runCommand({
                    command: `DLTMOD MODULE(${tempLib}/${id})`,
                    environment: 'ile'
                });
            }
        });
    });
    (0, vitest_1.it)('Copy and move streamfiles', async () => {
        const content = connection.getContent();
        await connection.withTempDirectory(async (directory) => {
            const checkFile = async (path, ccsid) => {
                (0, vitest_1.expect)(await content.testStreamFile(path, "w")).toBe(true);
                const attributes = await content.getAttributes(path, "CCSID");
                (0, vitest_1.expect)(attributes).toBeDefined();
                (0, vitest_1.expect)(attributes["CCSID"]).toBe(String(ccsid));
            };
            const unicodeFile = "unicode";
            const ccsid37File = "ccsid37";
            await content.createStreamFile(`${directory}/${unicodeFile}`);
            await checkFile(`${directory}/${unicodeFile}`, 1208);
            await content.createStreamFile(`${directory}/${ccsid37File}`);
            await connection.sendCommand({ command: `${connection.remoteFeatures.attr} ${directory}/${ccsid37File} CCSID=37` });
            await checkFile(`${directory}/${ccsid37File}`, 37);
            const files = [`${directory}/${unicodeFile}`, `${directory}/${ccsid37File}`];
            (0, vitest_1.expect)((await connection.sendCommand({ command: `mkdir ${directory}/copy` })).code).toBe(0);
            (0, vitest_1.expect)((await content.copy(files, `${directory}/copy`)).code).toBe(0);
            (0, vitest_1.expect)(await content.testStreamFile(`${directory}/${unicodeFile}`, "f")).toBe(true);
            (0, vitest_1.expect)(await content.testStreamFile(`${directory}/${ccsid37File}`, "f")).toBe(true);
            await checkFile(`${directory}/copy/${unicodeFile}`, 1208);
            await checkFile(`${directory}/copy/${ccsid37File}`, 37);
            (0, vitest_1.expect)((await connection.sendCommand({ command: `mkdir ${directory}/move` })).code).toBe(0);
            (0, vitest_1.expect)((await content.move(files, `${directory}/move`)).code).toBe(0);
            (0, vitest_1.expect)(await content.testStreamFile(`${directory}/${unicodeFile}`, "f")).toBe(false);
            (0, vitest_1.expect)(await content.testStreamFile(`${directory}/${ccsid37File}`, "f")).toBe(false);
            await checkFile(`${directory}/move/${unicodeFile}`, 1208);
            await checkFile(`${directory}/move/${ccsid37File}`, 37);
        });
    });
});
//# sourceMappingURL=content.test.js.map