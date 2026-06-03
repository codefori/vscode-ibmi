"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.EncodingSuite = void 0;
const assert_1 = __importDefault(require("assert"));
const path_1 = __importDefault(require("path"));
const vscode_1 = require("vscode");
const Tools_1 = require("../api/Tools");
const QSysFs_1 = require("../filesystems/qsys/QSysFs");
const instantiate_1 = require("../instantiate");
const contents = {
    '37': [`Hello world`],
    '273': [`Hello world`, `àáãÄÜö£øß`],
    '277': [`Hello world`, `çñßØ¢åæ`],
    '297': [`Hello world`, `âÑéè¥ýÝÞã`],
    '290': [`ｦｯ!ﾓﾄｴﾜﾈﾁｾ`, `Hello world`, `ｦｯ!ﾓﾄｴﾜﾈﾁｾ`],
    // '420': [`Hello world`, `ص ث ب ﻷ`],
    '420': [`Hello world`, `ص ث ب`],
};
const SHELL_CHARS = [`$`, `#`];
const rtlEncodings = [`420`];
async function runCommandsWithCCSID(connection, commands, ccsid) {
    const testPgmSrcFile = `TESTING`;
    const config = connection.getConfig();
    const tempLib = config.tempLibrary;
    const testPgmName = `T${commands.length}${ccsid}`;
    const sourceFileCreated = await connection.runCommand({ command: `CRTSRCPF FILE(${tempLib}/${testPgmSrcFile}) RCDLEN(112) CCSID(${ccsid})`, noLibList: true });
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
exports.EncodingSuite = {
    name: `Encoding tests`,
    before: async () => {
        const config = instantiate_1.instance.getConnection()?.getConfig();
        if (config) {
            assert_1.default.ok(config.enableSourceDates, `Source dates must be enabled for this test.`);
        }
    },
    tests: [
        {
            name: `Files and directories with spaces`, test: async () => {
                const connection = instantiate_1.instance.getConnection();
                await connection.withTempDirectory(async (tempDir) => {
                    const dirName = `hello world`;
                    const dirWithSpace = path_1.default.posix.join(tempDir, dirName);
                    const fileName = `hello world.txt`;
                    const nameWithSpace = path_1.default.posix.join(dirWithSpace, fileName);
                    await connection.sendCommand({ command: `mkdir -p "${dirWithSpace}"` });
                    await connection.getContent().createStreamFile(nameWithSpace);
                    // Resolve and get attributes
                    const resolved = await connection.getContent().streamfileResolve([fileName], [tempDir, dirWithSpace]);
                    assert_1.default.strictEqual(resolved, nameWithSpace);
                    const attributes = await connection.getContent().getAttributes(resolved, `CCSID`);
                    assert_1.default.ok(attributes);
                    // Write and read the files
                    const uri = vscode_1.Uri.from({ scheme: `streamfile`, path: nameWithSpace });
                    await vscode_1.workspace.fs.writeFile(uri, Buffer.from(`Hello world`, `utf8`));
                    const streamfileContents = await vscode_1.workspace.fs.readFile(uri);
                    assert_1.default.ok(streamfileContents.toString().includes(`Hello world`));
                    // List files
                    const files = await connection.getContent().getFileList(tempDir);
                    assert_1.default.strictEqual(files.length, 1);
                    assert_1.default.ok(files.some(f => f.name === dirName && f.path === dirWithSpace));
                    const files2 = await connection.getContent().getFileList(dirWithSpace);
                    assert_1.default.strictEqual(files2.length, 1);
                    assert_1.default.ok(files2.some(f => f.name === fileName && f.path === nameWithSpace));
                });
            }
        },
        ...SHELL_CHARS.map(char => ({
            name: `Test streamfiles with shell character ${char}`, test: async () => {
                const connection = instantiate_1.instance.getConnection();
                const nameCombos = [`${char}ABC`, `ABC${char}`, `${char}ABC${char}`, `A${char}C`];
                await connection.withTempDirectory(async (tempDir) => {
                    for (const name of nameCombos) {
                        const tempFile = path_1.default.posix.join(tempDir, `${name}.txt`);
                        await connection.getContent().createStreamFile(tempFile);
                        const resolved = await connection.getContent().streamfileResolve([tempFile], [`/`]);
                        assert_1.default.strictEqual(resolved, tempFile);
                        const attributes = await connection.getContent().getAttributes(resolved, `CCSID`);
                        assert_1.default.ok(attributes);
                        const uri = vscode_1.Uri.from({ scheme: `streamfile`, path: tempFile });
                        await vscode_1.workspace.fs.writeFile(uri, Buffer.from(`Hello world`, `utf8`));
                        const streamfileContents = await vscode_1.workspace.fs.readFile(uri);
                        assert_1.default.strictEqual(streamfileContents.toString(), `Hello world`);
                    }
                });
            }
        })),
        ...SHELL_CHARS.map(char => ({
            name: `Test members with shell character ${char}`, test: async () => {
                const connection = instantiate_1.instance.getConnection();
                const content = connection.getContent();
                const config = connection.getConfig();
                if (!connection.variantChars.local.includes(char)) {
                    // This test will fail if $ is not a variant character, 
                    // since we're testing object names here
                    return;
                }
                const tempLib = config.tempLibrary, tempSPF = `TESTINGS`, tempMbr = char + Tools_1.Tools.makeid(4);
                await connection.runCommand({
                    command: `CRTSRCPF ${tempLib}/${tempSPF} MBR(*NONE)`,
                    environment: `ile`
                });
                await connection.runCommand({
                    command: `ADDPFM FILE(${tempLib}/${tempSPF}) MBR(${tempMbr}) `,
                    environment: `ile`
                });
                const baseContent = `Hello world\r\n`;
                const attributes = await content?.getAttributes({ library: tempLib, name: tempSPF, member: tempMbr }, `CCSID`);
                assert_1.default.ok(attributes);
                const uploadResult = await content?.uploadMemberContent(tempLib, tempSPF, tempMbr, baseContent);
                assert_1.default.ok(uploadResult);
                const memberContentA = await content?.downloadMemberContent(tempLib, tempSPF, tempMbr);
                assert_1.default.strictEqual(memberContentA, baseContent);
                const memberUri = (0, QSysFs_1.getMemberUri)({ library: tempLib, file: tempSPF, name: tempMbr, extension: `TXT` });
                const memberContentB = await vscode_1.workspace.fs.readFile(memberUri);
                let contentStr = new TextDecoder().decode(memberContentB);
                assert_1.default.ok(contentStr.includes(`Hello world`));
                await vscode_1.workspace.fs.writeFile(memberUri, Buffer.from(`Woah`, `utf8`));
                const memberContentBuf = await vscode_1.workspace.fs.readFile(memberUri);
                let fileContent = new TextDecoder().decode(memberContentBuf);
                assert_1.default.ok(fileContent.includes(`Woah`));
            }
        })),
        {
            name: `Variant character in source names and commands`, test: async () => {
                // CHGUSRPRF X CCSID(284) CNTRYID(ES) LANGID(ESP)
                const connection = instantiate_1.instance.getConnection();
                const config = connection.getConfig();
                const ccsidData = connection.getCcsids();
                const tempLib = config.tempLibrary;
                const varChar = connection.variantChars.local[1];
                const testFile = `${varChar}SCOBBY`;
                const testMember = `${varChar}MEMBER`;
                const variantMember = `${connection.variantChars.local}MBR`;
                const attemptDelete = await connection.runCommand({ command: `DLTF FILE(${tempLib}/${testFile})`, noLibList: true });
                const createResult = await runCommandsWithCCSID(connection, [`CRTSRCPF FILE(${tempLib}/${testFile}) RCDLEN(112) CCSID(${ccsidData.userDefaultCCSID})`], ccsidData.userDefaultCCSID);
                assert_1.default.strictEqual(createResult.code, 0);
                const addPf = await connection.runCommand({ command: `ADDPFM FILE(${tempLib}/${testFile}) MBR(${testMember}) SRCTYPE(TXT)`, noLibList: true });
                assert_1.default.strictEqual(addPf.code, 0);
                const attributes = await connection.getContent().getAttributes({ library: tempLib, name: testFile, member: testMember }, `CCSID`);
                assert_1.default.ok(attributes);
                assert_1.default.strictEqual(attributes[`CCSID`], String(ccsidData.userDefaultCCSID));
                /// Test for getAttributes on member with all variants
                const addPfB = await connection.runCommand({ command: `ADDPFM FILE(${tempLib}/${testFile}) MBR(${variantMember}) SRCTYPE(TXT)`, noLibList: true });
                assert_1.default.strictEqual(addPfB.code, 0);
                const attributesB = await connection.getContent().getAttributes({ library: tempLib, name: testFile, member: variantMember }, `CCSID`);
                assert_1.default.ok(attributesB);
                assert_1.default.strictEqual(attributesB[`CCSID`], String(ccsidData.userDefaultCCSID));
                /// -----
                const objects = await connection.getContent().getObjectList({ library: tempLib, types: [`*SRCPF`] });
                assert_1.default.ok(objects.length);
                assert_1.default.ok(objects.some(obj => obj.name === testFile));
                const members = await connection.getContent().getMemberList({ library: tempLib, sourceFile: testFile });
                assert_1.default.ok(members.length);
                assert_1.default.ok(members.some(m => m.name === testMember));
                assert_1.default.ok(members.some(m => m.file === testFile));
                const smallFilter = await connection.getContent().getMemberList({ library: tempLib, sourceFile: testFile, members: `${varChar}*` });
                assert_1.default.ok(smallFilter.length);
                const files = await connection.getContent().getFileList(`/QSYS.LIB/${tempLib}.LIB/${connection.sysNameInAmerican(testFile)}.FILE`);
                assert_1.default.ok(files.length);
                assert_1.default.strictEqual(files[0].name, connection.sysNameInAmerican(testMember) + `.MBR`);
                await connection.getContent().uploadMemberContent(tempLib, testFile, testMember, [`**free`, `dsply 'Hello world';`, `   `, `   `, `return;`].join(`\n`));
                const compileResult = await connection.runCommand({ command: `CRTBNDRPG PGM(${tempLib}/${testMember}) SRCFILE(${tempLib}/${testFile}) SRCMBR(${testMember})`, noLibList: true });
                assert_1.default.strictEqual(compileResult.code, 0);
                const memberUri = (0, QSysFs_1.getMemberUri)({ library: tempLib, file: testFile, name: testMember, extension: `RPGLE` });
                const content = await vscode_1.workspace.fs.readFile(memberUri);
                let contentStr = new TextDecoder().decode(content);
                assert_1.default.ok(!contentStr.includes(`0`));
                assert_1.default.ok(contentStr.includes(`dsply 'Hello world';`));
                await vscode_1.workspace.fs.writeFile(memberUri, Buffer.from([`**free`, `dsply 'Woah';`, `   `, `   `, `return;`].join(`\n`), `utf8`));
                const memberContentBuf = await vscode_1.workspace.fs.readFile(memberUri);
                let fileContent = new TextDecoder().decode(memberContentBuf);
                assert_1.default.ok(fileContent.includes(`Woah`));
                assert_1.default.ok(!fileContent.includes(`0`));
            },
        },
        ...Object.keys(contents).map(ccsid => ({
            name: `Encoding ${ccsid}`, test: async () => {
                const connection = instantiate_1.instance.getConnection();
                const config = connection.getConfig();
                const oldLines = contents[ccsid];
                const lines = oldLines.join(`\n`);
                const tempLib = config.tempLibrary;
                const file = `TEST${ccsid}`;
                await connection.runCommand({ command: `CRTSRCPF FILE(${tempLib}/${file}) RCDLEN(112) CCSID(${ccsid})`, noLibList: true });
                await connection.runCommand({ command: `ADDPFM FILE(${tempLib}/${file}) MBR(THEMEMBER) SRCTYPE(TXT)`, noLibList: true });
                const theBadOneUri = (0, QSysFs_1.getMemberUri)({ library: tempLib, file, name: `THEMEMBER`, extension: `TXT` });
                // Initial read to create the alias
                await vscode_1.workspace.fs.readFile(theBadOneUri);
                await vscode_1.workspace.fs.writeFile(theBadOneUri, Buffer.from(lines, `utf8`));
                const memberContentBuf = await vscode_1.workspace.fs.readFile(theBadOneUri);
                const fileContent = new TextDecoder().decode(memberContentBuf).trimEnd();
                if (rtlEncodings.includes(ccsid)) {
                    const newLines = fileContent.split(`\n`);
                    assert_1.default.strictEqual(newLines.length, 2);
                    assert_1.default.ok(newLines[1].startsWith(` `)); // RTL
                    assert_1.default.strictEqual(newLines[0].trim(), oldLines[0]);
                    assert_1.default.strictEqual(newLines[1].trim(), oldLines[1]);
                }
                else {
                    assert_1.default.deepStrictEqual(fileContent, lines);
                }
            }
        }))
    ]
};
//# sourceMappingURL=encoding.js.map