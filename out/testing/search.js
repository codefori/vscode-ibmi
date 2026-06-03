"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SearchSuite = void 0;
const assert_1 = __importDefault(require("assert"));
const Filter_1 = require("../api/Filter");
const Search_1 = require("../api/Search");
const instantiate_1 = require("../instantiate");
exports.SearchSuite = {
    name: `Search API tests`,
    tests: [
        {
            name: "Single member search", test: async () => {
                const connection = instantiate_1.instance.getConnection();
                const result = await Search_1.Search.searchMembers(connection, "QSYSINC", "QRPGLESRC", "IBM", "CMRPG");
                assert_1.default.strictEqual(result.term, "IBM");
                assert_1.default.strictEqual(result.hits.length, 1);
                const [hit] = result.hits;
                assert_1.default.strictEqual(hit.lines.length, 3);
                const checkLine = (index, expectedNumber) => {
                    assert_1.default.strictEqual(hit.lines[index].number, expectedNumber);
                    assert_1.default.ok(hit.lines[index].content.includes(result.term));
                };
                checkLine(0, 7);
                checkLine(1, 11);
                checkLine(2, 13);
            }
        },
        {
            name: "Generic name search", test: async () => {
                const connection = instantiate_1.instance.getConnection();
                const memberFilter = "E*";
                const filter = (0, Filter_1.parseFilter)(memberFilter);
                const result = await Search_1.Search.searchMembers(connection, "QSYSINC", "QRPGLESRC", "IBM", memberFilter);
                assert_1.default.ok(result.hits.every(hit => filter.test(hit.path.split("/").at(-1))));
                assert_1.default.ok(result.hits.every(hit => !hit.path.endsWith(`MBR`)));
            }
        },
        {
            name: "Filtered members list search", test: async () => {
                const connection = instantiate_1.instance.getConnection();
                const library = "QSYSINC";
                const sourceFile = "QRPGLESRC";
                // Be stricter in the filter to try to make sure we have six results
                const memberFilter = "SQL*,T*";
                const filter = (0, Filter_1.parseFilter)(memberFilter);
                const checkNames = (names) => names.every(filter.test);
                const members = await getConnection().getContent().getMemberList({ library, sourceFile, members: memberFilter });
                assert_1.default.ok(checkNames(members.map(member => member.name)));
                const result = await Search_1.Search.searchMembers(connection, "QSYSINC", "QRPGLESRC", "SQL", members);
                assert_1.default.strictEqual(result.hits.length, 6);
                assert_1.default.ok(checkNames(result.hits.map(hit => hit.path.split("/").at(-1))));
                assert_1.default.ok(result.hits.every(hit => !hit.path.endsWith(`MBR`)));
            }
        },
        {
            name: "pfgrep vs. qsh grep equivalency", test: async () => {
                const connection = instantiate_1.instance.getConnection();
                const pfgrep = connection.remoteFeatures.pfgrep;
                // This test only needs to run if pfgrep is installed
                if (pfgrep) {
                    const resultPfgrep = await Search_1.Search.searchMembers(connection, "QSYSINC", "QRPGLESRC", "IBM", "CMRPG");
                    getConnection().remoteFeatures.pfgrep = undefined;
                    const resultQsh = await Search_1.Search.searchMembers(connection, "QSYSINC", "QRPGLESRC", "IBM", "CMRPG");
                    getConnection().remoteFeatures.pfgrep = pfgrep;
                    assert_1.default.deepEqual(resultPfgrep, resultQsh);
                }
                else {
                    assert_1.default.ok(true);
                }
            }
        }
    ]
};
function getConnection() {
    const connection = instantiate_1.instance.getConnection();
    if (!connection) {
        throw Error("Cannot run test: no connection");
    }
    return connection;
}
//# sourceMappingURL=search.js.map