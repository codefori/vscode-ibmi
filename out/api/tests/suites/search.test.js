"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const Filter_1 = require("../../Filter");
const Search_1 = require("../../Search");
const Tools_1 = require("../../Tools");
const connection_1 = require("../connection");
(0, vitest_1.describe)('Search Tests', { concurrent: true }, () => {
    let connection;
    (0, vitest_1.beforeAll)(async () => {
        connection = await (0, connection_1.newConnection)();
    }, connection_1.CONNECTION_TIMEOUT);
    (0, vitest_1.afterAll)(async () => {
        await (0, connection_1.disposeConnection)(connection);
    });
    (0, vitest_1.it)('Single member search', async () => {
        const result = await Search_1.Search.searchMembers(connection, "QSYSINC", "QRPGLESRC", "IBM", "CMRPG");
        (0, vitest_1.expect)(result.term).toBe("IBM");
        (0, vitest_1.expect)(result.hits.length).toBe(1);
        const [hit] = result.hits;
        (0, vitest_1.expect)(hit.lines.length).toBe(3);
        const checkLine = (index, expectedNumber) => {
            (0, vitest_1.expect)(hit.lines[index].number).toBe(expectedNumber);
            (0, vitest_1.expect)(hit.lines[index].content).toContain(result.term);
        };
        checkLine(0, 7);
        checkLine(1, 11);
        checkLine(2, 13);
    });
    (0, vitest_1.it)('Generic name search', async () => {
        const memberFilter = "E*";
        const filter = (0, Filter_1.parseFilter)(memberFilter);
        const result = await Search_1.Search.searchMembers(connection, "QSYSINC", "QRPGLESRC", "IBM", memberFilter);
        (0, vitest_1.expect)(result.hits.every(hit => filter.test(hit.path.split("/").at(-1)))).toBe(true);
        (0, vitest_1.expect)(result.hits.every(hit => !hit.path.endsWith(`MBR`))).toBe(true);
    });
    (0, vitest_1.it)('Filtered members list search', async () => {
        const library = "QSYSINC";
        const sourceFile = "QRPGLESRC";
        const memberFilter = "S*,T*";
        const filter = (0, Filter_1.parseFilter)(memberFilter);
        const checkNames = (names) => names.every(filter.test);
        const members = await connection.getContent().getMemberList({ library, sourceFile, members: memberFilter });
        (0, vitest_1.expect)(checkNames(members.map(member => member.name))).toBe(true);
        const result = await Search_1.Search.searchMembers(connection, "QSYSINC", "QRPGLESRC", "SQL", members);
        (0, vitest_1.expect)(result.hits.length).toBe(6);
        (0, vitest_1.expect)(checkNames(result.hits.map(hit => hit.path.split("/").at(-1)))).toBe(true);
        (0, vitest_1.expect)(result.hits.every(hit => !hit.path.endsWith(`MBR`))).toBe(true);
    }),
        (0, vitest_1.it)('Member with `.` in name search', async () => {
            const library = connection.getConfig().tempLibrary;
            const file = connection.upperCaseName(`ZZ${Tools_1.Tools.makeid(6)}`);
            const crtsrcpf = await connection.runCommand({ command: `CRTSRCPF FILE(${library}/${file}) RCDLEN(112)`, noLibList: true });
            if (crtsrcpf.code !== 0) {
                throw new Error(`Failed to create test source file: ${crtsrcpf.stderr}`);
            }
            try {
                const members = [
                    { name: "AN.RPGLE", type: "RPGLE", content: ["Some random text", "nobody will read", "but that's for testing"] },
                    { name: "A.CLLE", type: "CLLE", content: ["More random text", "testing is fun", "or so they say"] },
                    { name: "A.CMD", type: "CMD", content: ["This is not valid for a command", "this is for a test", "so I guess it's fine"] }
                ];
                for (const member of members) {
                    const addpfm = await connection.runCommand({ command: `ADDPFM FILE(${library}/${file}) MBR(${member.name}) SRCTYPE(${member.type})`, noLibList: true });
                    if (addpfm.code !== 0) {
                        throw new Error(`Failed to add test member: ${addpfm.stderr}`);
                    }
                    await connection.getContent().uploadMemberContent(library, file, member.name, member.content.join("\n"));
                }
                const hasMember = (results, member) => results.hits.map(hit => hit.path.split('/').pop()).includes(member);
                const searchTest = await Search_1.Search.searchMembers(connection, library, file, "test", '*');
                (0, vitest_1.expect)(searchTest.hits.length).toBe(3);
                (0, vitest_1.expect)(hasMember(searchTest, "AN.RPGLE.RPGLE")).toBe(true);
                (0, vitest_1.expect)(hasMember(searchTest, "A.CLLE.CLLE")).toBe(true);
                (0, vitest_1.expect)(hasMember(searchTest, "A.CMD.CMD")).toBe(true);
                const searchTesting = await Search_1.Search.searchMembers(connection, library, file, "testing", '*');
                (0, vitest_1.expect)(searchTesting.hits.length).toBe(2);
                (0, vitest_1.expect)(hasMember(searchTesting, "AN.RPGLE.RPGLE")).toBe(true);
                (0, vitest_1.expect)(hasMember(searchTesting, "A.CLLE.CLLE")).toBe(true);
                (0, vitest_1.expect)(hasMember(searchTesting, "A.CMD.CMD")).toBe(false);
            }
            finally {
                await connection.runCommand({ command: `DLTF FILE(${library}/${file})`, noLibList: true });
            }
        });
    (0, vitest_1.it)('Filtered members list search', async () => {
        const pfgrep = connection.remoteFeatures.pfgrep;
        // This test only needs to run if pfgrep is installed
        if (pfgrep) {
            const resultPfgrep = await Search_1.Search.searchMembers(connection, "QSYSINC", "QRPGLESRC", "IBM", "CMRPG");
            connection.remoteFeatures.pfgrep = undefined;
            const resultQsh = await Search_1.Search.searchMembers(connection, "QSYSINC", "QRPGLESRC", "IBM", "CMRPG");
            connection.remoteFeatures.pfgrep = pfgrep;
            // XXX: Do a deep equals here (without having to reimplement one)
            (0, vitest_1.expect)(resultPfgrep.hits[0].lines[0] == resultQsh.hits[0].lines[0]);
        }
        else {
            (0, vitest_1.expect)(true);
        }
    });
});
//# sourceMappingURL=search.test.js.map