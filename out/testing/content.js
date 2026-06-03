"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ContentSuite = void 0;
const assert_1 = __importDefault(require("assert"));
const tmp_1 = __importDefault(require("tmp"));
const util_1 = __importStar(require("util"));
const vscode_1 = require("vscode");
const QSysFs_1 = require("../filesystems/qsys/QSysFs");
const instantiate_1 = require("../instantiate");
exports.ContentSuite = {
    name: `Content FileSystem API tests`,
    tests: [
        {
            name: `Test downloadMemberContent`, test: async () => {
                const content = instantiate_1.instance.getConnection()?.getContent();
                const tmpFile = await util_1.default.promisify(tmp_1.default.file)();
                const memberContent = await content?.downloadMemberContent('QSYSINC', 'H', 'MATH', tmpFile);
                const tmpFileContent = (await vscode_1.workspace.fs.readFile(vscode_1.Uri.file(tmpFile))).toString();
                assert_1.default.strictEqual(tmpFileContent, memberContent);
            }
        },
        {
            name: `Test downloadMemberContentWithDates SRCDTA`, test: async () => {
                // Note: This is a known failure.
                const lines = [
                    `+123 C* Unaffected`,
                    `     C* Next line must be unaffected`,
                    `+123`,
                    `** DATA`,
                    `0123`,
                    `+123`,
                    `-123`
                ].join(`\n`);
                const connection = instantiate_1.instance.getConnection();
                const config = connection.getConfig();
                assert_1.default.ok(config.enableSourceDates, `Source dates must be enabled for this test.`);
                const testLib = config.tempLibrary;
                const testFile = `SRCDTATEST`;
                const testMember = `MEMBER`;
                const testExt = `RPGLE`;
                await connection.runCommand({ command: `DLTF FILE(${testLib}/${testFile})`, noLibList: true });
                await connection.runCommand({ command: `CRTSRCPF FILE(${testLib}/${testFile}) RCDLEN(112)`, noLibList: true });
                await connection.runCommand({ command: `ADDPFM FILE(${testLib}/${testFile}) MBR(${testMember}) SRCTYPE(${testExt})` });
                const testMemberRui = (0, QSysFs_1.getMemberUri)({ library: testLib, file: testFile, name: testMember, extension: testExt });
                await vscode_1.workspace.fs.writeFile(testMemberRui, Buffer.from(lines, `utf8`));
                const memberContentBuf = await vscode_1.workspace.fs.readFile(testMemberRui);
                await connection.runCommand({ command: `DLTF FILE(${testLib}/${testFile})`, noLibList: true }); // Cleanup...!
                const fileContent = new util_1.TextDecoder().decode(memberContentBuf);
                assert_1.default.strictEqual(fileContent, lines);
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
                const connection = instantiate_1.instance.getConnection();
                const config = connection.getConfig();
                assert_1.default.ok(config.enableSourceDates, `Source dates must be enabled for this test.`);
                const tempLib = config.tempLibrary;
                await connection.runCommand({ command: `CRTSRCPF FILE(${tempLib}/TABTEST) RCDLEN(112)`, noLibList: true });
                await connection.runCommand({ command: `ADDPFM FILE(${tempLib}/TABTEST) MBR(THEBADONE) SRCTYPE(HELLO)` });
                const theBadOneUri = (0, QSysFs_1.getMemberUri)({ library: tempLib, file: `TABTEST`, name: `THEBADONE`, extension: `HELLO` });
                // We have to read it first to create the alias!
                await vscode_1.workspace.fs.readFile(theBadOneUri);
                await vscode_1.workspace.fs.writeFile(theBadOneUri, Buffer.from(lines, `utf8`));
                const memberContentBuf = await vscode_1.workspace.fs.readFile(theBadOneUri);
                await connection.runCommand({ command: `DLTF FILE(${tempLib}/TABTEST)`, noLibList: true }); // Cleanup...!
                const fileContent = new util_1.TextDecoder().decode(memberContentBuf);
                assert_1.default.strictEqual(fileContent, lines);
            }
        },
    ]
};
//# sourceMappingURL=content.js.map