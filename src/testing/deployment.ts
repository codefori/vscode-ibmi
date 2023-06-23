import assert from "assert";
import { randomInt } from "crypto";
import { existsSync } from "fs";
import ignore from "ignore";
import { EOL } from "os";
import { basename, posix } from "path";
import vscode from "vscode";
import { TestSuite } from ".";
import { Tools } from "../api/Tools";
import { Deployment } from "../api/local/deployment";
import { instance } from "../instantiate";
import { DeploymentMethod } from "../typings";

type FileInfo = {
    md5: string
    date: string
}

type FilesInfo = Map<string, FileInfo>;

class File {
    readonly content: string[] = [];
    localPath?: vscode.Uri;
    remotePath?: string;

    constructor(readonly name: string) {
        this.changeContent();

    }

    changeContent() {
        this.content.splice(0, this.content.length);
        for (let line = 0; line < (5 + randomInt(41)); line++) {
            this.content.push(Tools.makeid(10 + randomInt(100)));
        }
    }

    getContent(){
        return this.content.join(EOL);
    }
}

type Folder = {
    name: string
    folders?: Folder[]
    files?: File[]
    localPath?: vscode.Uri
    remotePath?: string;
}

const fakeProject: Folder = {
    name: `DeleteMe_${Tools.makeid()}`,
    folders: [
        { name: "folder1", files: [new File("file11.txt"), new File("file22.txt"), new File("file23.txt")] },
        {
            name: "folder2", files: [new File("file21.txt")], folders: [
                { name: "subfolder21", files: [new File("subfile211.txt"), new File("subfile212.txt")] },
                { name: "subfolder22", files: [new File("subfile221.txt"), new File("subfile222.txt"), new File("subfile223.txt")] }
            ]
        },
        {
            name: "folder3", files: [new File("file31.txt"), new File("file32.txt"), new File("file33.txt"), new File("file34.txt"), new File("file35.txt")], folders: [
                {
                    name: "subfolder32", files: [new File("subfile321.txt")], folders: [
                        { name: "subsubfolder331", files: [new File("subsubfile3311.txt"), new File("subsubfile3312.txt")] },
                        { name: "subsubfolder332", files: [new File("subsubfile3321.txt"), new File("subsubfile3322.txt"), new File("subsubfile3324'.txt"), new File("subsubfile3325.txt")] }
                    ]
                },
            ]
        }
    ],
    files: [
        new File("rootFile1.txt"),
        new File("rootFile2.txt"),
        new File("rootFile3.txt")
    ],
}

export const DeploymentSuite: TestSuite = {
    name: `Deployment tests`,
    before: async () => {
        const features = instance.getConnection()?.remoteFeatures;
        assert.ok(features?.stat, "stat is required to run Deployment test suite");
        assert.ok(features?.md5sum, "md5sum is required to run Deployment test suite");

        const workspaceFolder = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0] : undefined;
        const tempDir = instance.getConfig()?.tempDir;
        assert.ok(workspaceFolder, "No workspace folder to work with");
        assert.ok(tempDir, "Cannot run deployment tests: no remote temp directory defined");

        await createFolder(workspaceFolder.uri, tempDir, fakeProject);
        assert.ok(fakeProject.localPath, "Project has no local path");
        assert.ok(existsSync(fakeProject.localPath.fsPath), "Project local directory does not exist");
    },
    tests: [
        {
            name: `Test 'All' deployment`, test: async () => {
                const locals = await getLocalFilesInfo();
                const remotes = await deploy("all");
                assertFilesInfoEquals(locals, remotes);
            }
        },
        {
            name: `Test 'Compare' deployment`, test: async () => {                
                createFile(fakeProject.localPath!, fakeProject.remotePath!, new File("new1.txt"));
                createFile(fakeProject.folders![0].localPath!, fakeProject.folders![0].remotePath!, new File("newnew1.txt"));
                createFile(fakeProject.folders![1].localPath!, fakeProject.folders![1].remotePath!, new File("newnew2.txt"));
                
                await vscode.workspace.fs.delete(fakeProject.folders![2].files![0].localPath!, { useTrash: false });
                
                await changeFile(fakeProject.files![0]);
                await changeFile(fakeProject.folders![0].files![0]);

                const oldRemotes = await getRemoteFilesInfo();
                const locals = await getLocalFilesInfo();
                const remotes = await deploy("compare");
                assertFilesInfoEquals(locals, remotes);

                let newFiles = 0;
                let changed = 0;                
                let deleted = 0;
                oldRemotes.forEach((oldInfo, file) => {
                    const newInfos = remotes.get(file);
                    if(newInfos && newInfos.date !== oldInfo.date){
                        changed++;
                    }
                    else if(!newInfos){
                        deleted++;
                    }
                });
                
                remotes.forEach((newInfo, file) => {
                    const oldInfo = oldRemotes.get(file);
                    if(!oldInfo){
                        newFiles++;
                    }
                });

                assert.strictEqual(newFiles, 3);
                assert.strictEqual(changed, 2);
                assert.strictEqual(deleted, 1);
            }
        }
    ],
    after: async () => {
        if (fakeProject.localPath && existsSync(fakeProject.localPath.fsPath)) {
            await vscode.workspace.fs.delete(fakeProject.localPath, { recursive: true, useTrash: false });
        }

        if (fakeProject.remotePath && await instance.getContent()?.isDirectory(fakeProject.remotePath)) {
            await instance.getConnection()?.sendCommand({ command: `rm -rf ${fakeProject.remotePath}` })
        }
    },
}

async function deploy(method: DeploymentMethod) {
    assert.ok(fakeProject.localPath, "No local path");
    assert.ok(fakeProject.remotePath, "No remote path");
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(fakeProject.localPath);
    assert.ok(workspaceFolder, "No workspace folder");
    //Deploy only the fake project
    const ignoreRules = ignore().add([
        `*`, //Ignore all
        `!${basename(fakeProject.localPath.path)}/`, //Allow directory (required)
        `!${basename(fakeProject.localPath.path)}/**` //Allow content
    ]);

    assert.ok(await Deployment.deploy({ method, remotePath: fakeProject.remotePath, workspaceFolder, ignoreRules }), `"${method}" deployment failed`);
    return await getRemoteFilesInfo();
}

async function createFolder(parent: vscode.Uri, remoteParent: string, folder: Folder) {
    folder.localPath = vscode.Uri.joinPath(parent, folder.name);
    folder.remotePath = posix.join(remoteParent, folder.name);
    await vscode.workspace.fs.createDirectory(folder.localPath);

    for (const file of folder.files || []) {
        await createFile(folder.localPath!, folder.remotePath!, file);
    }

    for (const childFolder of folder.folders || []) {
        await createFolder(folder.localPath!, folder.remotePath!, childFolder);
    }
}

async function createFile(folder: vscode.Uri, remote: string, file: File): Promise<void> {
    file.localPath = vscode.Uri.joinPath(folder, file.name);
    file.remotePath = posix.join(remote, file.name);
    await vscode.workspace.fs.writeFile(file.localPath, Buffer.from(file.content));
}

async function changeFile(file : File){
    file.changeContent();
    await vscode.workspace.fs.writeFile(file.localPath!, Buffer.from(file.content));
}

async function getLocalFilesInfo() {
    const localFiles: FilesInfo = new Map;
    for await (const file of await vscode.workspace.findFiles(new vscode.RelativePattern(fakeProject.localPath!, "**/*"))) {
        const path = posix.join(basename(fakeProject.localPath!.path), posix.relative(fakeProject.localPath!.path, file.path));
        localFiles.set(path, { date: "unused", md5: Tools.md5Hash(file) });
    }
    return localFiles;
}

async function getRemoteFilesInfo() {
    const remoteFiles: FilesInfo = new Map;

    //Get dates
    const stat = (await instance.getConnection()?.sendCommand({
        directory: fakeProject.remotePath,
        command: `find . -type f -exec ${instance.getConnection()?.remoteFeatures.stat} '{}' --printf="%n %s\\n" \\;`
    }));
    assert.strictEqual(0, stat?.code, "Remote stat call failed");
    stat?.stdout.split("\n")
        .map(line => line.split(" "))
        .forEach(([file, date]) => remoteFiles.set(file.substring(2), { date, md5: "" }));

    //Get md5 sums
    const md5sum = (await instance.getConnection()?.sendCommand({
        directory: fakeProject.remotePath,
        command: `${instance.getConnection()?.remoteFeatures.md5sum} $(find . -type f);`
    }));
    assert.strictEqual(0, md5sum?.code, "Remote md5sum call failed");
    md5sum?.stdout.split("\n")
        .map(line => line.split(/\s+/))
        .forEach(([md5, file]) => remoteFiles.get(file.substring(2))!.md5 = md5);

    return remoteFiles;
}

function assertFilesInfoEquals(locals: FilesInfo, remotes: FilesInfo) {
    assert.strictEqual(locals.size, remotes.size, `Local (${locals.size}) and remote (${remotes.size}) files counts don't match`);
    locals.forEach((info, file) => {
        const remoteFile = remotes.get(file);
        assert.ok(remoteFile, "Local file not found in remote files list");
        assert.strictEqual(info.md5, remoteFile.md5, "Remote file hash doesn't match local's");
    });
}