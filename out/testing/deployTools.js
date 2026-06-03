"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createFolder = exports.DeployToolsSuite = exports.fakeProject = exports.File = void 0;
const assert_1 = __importDefault(require("assert"));
const crypto_1 = require("crypto");
const fs_1 = require("fs");
const ignore_1 = __importDefault(require("ignore"));
const os_1 = require("os");
const path_1 = require("path");
const vscode_1 = __importDefault(require("vscode"));
const Tools_1 = require("../api/Tools");
const deployTools_1 = require("../filesystems/local/deployTools");
const instantiate_1 = require("../instantiate");
const Tools_2 = require("../ui/Tools");
const actions_1 = require("../ui/actions");
class File {
    name;
    content = [];
    localPath;
    remotePath;
    constructor(name, content) {
        this.name = name;
        if (content) {
            this.content = content;
        }
        else {
            this.changeContent();
        }
    }
    changeContent() {
        this.content.splice(0, this.content.length);
        for (let line = 0; line < (5 + (0, crypto_1.randomInt)(41)); line++) {
            this.content.push(Tools_1.Tools.makeid(10 + (0, crypto_1.randomInt)(100)));
        }
    }
    getContent() {
        return this.content.join(os_1.EOL);
    }
}
exports.File = File;
exports.fakeProject = {
    name: `DeleteMe_${Tools_1.Tools.makeid()}`,
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
};
exports.DeployToolsSuite = {
    name: `Deploy Tools API tests`,
    notConcurrent: true,
    before: async () => {
        const features = instantiate_1.instance.getConnection()?.remoteFeatures;
        assert_1.default.ok(features?.stat, "stat is required to run deploy tools test suite");
        assert_1.default.ok(features?.md5sum, "md5sum is required to run deploy tools test suite");
        const workspaceFolder = vscode_1.default.workspace.workspaceFolders ? vscode_1.default.workspace.workspaceFolders[0] : undefined;
        const tempDir = instantiate_1.instance.getConnection()?.getConfig().tempDir;
        assert_1.default.ok(workspaceFolder, "No workspace folder to work with");
        assert_1.default.ok(tempDir, "Cannot run deploy tools tests: no remote temp directory defined");
        await createFolder(workspaceFolder.uri, tempDir, exports.fakeProject);
        assert_1.default.ok(exports.fakeProject.localPath, "Project has no local path");
        assert_1.default.ok((0, fs_1.existsSync)(exports.fakeProject.localPath.fsPath), "Project local directory does not exist");
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
                createFile(exports.fakeProject.localPath, exports.fakeProject.remotePath, new File("new1.txt"));
                createFile(exports.fakeProject.folders[0].localPath, exports.fakeProject.folders[0].remotePath, new File("newnew1.txt"));
                createFile(exports.fakeProject.folders[1].localPath, exports.fakeProject.folders[1].remotePath, new File("newnew2.txt"));
                await vscode_1.default.workspace.fs.delete(exports.fakeProject.folders[2].files[0].localPath, { useTrash: false });
                await changeFile(exports.fakeProject.files[0]);
                await changeFile(exports.fakeProject.folders[0].files[0]);
                const oldRemotes = await getRemoteFilesInfo();
                const locals = await getLocalFilesInfo();
                const remotes = await deploy("compare");
                assertFilesInfoEquals(locals, remotes);
                let newFiles = 0;
                let changed = 0;
                let deleted = 0;
                oldRemotes.forEach((oldInfo, file) => {
                    const newInfos = remotes.get(file);
                    if (newInfos && newInfos.date !== oldInfo.date) {
                        changed++;
                    }
                    else if (!newInfos) {
                        deleted++;
                    }
                });
                remotes.forEach((newInfo, file) => {
                    const oldInfo = oldRemotes.get(file);
                    if (!oldInfo) {
                        newFiles++;
                    }
                });
                assert_1.default.strictEqual(newFiles, 3);
                assert_1.default.strictEqual(changed, 2);
                assert_1.default.strictEqual(deleted, 1);
            }
        },
        {
            name: `postDownload test`, test: async () => {
                const action = {
                    "name": "postDownload test",
                    "command": "echo 'hello world' > hello.txt && mkdir -p random && echo 'random' > random/random.txt",
                    "environment": "pase",
                    "postDownload": [
                        "hello.txt",
                        "random/"
                    ],
                    "type": "file",
                    "extensions": [
                        "GLOBAL"
                    ]
                };
                await (0, actions_1.runAction)(instantiate_1.instance, vscode_1.default.Uri.joinPath(exports.fakeProject.localPath, "hello.txt"), action);
                const localRoot = vscode_1.default.workspace.getWorkspaceFolder(exports.fakeProject.localPath)?.uri;
                assert_1.default.ok(localRoot, "No workspace folder");
                assert_1.default.ok((0, fs_1.existsSync)(vscode_1.default.Uri.joinPath(localRoot, `random`, `random.txt`).fsPath));
                assert_1.default.ok((0, fs_1.existsSync)(vscode_1.default.Uri.joinPath(localRoot, "hello.txt").fsPath));
            }
        },
        {
            name: `Test .deployignore`, test: async () => {
                const workspace = vscode_1.default.workspace.workspaceFolders[0];
                const getRootFile = (name) => vscode_1.default.Uri.joinPath(workspace.uri, name);
                const prepare = async (name, rollback) => {
                    const file = getRootFile(rollback ? `${name}_backup` : name);
                    if ((0, fs_1.existsSync)(file.fsPath)) {
                        await vscode_1.default.workspace.fs.rename(file, getRootFile(rollback ? name : `${name}_backup`), { overwrite: true });
                    }
                    return file;
                };
                try {
                    const toIgnore = ["ignore1", "ignore2", "ignore3", "ignore4", ".gitignore", ".deployignore", ".notignored"];
                    const deployignore = await prepare(".deployignore");
                    vscode_1.default.workspace.fs.writeFile(deployignore, Buffer.from("**/ignore2\n**/ignore4"));
                    const ignoreDeploy = await deployTools_1.DeployTools.getDefaultIgnoreRules(workspace);
                    assert_1.default.strictEqual(ignoreDeploy.filter(toIgnore).join(","), "ignore1,ignore3,.notignored");
                    await vscode_1.default.workspace.fs.delete(deployignore);
                    const gitignore = await prepare(".gitignore");
                    await vscode_1.default.workspace.fs.writeFile(gitignore, Buffer.from("**/ignore1\n**/ignore3"));
                    const ignoreGit = await deployTools_1.DeployTools.getDefaultIgnoreRules(workspace);
                    assert_1.default.strictEqual(ignoreGit.filter(toIgnore).join(","), "ignore2,ignore4,.notignored");
                }
                finally {
                    await prepare(".gitignore", true);
                    await prepare(".deployignore", true);
                }
            }
        },
    ],
    after: async () => {
        if (exports.fakeProject.localPath && (0, fs_1.existsSync)(exports.fakeProject.localPath.fsPath)) {
            await vscode_1.default.workspace.fs.delete(exports.fakeProject.localPath, { recursive: true, useTrash: false });
        }
        if (exports.fakeProject.remotePath && await instantiate_1.instance.getConnection()?.getContent().isDirectory(exports.fakeProject.remotePath)) {
            await instantiate_1.instance.getConnection()?.sendCommand({ command: `rm -rf ${exports.fakeProject.remotePath}` });
        }
    },
};
async function deploy(method) {
    assert_1.default.ok(exports.fakeProject.localPath, "No local path");
    assert_1.default.ok(exports.fakeProject.remotePath, "No remote path");
    const workspaceFolder = vscode_1.default.workspace.getWorkspaceFolder(exports.fakeProject.localPath);
    assert_1.default.ok(workspaceFolder, "No workspace folder");
    //Deploy only the fake project
    const ignoreRules = (0, ignore_1.default)().add([
        `*`,
        `!${(0, path_1.basename)(exports.fakeProject.localPath.path)}/`,
        `!${(0, path_1.basename)(exports.fakeProject.localPath.path)}/**` //Allow content
    ]);
    assert_1.default.ok(await deployTools_1.DeployTools.deploy({ method, remotePath: exports.fakeProject.remotePath, workspaceFolder, ignoreRules }), `"${method}" deployment failed`);
    return await getRemoteFilesInfo();
}
async function createFolder(parent, remoteParent, folder) {
    folder.localPath = vscode_1.default.Uri.joinPath(parent, folder.name);
    folder.remotePath = path_1.posix.join(remoteParent, folder.name);
    await vscode_1.default.workspace.fs.createDirectory(folder.localPath);
    for (const file of folder.files || []) {
        await createFile(folder.localPath, folder.remotePath, file);
    }
    for (const childFolder of folder.folders || []) {
        await createFolder(folder.localPath, folder.remotePath, childFolder);
    }
}
exports.createFolder = createFolder;
async function createFile(folder, remote, file) {
    file.localPath = vscode_1.default.Uri.joinPath(folder, file.name);
    file.remotePath = path_1.posix.join(remote, file.name);
    await vscode_1.default.workspace.fs.writeFile(file.localPath, Buffer.from(file.content.join(('\n')), `utf-8`));
}
async function changeFile(file) {
    file.changeContent();
    await vscode_1.default.workspace.fs.writeFile(file.localPath, Buffer.from(file.content.join(('\n')), `utf-8`));
}
async function getLocalFilesInfo() {
    const localFiles = new Map;
    for await (const file of await vscode_1.default.workspace.findFiles(new vscode_1.default.RelativePattern(exports.fakeProject.localPath, "**/*"))) {
        const path = path_1.posix.join((0, path_1.basename)(exports.fakeProject.localPath.path), path_1.posix.relative(exports.fakeProject.localPath.path, file.path));
        localFiles.set(path, { date: "unused", md5: Tools_2.VscodeTools.md5Hash(file) });
    }
    return localFiles;
}
async function getRemoteFilesInfo() {
    const remoteFiles = new Map;
    //Get dates
    const stat = (await instantiate_1.instance.getConnection()?.sendCommand({
        directory: exports.fakeProject.remotePath,
        command: `find . -type f -exec ${instantiate_1.instance.getConnection()?.remoteFeatures.stat} '{}' --printf="%n %s\\n" \\;`
    }));
    assert_1.default.strictEqual(0, stat?.code, "Remote stat call failed");
    stat?.stdout.split("\n")
        .map(line => line.split(" "))
        .forEach(([file, date]) => remoteFiles.set(file.substring(2), { date, md5: "" }));
    //Get md5 sums
    const md5sum = (await instantiate_1.instance.getConnection()?.sendCommand({
        directory: exports.fakeProject.remotePath,
        command: `${instantiate_1.instance.getConnection()?.remoteFeatures.md5sum} $(find . -type f);`
    }));
    assert_1.default.strictEqual(0, md5sum?.code, "Remote md5sum call failed");
    md5sum?.stdout.split("\n")
        .map(line => line.split(/\s+/))
        .forEach(([md5, file]) => remoteFiles.get(file.substring(2)).md5 = md5);
    return remoteFiles;
}
function assertFilesInfoEquals(locals, remotes) {
    assert_1.default.strictEqual(locals.size, remotes.size, `Local (${locals.size}) and remote (${remotes.size}) files counts don't match`);
    locals.forEach((info, file) => {
        const remoteFile = remotes.get(file);
        assert_1.default.ok(remoteFile, "Local file not found in remote files list");
        assert_1.default.strictEqual(info.md5, remoteFile.md5, "Remote file hash doesn't match local's");
    });
}
//# sourceMappingURL=deployTools.js.map