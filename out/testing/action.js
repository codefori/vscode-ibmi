"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ActionSuite = exports.helloWorldProject = void 0;
const assert_1 = __importDefault(require("assert"));
const fs_1 = require("fs");
const vscode_1 = __importDefault(require("vscode"));
const CompileTools_1 = require("../api/CompileTools");
const Tools_1 = require("../api/Tools");
const LocalLanguageActions_1 = require("../filesystems/local/LocalLanguageActions");
const deployTools_1 = require("../filesystems/local/deployTools");
const env_1 = require("../filesystems/local/env");
const QSysFs_1 = require("../filesystems/qsys/QSysFs");
const instantiate_1 = require("../instantiate");
const actions_1 = require("../ui/actions");
const deployTools_2 = require("./deployTools");
exports.helloWorldProject = {
    name: `DeleteMe_${Tools_1.Tools.makeid()}`,
    files: [
        new deployTools_2.File("hello.pgm.rpgle", ['**free', 'dsply \'Hello World\';', 'return;']),
        new deployTools_2.File("thebadone.pgm.rpgle", ['**free', 'dsply Hello world;', 'return;']),
        new deployTools_2.File("ugly.dspf", [
            `     A                                      INDARA`,
            `     A                                      CA12(12)`,
            `     A          R DETAIL                    `,
            `     A                                  6 10'ID'`,
            `     A                                      DSPATR(HI)`,
            `     A                                      DSPATR(UL)`,
        ])
    ],
};
let currentLibrary;
exports.ActionSuite = {
    name: `Action tests`,
    notConcurrent: true,
    before: async () => {
        const storage = instantiate_1.instance.getStorage();
        const connection = instantiate_1.instance.getConnection();
        const config = connection.getConfig();
        const workspaceFolder = vscode_1.default.workspace.workspaceFolders ? vscode_1.default.workspace.workspaceFolders[0] : undefined;
        const tempDir = config.tempDir;
        assert_1.default.ok(workspaceFolder, "No workspace folder to work with");
        assert_1.default.ok(tempDir, "Cannot run deploy tools tests: no remote temp directory defined");
        const tempDeployLocation = connection?.getTempRemote(`/some/dir`);
        await (0, deployTools_2.createFolder)(workspaceFolder.uri, tempDeployLocation, exports.helloWorldProject);
        assert_1.default.ok(exports.helloWorldProject.localPath, "Project has no local path");
        assert_1.default.ok((0, fs_1.existsSync)(exports.helloWorldProject.localPath.fsPath), "Project local directory does not exist");
        const existingPaths = storage.getDeployment();
        existingPaths[workspaceFolder.uri.fsPath] = tempDeployLocation;
        await storage.setDeployment(existingPaths);
        await deployTools_1.DeployTools.launchDeploy(workspaceFolder.index, 'all');
        const envFileVars = await (0, env_1.getEnvConfig)(workspaceFolder);
        currentLibrary = envFileVars['CURLIB'] ? envFileVars['CURLIB'] : config.currentLibrary;
        const tempLib = config.tempLibrary;
        await connection.runCommand({ command: `DLTOBJ OBJ(${tempLib}/QRPGLESRC) OBJTYPE(*FILE)`, noLibList: true });
        await connection.runCommand({ command: `CRTSRCPF FILE(${tempLib}/QRPGLESRC) RCDLEN(112)`, noLibList: true });
    },
    tests: [
        {
            name: `Variable expansion test`, test: async () => {
                const connection = instantiate_1.instance.getConnection();
                const result = await CompileTools_1.CompileTools.runCommand(connection, {
                    command: 'echo "&CURLIB &MYTEXT"',
                    env: { '&MYTEXT': `&BRANCHLIB &BRANCH`, '&BRANCHLIB': 'MYLIB', '&BRANCH': 'my/lib' },
                    environment: `pase`
                });
                assert_1.default.strictEqual(result?.stdout, `${currentLibrary} MYLIB my/lib`);
            }
        },
        {
            name: `Create RPGLE Program (from local, custom action)`, test: async () => {
                const action = LocalLanguageActions_1.LocalLanguageActions['RPGLE'][0];
                action.type = 'file';
                action.deployFirst = false;
                const uri = exports.helloWorldProject.files[0].localPath;
                await testHelloWorldProgram(uri, action, currentLibrary);
            }
        },
        {
            name: `Create display file (from local, custom action)`, test: async () => {
                const uri = exports.helloWorldProject.files[2].localPath;
                const action = {
                    command: `CRTDSPF FILE(&CURLIB/&NAME) SRCFILE(&SRCFILE) TEXT('DSPF from local')`,
                    environment: `ile`,
                    type: `file`,
                    name: `Create Display File (CRTDSPF)`,
                };
                const success = await (0, actions_1.runAction)(instantiate_1.instance, uri, action, `all`);
                console.log(success);
                assert_1.default.ok(success);
            }
        },
        {
            name: `Create Bound RPG Program (from IFS, custom action)`, test: async () => {
                const action = {
                    "name": "Create Bound RPG Program (CRTBNDRPG)",
                    "command": "CRTBNDRPG PGM(&BUILDLIB/&NAME) SRCSTMF('&FULLPATH') OPTION(*EVENTF) DBGVIEW(*SOURCE) TGTRLS(*CURRENT) TGTCCSID(*JOB)",
                    "type": "streamfile",
                    "environment": "ile",
                    "extensions": [
                        "RPGLE",
                        "RPG"
                    ],
                };
                const uri = (0, QSysFs_1.getUriFromPath)(exports.helloWorldProject.files[0].remotePath);
                await testHelloWorldProgram(uri, action, currentLibrary);
            }
        },
        {
            name: `Create Bound RPG Program (from member, custom action)`, test: async () => {
                const connection = instantiate_1.instance.getConnection();
                const config = connection.getConfig();
                const content = connection.getContent();
                const tempLib = config.tempLibrary;
                await connection.runCommand({ command: `ADDPFM FILE(${tempLib}/QRPGLESRC) MBR(HELLO) SRCTYPE(RPGLE)` });
                await content.uploadMemberContent(tempLib, 'QRPGLESRC', 'HELLO', exports.helloWorldProject.files[0].content.join('\n'));
                const action = {
                    "name": "Create Bound RPG Program (CRTBNDRPG)",
                    "command": "CRTBNDRPG PGM(&OPENLIB/&OPENMBR) SRCFILE(&OPENLIB/&OPENSPF) OPTION(*EVENTF) DBGVIEW(*SOURCE) TGTRLS(*CURRENT)",
                    "type": "member",
                    "environment": "ile",
                    "extensions": [
                        "RPGLE",
                        "RPG"
                    ],
                };
                const uri = (0, QSysFs_1.getMemberUri)({ library: tempLib, file: 'QRPGLESRC', name: 'HELLO', extension: 'RPGLE' });
                await testHelloWorldProgram(uri, action, tempLib);
            }
        },
        {
            name: `Create Bound RPG Program failure (from member, custom action)`, test: async () => {
                const connection = instantiate_1.instance.getConnection();
                const config = connection.getConfig();
                const content = connection.getContent();
                const tempLib = config.tempLibrary;
                await connection.runCommand({ command: `ADDPFM FILE(${tempLib}/QRPGLESRC) MBR(THEBADONE) SRCTYPE(RPGLE)` });
                await content.uploadMemberContent(tempLib, 'QRPGLESRC', 'THEBADONE', exports.helloWorldProject.files[1].content.join('\n'));
                const action = {
                    "name": "Create Bound RPG Program (CRTBNDRPG)",
                    "command": "CRTBNDRPG PGM(&OPENLIB/&OPENMBR) SRCFILE(&OPENLIB/&OPENSPF) OPTION(*EVENTF) DBGVIEW(*SOURCE) TGTRLS(*CURRENT)",
                    "type": "member",
                    "environment": "ile",
                    "extensions": [
                        "RPGLE",
                        "RPG"
                    ],
                };
                const uri = (0, QSysFs_1.getMemberUri)({ library: tempLib, file: 'QRPGLESRC', name: 'THEBADONE', extension: 'RPGLE' });
                const success = await (0, actions_1.runAction)(instantiate_1.instance, uri, action, `all`);
                assert_1.default.strictEqual(success, false);
            }
        },
        {
            name: "Fail to run action on uri with different schemes", test: async () => {
                const uris = [
                    vscode_1.default.Uri.parse("streamfile:///home/someone/meh.txt"),
                    vscode_1.default.Uri.parse("member:///QTEMP/SOMETHING.RPGLE"),
                    vscode_1.default.Uri.parse("file://loca/youwish.txt")
                ];
                assert_1.default.strictEqual(await (0, actions_1.runAction)(instantiate_1.instance, uris, {
                    name: "It won't run",
                    command: "wont run",
                    environment: "ile",
                }), false);
            }
        },
        {
            name: "Run multiple objects action", test: async () => {
                const dtaaras = [1, 2, 3, 4, 5].map(num => vscode_1.default.Uri.parse(`object:/QTEMP/DATAAREA${num}.DTAARA`));
                const result = await (0, actions_1.runAction)(instantiate_1.instance, dtaaras, {
                    name: "Create Data Area",
                    command: "CRTDTAARA DTAARA(&LIBRARY/&NAME) TYPE(*CHAR) LEN(10) VALUE('&NAME')",
                    type: "object",
                    environment: "ile"
                });
                assert_1.default.ok(result);
            }
        },
        {
            name: "Run multiple members action", test: async () => {
                const connection = instantiate_1.instance.getConnection();
                const config = connection.getConfig();
                const content = connection.getContent();
                const testlib = config.tempLibrary;
                const file = "XX" + Tools_1.Tools.makeid(6);
                try {
                    await connection.runCommand({ command: `CRTSRCPF FILE(${testlib}/${file}) RCDLEN(112)`, noLibList: true });
                    const members = [];
                    for (let i = 1; i < 6; i++) {
                        const member = `MEMBER${i}`;
                        const addpfm = await connection.runCommand({ command: `ADDPFM FILE(${testlib}/${file}) MBR(${member}) SRCTYPE(CLLE)` });
                        if (addpfm.code !== 0) {
                            throw new Error(`Failed to add member: ${addpfm.stderr}`);
                        }
                        await content.uploadMemberContent(testlib, file, member, ['PGM', `   DLYJOB ${i}`, `ENDPGM`].join('\n'));
                        members.push(vscode_1.default.Uri.parse(`member:/${config.tempLibrary}/${file}/MEMBER${i}.CLLE`));
                    }
                    const result = await (0, actions_1.runAction)(instantiate_1.instance, members, {
                        name: "Create Bound CL Program",
                        command: "CRTBNDCL PGM(QTEMP/&OPENMBR) SRCFILE(&OPENLIB/&OPENSPF)",
                        type: "member",
                        environment: "ile"
                    });
                    assert_1.default.ok(result);
                }
                finally {
                    await connection.runCommand({ command: `DLTF FILE(${testlib}/${file})`, noLibList: true });
                }
            }
        },
        {
            name: "Run multiple streamfiles action", test: async () => {
                const connection = instantiate_1.instance.getConnection();
                const config = connection.getConfig();
                const content = connection.getContent();
                const testLib = config.tempLibrary;
                const table = "YY" + Tools_1.Tools.makeid(6);
                try {
                    await connection.runSQL(`Create or replace table ${testLib}.${table} (key varchar(10), value varchar(100));`);
                    await connection.withTempDirectory(async (directory) => {
                        const files = [];
                        for (let i = 1; i < 6; i++) {
                            const file = `statement_${i}.sql`;
                            await content.writeStreamfileRaw(`${directory}/${file}`, `insert into ${testLib}.${table} values ('hello_${i}', 'world_${i}');`);
                            files.push(vscode_1.default.Uri.parse(`streamfile:${directory}/${file}`));
                        }
                        const result = await (0, actions_1.runAction)(instantiate_1.instance, files, {
                            name: "Run SQL statement",
                            command: "RUNSQLSTM SRCSTMF('&FULLPATH') COMMIT(*NONE) NAMING(*SQL)",
                            type: "streamfile",
                            environment: "ile"
                        });
                        assert_1.default.ok(result);
                        const rows = await connection.runSQL(`Select key, value from ${testLib}.${table}`);
                        assert_1.default.strictEqual(rows.length, 5);
                    });
                }
                finally {
                    await connection.runCommand({ command: `DLTF FILE(${testLib}/${table})`, noLibList: true });
                }
            }
        },
        {
            name: "Run multiple local files action", test: async () => {
                const uris = exports.helloWorldProject.files.map(file => file.localPath);
                const action = {
                    command: `[ -e "&FULLPATH" ] && attr "&FULLPATH" CCSID`,
                    environment: `pase`,
                    type: `file`,
                    name: `Check file CCSID`,
                };
                const success = await (0, actions_1.runAction)(instantiate_1.instance, uris, action, `compare`);
                assert_1.default.ok(success);
            }
        }
    ]
};
async function testHelloWorldProgram(uri, action, library) {
    const actionRan = await (0, actions_1.runAction)(instantiate_1.instance, uri, action, `all`);
    assert_1.default.ok(actionRan);
    const keysToCompare = [`library`, `name`, `type`, `text`, `attribute`, `sourceFile`, `memberCount`];
    const toJSON = (obj) => JSON.stringify(obj, (key, value) => {
        if (keysToCompare.includes(key)) {
            return value;
        }
    });
    const content = instantiate_1.instance.getConnection()?.getContent();
    const helloWorldProgram = (await content?.getObjectList({ library: library, object: 'HELLO', types: ['*PGM'] }))[0];
    assert_1.default.deepStrictEqual(toJSON(helloWorldProgram), toJSON({
        library: library,
        name: 'HELLO',
        type: '*PGM',
        text: '',
        attribute: 'RPGLE',
        sourceFile: false
    }));
    const connection = instantiate_1.instance.getConnection();
    await connection?.runCommand({ command: `DLTOBJ OBJ(${library}/HELLO) OBJTYPE(*PGM)` });
}
//# sourceMappingURL=action.js.map