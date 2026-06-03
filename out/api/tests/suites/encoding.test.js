"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const path_1 = __importDefault(require("path"));
const vitest_1 = require("vitest");
const IBMi_1 = __importDefault(require("../../IBMi"));
const Tools_1 = require("../../Tools");
const connection_1 = require("../connection");
const contents = {
    '37': [`Hello world`],
    '273': [`Hello world`, `àáãÄÜö£øß`],
    '277': [`Hello world`, `çñßØ¢åæ`],
    '297': [`Hello world`, `âÑéè¥ýÝÞã`],
    '290': [`ｦｯ!ﾓﾄｴﾜﾈﾁｾ`, `Hello world`, `ｦｯ!ﾓﾄｴﾜﾈﾁｾ`],
    '420': [`Hello world`, `ص ث ب`],
};
const SHELL_CHARS = [`$`, `#`];
async function runCommandsWithCCSID(connection, commands, ccsid) {
    const testPgmSrcFile = connection.upperCaseName(Tools_1.Tools.makeid(6));
    const config = connection.getConfig();
    const tempLib = config.tempLibrary;
    const testPgmName = connection.upperCaseName(`T${commands.length}${ccsid}${Tools_1.Tools.makeid(2)}`);
    await connection.runCommand({ command: `DLTOBJ OBJ(${tempLib}/${testPgmSrcFile}) OBJTYPE(*FILE)`, noLibList: true });
    await connection.runCommand({ command: `DLTOBJ OBJ(${tempLib}/${testPgmName}) OBJTYPE(*PGM)`, noLibList: true });
    const sourceFileCreated = await connection.runCommand({ command: `CRTSRCPF FILE(${tempLib}/${testPgmSrcFile}) RCDLEN(112) CCSID(${ccsid})`, noLibList: true });
    try {
        await connection.getContent().uploadMemberContent(tempLib, testPgmSrcFile, testPgmName, commands.join(`\n`));
        const compileCommand = `CRTBNDCL PGM(${tempLib}/${testPgmName}) SRCFILE(${tempLib}/${testPgmSrcFile}) SRCMBR(${testPgmName}) REPLACE(*YES)`;
        const compileResult = await connection.runCommand({ command: compileCommand, noLibList: true });
        if (compileResult.code !== 0) {
            return compileResult;
        }
        const callCommand = `CALL ${tempLib}/${testPgmName}`;
        const result = await connection.runCommand({ command: callCommand, noLibList: true });
        return result;
    }
    finally {
        await connection.runCommand({ command: `DLTOBJ OBJ(${tempLib}/${testPgmSrcFile}) OBJTYPE(*FILE)`, noLibList: true });
        await connection.runCommand({ command: `DLTOBJ OBJ(${tempLib}/${testPgmName}) OBJTYPE(*PGM)`, noLibList: true });
    }
}
(0, vitest_1.describe)('Encoding tests', { concurrent: true }, () => {
    let connection;
    (0, vitest_1.beforeAll)(async () => {
        connection = await (0, connection_1.newConnection)();
    }, connection_1.CONNECTION_TIMEOUT);
    (0, vitest_1.afterAll)(async () => {
        await (0, connection_1.disposeConnection)(connection);
    });
    (0, vitest_1.it)('Prove that input strings are messed up by CCSID', async () => {
        let howManyTimesItMessedUpTheResult = 0;
        for (const strCcsid in contents) {
            const data = contents[strCcsid].join(``);
            const sqlA = `select ? as THEDATA from sysibm.sysdummy1`;
            const resultA = await connection?.runSQL(sqlA, { fakeBindings: [data], forceSafe: true });
            (0, vitest_1.expect)(resultA?.length).toBeTruthy();
            const sqlB = `select '${data}' as THEDATA from sysibm.sysdummy1`;
            const resultB = await connection?.runSQL(sqlB, { forceSafe: true });
            (0, vitest_1.expect)(resultB?.length).toBeTruthy();
            (0, vitest_1.expect)(resultA[0].THEDATA).toBe(data);
            if (resultB[0].THEDATA !== data) {
                howManyTimesItMessedUpTheResult++;
            }
        }
        (0, vitest_1.expect)(howManyTimesItMessedUpTheResult).toBeTruthy();
    });
    (0, vitest_1.it)('Compare Unicode to EBCDIC successfully', async () => {
        const sql = `select table_name, table_owner from qsys2.systables where table_schema = ? and table_name = ?`;
        const result = await connection?.runSQL(sql, { fakeBindings: [`QSYS2`, `SYSCOLUMNS`] });
        (0, vitest_1.expect)(result?.length).toBeTruthy();
    });
    (0, vitest_1.it)('Run variants through shells', async () => {
        const text = `Hello${connection?.variantChars.local}world`;
        const basicCommandA = `echo "${IBMi_1.default.escapeForShell(text)}"`;
        const basicCommandB = `echo '${text}'`;
        const basicCommandC = `echo 'abc'\\''123'`;
        const printEscapeChar = `echo "\\\\"`;
        const setCommand = `set`;
        const setResult = await connection?.sendQsh({ command: setCommand });
        const qshEscapeResult = await connection?.sendQsh({ command: printEscapeChar });
        const paseEscapeResult = await connection?.sendCommand({ command: printEscapeChar });
        console.log(qshEscapeResult?.stdout);
        console.log(paseEscapeResult?.stdout);
        const qshTextResultA = await connection?.sendQsh({ command: basicCommandA });
        const paseTextResultA = await connection?.sendCommand({ command: basicCommandA });
        const qshTextResultB = await connection?.sendQsh({ command: basicCommandB });
        const paseTextResultB = await connection?.sendCommand({ command: basicCommandB });
        const qshTextResultC = await connection?.sendQsh({ command: basicCommandC });
        const paseTextResultC = await connection?.sendCommand({ command: basicCommandC });
        (0, vitest_1.expect)(paseEscapeResult?.stdout).toBe(`\\`);
        (0, vitest_1.expect)(qshTextResultA?.stdout).toBe(text);
        (0, vitest_1.expect)(paseTextResultA?.stdout).toBe(text);
        (0, vitest_1.expect)(qshTextResultB?.stdout).toBe(text);
        (0, vitest_1.expect)(paseTextResultB?.stdout).toBe(text);
    });
    (0, vitest_1.it)('streamfileResolve with dollar', async () => {
        await connection.withTempDirectory(async (tempDir) => {
            const tempFile = path_1.default.posix.join(tempDir, `$hello`);
            await connection.getContent().createStreamFile(tempFile);
            const resolved = await connection.getContent().streamfileResolve([tempFile], [`/`]);
            (0, vitest_1.expect)(resolved).toBe(tempFile);
        });
    });
    SHELL_CHARS.forEach(char => {
        (0, vitest_1.it)(`Test streamfiles with shell character ${char}`, async () => {
            const nameCombos = [`${char}ABC`, `ABC${char}`, `${char}ABC${char}`, `A${char}C`];
            await connection.withTempDirectory(async (tempDir) => {
                for (const name of nameCombos) {
                    const tempFile = path_1.default.posix.join(tempDir, `${name}.txt`);
                    await connection.getContent().createStreamFile(tempFile);
                    const resolved = await connection.getContent().streamfileResolve([tempFile], [`/`]);
                    (0, vitest_1.expect)(resolved).toBe(tempFile);
                    const attributes = await connection.getContent().getAttributes(resolved, `CCSID`);
                    (0, vitest_1.expect)(attributes).toBeTruthy();
                }
            });
        });
        (0, vitest_1.it)(`Test members with shell character ${char}`, async () => {
            const content = connection.getContent();
            const config = connection.getConfig();
            if (!connection.variantChars.local.includes(char)) {
                return;
            }
            const tempLib = config.tempLibrary;
            const tempSPF = Tools_1.Tools.makeid(8);
            const tempMbr = char + Tools_1.Tools.makeid(4);
            await connection.runCommand({
                command: `CRTSRCPF ${tempLib}/${tempSPF} MBR(*NONE)`,
                environment: `ile`
            });
            await connection.runCommand({
                command: `ADDPFM FILE(${tempLib}/${tempSPF}) MBR(${tempMbr}) `,
                environment: `ile`
            });
            try {
                const baseContent = `Hello world\r\n`;
                const attributes = await content.getAttributes({ library: tempLib, name: tempSPF, member: tempMbr }, `CCSID`);
                (0, vitest_1.expect)(attributes).toBeTruthy();
                const uploadResult = await content.uploadMemberContent(tempLib, tempSPF, tempMbr, baseContent);
                (0, vitest_1.expect)(uploadResult).toBeTruthy();
                const memberContentA = await content.downloadMemberContent(tempLib, tempSPF, tempMbr);
                (0, vitest_1.expect)(memberContentA).toBe(baseContent);
            }
            finally {
                await connection.runCommand({ command: `DLTF ${tempLib}/${tempSPF}`, noLibList: true });
            }
        });
    });
    (0, vitest_1.it)('Listing objects with variants', async () => {
        const content = connection.getContent();
        if (connection && content) {
            const tempLib = connection.getConfig().tempLibrary;
            const ccsid = connection.getCcsid();
            let library = `TESTLIB${connection.variantChars.local}`;
            let skipLibrary = false;
            const sourceFile = `${connection.variantChars.local}TESTFIL`;
            const dataArea = `TSTDTA${connection.variantChars.local}`;
            const members = [];
            for (let i = 0; i < 5; i++) {
                members.push(`TSTMBR${connection.variantChars.local}${i}`);
            }
            await connection.runCommand({ command: `DLTLIB LIB(${library})`, noLibList: true });
            try {
                const crtLib = await connection.runCommand({ command: `CRTLIB LIB(${library}) TYPE(*PROD)`, noLibList: true });
                if (Tools_1.Tools.parseMessages(crtLib.stderr).findId("CPD0032")) {
                    library = tempLib;
                    skipLibrary = true;
                }
                let commands = [];
                commands.push(`CRTSRCPF FILE(${library}/${sourceFile}) RCDLEN(112) CCSID(${ccsid})`);
                for (const member of members) {
                    commands.push(`ADDPFM FILE(${library}/${sourceFile}) MBR(${member}) SRCTYPE(TXT) TEXT('Test ${member}')`);
                }
                commands.push(`CRTDTAARA DTAARA(${library}/${dataArea}) TYPE(*CHAR) LEN(50) VALUE('hi')`);
                const result = await runCommandsWithCCSID(connection, commands, ccsid);
                (0, vitest_1.expect)(result.code).toBe(0);
                if (!skipLibrary) {
                    const [expectedLibrary] = await content.getLibraries({ library });
                    (0, vitest_1.expect)(expectedLibrary).toBeTruthy();
                    (0, vitest_1.expect)(library).toBe(expectedLibrary.name);
                    const validated = await connection.getContent().validateLibraryList([tempLib, library]);
                    (0, vitest_1.expect)(validated.length).toBe(0);
                    const libl = await content.getLibraryList([library]);
                    (0, vitest_1.expect)(libl.length).toBe(1);
                    (0, vitest_1.expect)(libl[0].name).toBe(library);
                }
                const checkFile = (expectedObject) => {
                    (0, vitest_1.expect)(expectedObject).toBeTruthy();
                    (0, vitest_1.expect)(expectedObject.sourceFile).toBeTruthy();
                    (0, vitest_1.expect)(expectedObject.name).toBe(sourceFile);
                    (0, vitest_1.expect)(expectedObject.library).toBe(library);
                };
                const nameFilter = await content.getObjectList({ library, types: ["*ALL"], object: `${connection.variantChars.local[0]}*` });
                (0, vitest_1.expect)(nameFilter.length).toBe(1);
                (0, vitest_1.expect)(nameFilter.some(obj => obj.library === library && obj.type === `*FILE` && obj.name === sourceFile)).toBeTruthy();
                const objectList = await content.getObjectList({ library, types: ["*ALL"] });
                (0, vitest_1.expect)(objectList.some(obj => obj.library === library && obj.type === `*FILE` && obj.name === sourceFile && obj.sourceFile === true)).toBeTruthy();
                (0, vitest_1.expect)(objectList.some(obj => obj.library === library && obj.type === `*DTAARA` && obj.name === dataArea)).toBeTruthy();
                const expectedMembers = await content.getMemberList({ library, sourceFile });
                (0, vitest_1.expect)(expectedMembers).toBeTruthy();
                (0, vitest_1.expect)(expectedMembers.every(member => members.find(m => m === member.name && member.text?.includes(m)))).toBeTruthy();
                const sourceFilter = await content.getObjectList({ library, types: ["*SRCPF"], object: `${connection.variantChars.local[0]}*` });
                (0, vitest_1.expect)(sourceFilter.length).toBe(1);
                (0, vitest_1.expect)(sourceFilter.some(obj => obj.library === library && obj.type === `*FILE` && obj.name === sourceFile)).toBeTruthy();
                const [expectDataArea] = await content.getObjectList({ library, object: dataArea, types: ["*DTAARA"] });
                (0, vitest_1.expect)(expectDataArea.name).toBe(dataArea);
                (0, vitest_1.expect)(expectDataArea.library).toBe(library);
                (0, vitest_1.expect)(expectDataArea.type).toBe(`*DTAARA`);
                const [expectedSourceFile] = await content.getObjectList({ library, object: sourceFile, types: ["*SRCPF"] });
                checkFile(expectedSourceFile);
            }
            finally {
                if (skipLibrary) {
                    await connection.runCommand({ command: `DLTF FILE(${library}/${sourceFile})`, noLibList: true });
                    await connection.runCommand({ command: `DLTDTAARA DTAARA(${library}/${dataArea})`, noLibList: true });
                }
                else {
                    await connection.runCommand({ command: `DLTLIB LIB(${library})`, noLibList: true });
                }
            }
        }
    });
    (0, vitest_1.it)('Library list supports dollar sign variant', async () => {
        const library = `TEST${connection.variantChars.local}LIB`;
        const sourceFile = `TEST${connection.variantChars.local}FIL`;
        const member = `TEST${connection.variantChars.local}MBR`;
        const ccsid = connection.getCcsid();
        if (library.includes(`$`)) {
            await connection.runCommand({ command: `DLTLIB LIB(${library})`, noLibList: true });
            const crtLib = await connection.runCommand({ command: `CRTLIB LIB(${library}) TYPE(*PROD)`, noLibList: true });
            if (Tools_1.Tools.parseMessages(crtLib.stderr).findId("CPD0032")) {
                return;
            }
            try {
                const createSourceFileCommand = await connection.runCommand({ command: `CRTSRCPF FILE(${library}/${sourceFile}) RCDLEN(112) CCSID(${ccsid})`, noLibList: true });
                (0, vitest_1.expect)(createSourceFileCommand.code).toBe(0);
                const addPf = await connection.runCommand({ command: `ADDPFM FILE(${library}/${sourceFile}) MBR(${member}) SRCTYPE(TXT)`, noLibList: true });
                (0, vitest_1.expect)(addPf.code).toBe(0);
                await connection.getContent().uploadMemberContent(library, sourceFile, member, [`**free`, `dsply 'Hello world';`, `return;`].join(`\n`));
                const compileResultA = await connection.runCommand({ command: `CRTBNDRPG PGM(${library}/${member}) SRCFILE(${library}/${sourceFile}) SRCMBR(${member})`, env: { '&CURLIB': library } });
                (0, vitest_1.expect)(compileResultA.code).toBe(0);
                const compileResultB = await connection.runCommand({ command: `CRTBNDRPG PGM(${library}/${member}) SRCFILE(${library}/${sourceFile}) SRCMBR(${member})`, env: { '&LIBL': library } });
                (0, vitest_1.expect)(compileResultB.code).toBe(0);
            }
            finally {
                await connection.runCommand({ command: `DLTLIB LIB(${library})`, noLibList: true });
            }
        }
    });
    (0, vitest_1.it)('Variant character in source names and commands', async () => {
        const config = connection.getConfig();
        const ccsidData = connection.getCcsids();
        const tempLib = config.tempLibrary;
        async function testSingleVariant(varChar) {
            const testFile = connection.upperCaseName(`${varChar}${Tools_1.Tools.makeid(4)}`);
            const testMember = connection.upperCaseName(`${varChar}${Tools_1.Tools.makeid(4)}`);
            const variantMember = connection.upperCaseName(`${connection.variantChars.local}MBR`);
            await connection.runCommand({ command: `DLTF FILE(${tempLib}/${testFile})`, noLibList: true });
            const createResult = await runCommandsWithCCSID(connection, [`CRTSRCPF FILE(${tempLib}/${testFile}) RCDLEN(112) CCSID(${ccsidData.userDefaultCCSID})`], ccsidData.userDefaultCCSID);
            (0, vitest_1.expect)(createResult.code).toBe(0);
            try {
                const addPf = await connection.runCommand({ command: `ADDPFM FILE(${tempLib}/${testFile}) MBR(${testMember}) SRCTYPE(TXT)`, noLibList: true });
                (0, vitest_1.expect)(addPf.code).toBe(0);
                const attributes = await connection.getContent().getAttributes({ library: tempLib, name: testFile, member: testMember }, `CCSID`);
                (0, vitest_1.expect)(attributes).toBeTruthy();
                (0, vitest_1.expect)(attributes[`CCSID`]).toBe(String(ccsidData.userDefaultCCSID));
                const addPfB = await connection.runCommand({ command: `ADDPFM FILE(${tempLib}/${testFile}) MBR(${variantMember}) SRCTYPE(TXT)`, noLibList: true });
                (0, vitest_1.expect)(addPfB.code).toBe(0);
                const attributesB = await connection.getContent().getAttributes({ library: tempLib, name: testFile, member: variantMember }, `CCSID`);
                (0, vitest_1.expect)(attributesB).toBeTruthy();
                (0, vitest_1.expect)(attributesB[`CCSID`]).toBe(String(ccsidData.userDefaultCCSID));
                const objects = await connection.getContent().getObjectList({ library: tempLib, types: [`*SRCPF`] });
                (0, vitest_1.expect)(objects.length).toBeTruthy();
                (0, vitest_1.expect)(objects.some(obj => obj.name === testFile)).toBeTruthy();
                const members = await connection.getContent().getMemberList({ library: tempLib, sourceFile: testFile });
                (0, vitest_1.expect)(members.length).toBeTruthy();
                (0, vitest_1.expect)(members.some(m => m.name === testMember)).toBeTruthy();
                (0, vitest_1.expect)(members.some(m => m.file === testFile)).toBeTruthy();
                const smallFilter = await connection.getContent().getMemberList({ library: tempLib, sourceFile: testFile, members: `${varChar}*` });
                (0, vitest_1.expect)(smallFilter.length).toBeTruthy();
                const files = await connection.getContent().getFileList(`/QSYS.LIB/${tempLib}.LIB/${connection.sysNameInAmerican(testFile)}.FILE`);
                (0, vitest_1.expect)(files.length).toBeTruthy();
                (0, vitest_1.expect)(files.some(f => f.name === connection.sysNameInAmerican(variantMember) + `.MBR`)).toBeTruthy();
                (0, vitest_1.expect)(files.some(f => f.name === connection.sysNameInAmerican(testMember) + `.MBR`)).toBeTruthy();
                await connection.getContent().uploadMemberContent(tempLib, testFile, testMember, [`**free`, `dsply 'Hello world';`, `   `, `   `, `return;`].join(`\n`));
                const compileResult = await connection.runCommand({ command: `CRTBNDRPG PGM(${tempLib}/${testMember}) SRCFILE(${tempLib}/${testFile}) SRCMBR(${testMember})`, noLibList: true });
                console.log(compileResult);
                (0, vitest_1.expect)(compileResult.code).toBe(0);
                await connection.runCommand({ command: `DLTOBJ OBJ(${tempLib}/${testMember}) OBJTYPE(*PGM)`, noLibList: true });
            }
            finally {
                await connection.runCommand({ command: `DLTF FILE(${tempLib}/${testFile})`, noLibList: true });
            }
        }
        for (const varChar of connection.variantChars.local) {
            await testSingleVariant(varChar);
        }
    });
});
//# sourceMappingURL=encoding.test.js.map