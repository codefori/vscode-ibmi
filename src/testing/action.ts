import assert from "assert";
import { existsSync } from "fs";
import vscode from "vscode";
import { TestSuite } from ".";
import { CompileTools } from "../api/CompileTools";
import { Tools } from "../api/Tools";
import { LocalLanguageActions } from "../filesystems/local/LocalLanguageActions";
import { DeployTools } from "../filesystems/local/deployTools";
import { getEnvConfig } from "../filesystems/local/env";
import { getMemberUri, getUriFromPath } from "../filesystems/qsys/QSysFs";
import { instance } from "../instantiate";
import { Action, IBMiObject } from "../typings";
import { runAction } from "../ui/actions";
import { File, Folder, createFolder } from "./deployTools";

export const helloWorldProject: Folder = {
  name: `DeleteMe_${Tools.makeid()}`,
  files: [
    new File("hello.pgm.rpgle", ['**free', 'dsply \'Hello World\';', 'return;']),
    new File("thebadone.pgm.rpgle", ['**free', 'dsply Hello world;', 'return;']),
    new File("ugly.dspf", [
      `     A                                      INDARA`,
      `     A                                      CA12(12)`,
      `     A          R DETAIL                    `,
      `     A                                  6 10'ID'`,
      `     A                                      DSPATR(HI)`,
      `     A                                      DSPATR(UL)`,
    ])
  ],
}

let currentLibrary: string;

export const ActionSuite: TestSuite = {
  name: `Action tests`,
  notConcurrent: true,
  before: async () => {
    const config = instance.getConfig();
    const storage = instance.getStorage();
    const connection = instance.getConnection();

    const workspaceFolder = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0] : undefined;
    const tempDir = instance.getConfig()?.tempDir;
    assert.ok(workspaceFolder, "No workspace folder to work with");
    assert.ok(tempDir, "Cannot run deploy tools tests: no remote temp directory defined");

    const tempDeployLocation = connection?.getTempRemote(`/some/dir`);
    await createFolder(workspaceFolder.uri, tempDeployLocation!, helloWorldProject);
    assert.ok(helloWorldProject.localPath, "Project has no local path");
    assert.ok(existsSync(helloWorldProject.localPath.fsPath), "Project local directory does not exist");

    const existingPaths = storage!.getDeployment();
    existingPaths[workspaceFolder.uri.fsPath] = tempDeployLocation!;
    await storage!.setDeployment(existingPaths);
    await DeployTools.launchDeploy(workspaceFolder.index, 'all');

    const envFileVars = await getEnvConfig(workspaceFolder);
    currentLibrary = envFileVars['CURLIB'] ? envFileVars['CURLIB'] : config!.currentLibrary;

    const tempLib = config!.tempLibrary;
    await connection!.runCommand({ command: `DLTOBJ OBJ(${tempLib}/QRPGLESRC) OBJTYPE(*FILE)`, noLibList: true });
    await connection!.runCommand({ command: `CRTSRCPF FILE(${tempLib}/QRPGLESRC) RCDLEN(112)`, noLibList: true });
  },
  tests: [
    {
      name: `Variable expansion test`, test: async () => {
        const connection = instance.getConnection()!;
        const result = await CompileTools.runCommand(connection, {
          command: 'echo "&CURLIB &MYTEXT"',
          env: { '&MYTEXT': `&BRANCHLIB &BRANCH`, '&BRANCHLIB': 'MYLIB', '&BRANCH': 'my/lib' },
          environment: `pase`
        });

        assert.strictEqual(result?.stdout, `${currentLibrary} MYLIB my/lib`);
      }
    },
    {
      name: `Create RPGLE Program (from local, custom action)`, test: async () => {
        const action = LocalLanguageActions['RPGLE'][0];
        action.type = 'file';
        action.deployFirst = false;
        const uri = helloWorldProject.files![0].localPath!;
        await testHelloWorldProgram(uri, action, currentLibrary);
      }
    },
    {
      name: `Create display file (from local, custom action)`, test: async () => {
        const uri = helloWorldProject.files![2].localPath!;
        const action: Action = {
          command: `CRTDSPF FILE(&CURLIB/&NAME) SRCFILE(&SRCFILE) TEXT('DSPF from local')`,
          environment: `ile`,
          type: `file`,
          name: `Create Display File (CRTDSPF)`,
        };

        const success = await runAction(instance, uri, action, `all`);
        console.log(success);
        assert.ok(success);
      }
    },
    {
      name: `Create Bound RPG Program (from IFS, custom action)`, test: async () => {
        const action: Action = {
          "name": "Create Bound RPG Program (CRTBNDRPG)",
          "command": "CRTBNDRPG PGM(&BUILDLIB/&NAME) SRCSTMF('&FULLPATH') OPTION(*EVENTF) DBGVIEW(*SOURCE) TGTRLS(*CURRENT) TGTCCSID(*JOB)",
          "type": "streamfile",
          "environment": "ile",
          "extensions": [
            "RPGLE",
            "RPG"
          ],
        }
        const uri = getUriFromPath(helloWorldProject.files![0].remotePath!);
        await testHelloWorldProgram(uri, action, currentLibrary);
      }
    },
    {
      name: `Create Bound RPG Program (from member, custom action)`, test: async () => {
        const config = instance.getConfig();
        const content = instance.getContent();
        const connection = instance.getConnection();
        const tempLib = config!.tempLibrary;

        await connection!.runCommand({ command: `ADDPFM FILE(${tempLib}/QRPGLESRC) MBR(HELLO) SRCTYPE(RPGLE)` });
        await content!.uploadMemberContent(tempLib, 'QRPGLESRC', 'HELLO', helloWorldProject.files![0].content.join('\n'));
        const action: Action = {
          "name": "Create Bound RPG Program (CRTBNDRPG)",
          "command": "CRTBNDRPG PGM(&OPENLIB/&OPENMBR) SRCFILE(&OPENLIB/&OPENSPF) OPTION(*EVENTF) DBGVIEW(*SOURCE) TGTRLS(*CURRENT)",
          "type": "member",
          "environment": "ile",
          "extensions": [
            "RPGLE",
            "RPG"
          ],
        };
        const uri = getMemberUri({ library: tempLib, file: 'QRPGLESRC', name: 'HELLO', extension: 'RPGLE' })
        await testHelloWorldProgram(uri, action, tempLib);
      }
    },

    {
      name: `Create Bound RPG Program failure (from member, custom action)`, test: async () => {
        const config = instance.getConfig();
        const content = instance.getContent();
        const connection = instance.getConnection();
        const tempLib = config!.tempLibrary;

        await connection!.runCommand({ command: `ADDPFM FILE(${tempLib}/QRPGLESRC) MBR(THEBADONE) SRCTYPE(RPGLE)` });
        await content!.uploadMemberContent(tempLib, 'QRPGLESRC', 'THEBADONE', helloWorldProject.files![1].content.join('\n'));
        const action: Action = {
          "name": "Create Bound RPG Program (CRTBNDRPG)",
          "command": "CRTBNDRPG PGM(&OPENLIB/&OPENMBR) SRCFILE(&OPENLIB/&OPENSPF) OPTION(*EVENTF) DBGVIEW(*SOURCE) TGTRLS(*CURRENT)",
          "type": "member",
          "environment": "ile",
          "extensions": [
            "RPGLE",
            "RPG"
          ],
        };
        const uri = getMemberUri({ library: tempLib, file: 'QRPGLESRC', name: 'THEBADONE', extension: 'RPGLE' })
        const success = await runAction(instance, uri, action, `all`);
        assert.strictEqual(success, false);
      }
    }
  ]
};

async function testHelloWorldProgram(uri: vscode.Uri, action: Action, library: string) {
  const actionRan = await runAction(instance, uri, action, `all`);
  assert.ok(actionRan);

  const keysToCompare = [`library`, `name`, `type`, `text`, `attribute`, `sourceFile`, `memberCount`];
  const toJSON = (obj: Object) => JSON.stringify(obj, (key, value) => {
    if (keysToCompare.includes(key)) { return value }
  });
  const content = instance.getContent();
  const helloWorldProgram = (await content?.getObjectList({ library: library, object: 'HELLO', types: ['*PGM'] }))![0];
  assert.deepStrictEqual(toJSON(helloWorldProgram), toJSON({
    library: library,
    name: 'HELLO',
    type: '*PGM',
    text: '',
    attribute: 'RPGLE',
    sourceFile: false
  } as IBMiObject));

  const connection = instance.getConnection();
  await connection?.runCommand({ command: `DLTOBJ OBJ(${library}/HELLO) OBJTYPE(*PGM)` });
}
