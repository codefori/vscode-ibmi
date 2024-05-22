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
  },
  '5035': {
    library: '"ｱｲｳｴｵｶｷ"',
    libraryText: 'ｱｲｳｴｵｶｷ',
    object: '"ｱｲｳｴｵｶｷ"',
    objectText: 'ｱｲｳｴｵｶｷ',
    member: '"ｱｲｳｴｵｶｷ"',
    memberType: 'RPGLE',
    memberText: 'ｱｲｳｴｵｶｷ'
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

        // Temporarily update user profile default CCSID
        const [originalUserDefaultCCSID] = await content!.ibmi.runSQL(`select CHARACTER_CODE_SET_ID from table( QSYS2.QSYUSRINFO( USERNAME => upper('${content!.ibmi.currentUser}') ) )`);
        const newCssidRes = await connection!.runCommand({ command: `CHGUSRPRF USRPRF(${content!.ibmi.currentUser}) CCSID(${ccsid})`, noLibList: true });
        const [newUserDefaultCCSID] = await content!.ibmi.runSQL(`select CHARACTER_CODE_SET_ID from table( QSYS2.QSYUSRINFO( USERNAME => upper('${content!.ibmi.currentUser}') ) )`);
        assert.strictEqual(newUserDefaultCCSID.CHARACTER_CODE_SET_ID, Number(ccsid));

        const crtlibRes = await connection!.runCommand({ command: `system 'CRTLIB LIB(${test.library}) TEXT(${test.libraryText})'`, noLibList: true, environment: "pase" });
        const crtsrcpfRes = await connection!.runCommand({ command: `system 'CRTSRCPF FILE(${test.library}/${test.object}) RCDLEN(112) CCSID(${ccsid}) TEXT(${test.objectText})'`, noLibList: true, environment: "pase" });
        const addpfmRes = await connection!.runCommand({ command: `system 'ADDPFM FILE(${test.library}/${test.object}) MBR(${test.member}) SRCTYPE(${test.memberType}) TEXT(${test.memberText})'`, noLibList: true, environment: "pase" });
        const libraries = await content!.getObjectList({ library: test.library, types: ['*LIB']});
        const objects = await content!.getObjectList({ library: test.library, object: test.object });
        const members = await content!.getMemberList({ library: test.library, sourceFile: test.object, members: test.member });
        const dltLib = await connection!.runCommand({ command: `system 'DLTLIB LIB(${test.library})'`, noLibList: true, environment: "pase" });

        // Restore user profile default CCSID
        const restoreCcsidRes = await connection!.runCommand({ command: `CHGUSRPRF USRPRF(${content!.ibmi.currentUser}) CCSID(${originalUserDefaultCCSID.CHARACTER_CODE_SET_ID})`, noLibList: true });

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
