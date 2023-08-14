import assert from "assert";
import { existsSync } from "fs";
import { TestSuite } from ".";
import { CompileTools } from "../api/CompileTools";
import { instance } from "../instantiate";
import vscode from "vscode";
import { File, Folder, createFolder } from "./deployTools";
import { Tools } from "../api/Tools";
import { LocalLanguageActions } from "../api/local/LocalLanguageActions";
import { DeployTools } from "../api/local/deployTools";
import { getEnvConfig } from "../api/local/env";

export const helloWorldProject: Folder = {
  name: `DeleteMe_${Tools.makeid()}`,
  files: [
    new File("hello.pgm.rpgle", ['**free', 'dsply \'Hello World\';', 'return;'])
  ],
}

let currentLibrary: string;

export const ActionSuite: TestSuite = {
  name: `Action tests`,
  before: async () => {
    const workspaceFolder = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0] : undefined;
    const tempDir = instance.getConfig()?.tempDir;
    assert.ok(workspaceFolder, "No workspace folder to work with");
    assert.ok(tempDir, "Cannot run deploy tools tests: no remote temp directory defined");

    await createFolder(workspaceFolder.uri, tempDir, helloWorldProject);
    assert.ok(helloWorldProject.localPath, "Project has no local path");
    assert.ok(existsSync(helloWorldProject.localPath.fsPath), "Project local directory does not exist");

    const connection = instance.getConnection();
    const tempDeployLocation = connection?.getTempRemote(`/some/dir`);
    DeployTools.setDeployLocation({ path: tempDeployLocation }, workspaceFolder);

    const config = instance.getConfig();
    const envFileVars = await getEnvConfig(workspaceFolder);
    currentLibrary = envFileVars['CURLIB'] ? envFileVars['CURLIB'] : config!.currentLibrary;
  },
  tests: [
    {
      name: `Create RPGLE Program (from local, custom action)`, test: async () => {
        const action = LocalLanguageActions['RPGLE'][0];
        action.type = 'file';
        await CompileTools.runAction(instance, helloWorldProject.files![0].localPath!, action, 'all');

        const content = instance.getContent();
        const helloWorldProgram = (await content?.getObjectList({ library: currentLibrary, object: 'HELLO', types: ['*PGM'] }))![0];
        assert.deepStrictEqual(helloWorldProgram, {
          library: currentLibrary,
          name: 'HELLO',
          type: '*PGM',
          text: '',
          attribute: 'RPGLE'
        });

        const connection = instance.getConnection();
        await connection?.runCommand({ command: `DLTOBJ OBJ(${currentLibrary}/HELLO) OBJTYPE(*PGM)` });
      }
    }
  ]
};
