import assert from "assert";
import { TestSuite } from ".";
import { parseFilter } from "../api/Filter";
import { Search } from "../api/Search";
import { instance } from "../instantiate";

export const SearchSuite: TestSuite = {
  name: `Search API tests`,
  tests: [
    {
      name: "Single member search", test: async () => {
        const result = await Search.searchMembers(instance, "QSYSINC", "QRPGLESRC", "IBM", "CMRPG");
        assert.strictEqual(result.term, "IBM");
        assert.strictEqual(result.hits.length, 1);
        const [hit] = result.hits;
        assert.strictEqual(hit.lines.length, 3);

        const checkLine = (index: number, expectedNumber: number) => {
          assert.strictEqual(hit.lines[index].number, expectedNumber);
          assert.ok(hit.lines[index].content.includes(result.term));
        }

        checkLine(0, 7);
        checkLine(1, 11);
        checkLine(2, 13);
      }
    },
    {
      name: "Generic name search", test: async () => {
        const memberFilter = "E*";
        const filter = parseFilter(memberFilter);
        const result = await Search.searchMembers(instance, "QSYSINC", "QRPGLESRC", "IBM", memberFilter);
        assert.ok(result.hits.every(hit => filter.test(hit.path.split("/").at(-1)!)));
      }
    },
    {
      name: "Filtered members list search", test: async () => {
        const library = "QSYSINC";
        const sourceFile = "QRPGLESRC";
        const memberFilter = "S*,T*";
        const filter = parseFilter(memberFilter);
        const checkNames = (names: string[]) => names.every(filter.test);

        const members = await getConnection().content.getMemberList({ library, sourceFile, members: memberFilter });
        checkNames(members.map(member => member.name));

        const result = await Search.searchMembers(instance, "QSYSINC", "QRPGLESRC", "SQL", members);
        assert.strictEqual(result.hits.length, 6);
        checkNames(result.hits.map(hit => hit.path.split("/").at(-1)!));
      }
    }
  ]
}

function getConnection() {
  const connection = instance.getConnection();
  if (!connection) {
    throw Error("Cannot run test: no connection")
  }
  return connection;
}