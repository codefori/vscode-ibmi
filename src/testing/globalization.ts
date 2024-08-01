import assert from "assert";
import { TestSuite } from ".";
import { instance } from "../instantiate";

const testData = {
  '273': {
    library: '"AÜ§#$%Ä"',
    libraryText: '"§#$öße"',
    object: '"àáãÄ£ø"',
    objectText: '"Üä$öß"',
    member: '"§#$MAN"',
    memberText: '"§#$öße"',
    memberType: 'CBLLE'
  }
}

export const GlobalizationSuite: TestSuite = {
  name: `Globalization tests`,

  tests: Object.keys(testData).map(ccsid => {
    return {
      name: `CCSID ${ccsid}`, test: async () => {
        const connection = instance.getConnection();
        const content = instance.getContent();
        const test = testData[ccsid as keyof typeof testData];

        const crtlibRes = await connection!.runCommand({ command: `CRTLIB LIB(${test.library}) TEXT(${test.libraryText})`, noLibList: true, environment: "ile" });
        const crtsrcpfRes = await connection!.runCommand({ command: `CRTSRCPF FILE(${test.library}/${test.object}) RCDLEN(112) CCSID(${ccsid}) TEXT(${test.objectText})`, noLibList: true, environment: "ile" });
        const addpfmRes = await connection!.runCommand({ command: `ADDPFM FILE(${test.library}/${test.object}) MBR(${test.member}) SRCTYPE(${test.memberType}) TEXT(${test.memberText})`, noLibList: true, environment: "ile" });
        const libraries = await content!.getObjectList({ library: test.library, types: ['*LIB']});
        const objects = await content!.getObjectList({ library: test.library, object: test.object });
        const members = await content!.getMemberList({ library: test.library, sourceFile: test.object, members: test.member });
        const dltLib = await connection!.runCommand({ command: `DLTLIB LIB(${test.library})`, noLibList: true, environment: "ile" });

        assert.strictEqual(libraries.length, 1);
        assert.strictEqual(libraries[0].library, test.library);
        assert.strictEqual(libraries[0].text, test.libraryText);
        assert.strictEqual(objects.length, 1);
        assert.strictEqual(objects[0].name, test.object);
        assert.strictEqual(objects[0].text, test.objectText);
        assert.strictEqual(members.length, 1);
        assert.strictEqual(members[0].name, test.member);
        assert.strictEqual(members[0].text, test.memberText);
      }
    }
  })
};
