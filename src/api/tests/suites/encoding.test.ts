import path from "path";
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import IBMi from "../../IBMi";
import { Tools } from "../../Tools";
import { IBMiObject } from "../../types";
import { CONNECTION_TIMEOUT, disposeConnection, newConnection } from "../connection";

const contents = {
  '37': [`Hello world`],
  '273': [`Hello world`, `àáãÄÜö£øß`],
  '277': [`Hello world`, `çñßØ¢åæ`],
  '297': [`Hello world`, `âÑéè¥ýÝÞã`],
  '290': [`ｦｯ!ﾓﾄｴﾜﾈﾁｾ`, `Hello world`, `ｦｯ!ﾓﾄｴﾜﾈﾁｾ`],
  '420': [`Hello world`, `ص ث ب`],
}

const SHELL_CHARS = [`$`, `#`];

async function runCommandsWithCCSID(connection: IBMi, commands: string[], ccsid: number) {
  const testPgmSrcFile = Tools.makeid(6).toUpperCase();
  const config = connection.getConfig();

  const tempLib = config.tempLibrary;
  const testPgmName = `T${commands.length}${ccsid}${Tools.makeid(2)}`.toUpperCase();

  await connection.runCommand({ command: `DLTOBJ OBJ(${tempLib}/${testPgmSrcFile}) OBJTYPE(*FILE)`, noLibList: true });
  await connection.runCommand({ command: `DLTOBJ OBJ(${tempLib}/${testPgmName}) OBJTYPE(*PGM)`, noLibList: true });

  const sourceFileCreated = await connection!.runCommand({ command: `CRTSRCPF FILE(${tempLib}/${testPgmSrcFile}) RCDLEN(112) CCSID(${ccsid})`, noLibList: true });

  await connection.getContent().uploadMemberContent(tempLib, testPgmSrcFile, testPgmName, commands.join(`\n`));

  const compileCommand = `CRTBNDCL PGM(${tempLib}/${testPgmName}) SRCFILE(${tempLib}/${testPgmSrcFile}) SRCMBR(${testPgmName}) REPLACE(*YES)`;
  const compileResult = await connection.runCommand({ command: compileCommand, noLibList: true });

  if (compileResult.code !== 0) {
    return compileResult;
  }

  const callCommand = `CALL ${tempLib}/${testPgmName}`;
  const result = await connection.runCommand({ command: callCommand, noLibList: true });

  return result;
}

describe('Encoding tests', { concurrent: true }, () => {
  let connection: IBMi
  beforeAll(async () => {
    connection = await newConnection();
  }, CONNECTION_TIMEOUT)

  afterAll(async () => {
    disposeConnection(connection);
  });

  it('Prove that input strings are messed up by CCSID', { timeout: 40000 }, async () => {
    let howManyTimesItMessedUpTheResult = 0;

    for (const strCcsid in contents) {
      const data = contents[strCcsid as keyof typeof contents].join(``);

      const sqlA = `select ? as THEDATA from sysibm.sysdummy1`;
      const resultA = await connection?.runSQL(sqlA, { fakeBindings: [data], forceSafe: true });
      expect(resultA?.length).toBeTruthy();

      const sqlB = `select '${data}' as THEDATA from sysibm.sysdummy1`;
      const resultB = await connection?.runSQL(sqlB, { forceSafe: true });
      expect(resultB?.length).toBeTruthy();

      expect(resultA![0].THEDATA).toBe(data);
      if (resultB![0].THEDATA !== data) {
        howManyTimesItMessedUpTheResult++;
      }
    }

    expect(howManyTimesItMessedUpTheResult).toBeTruthy();
  });

  it('Compare Unicode to EBCDIC successfully', async () => {

    const sql = `select table_name, table_owner from qsys2.systables where table_schema = ? and table_name = ?`;
    const result = await connection?.runSQL(sql, { fakeBindings: [`QSYS2`, `SYSCOLUMNS`] });
    expect(result?.length).toBeTruthy();
  });

  it('Run variants through shells', async () => {
    const text = `Hello${connection?.variantChars.local}world`;
    const basicCommandA = `echo "${IBMi.escapeForShell(text)}"`;
    const basicCommandB = `echo '${text}'`;
    const basicCommandC = `echo 'abc'\\''123'`;
    const printEscapeChar = `echo "\\\\"`;
    const setCommand = `set`;

    const setResult = await connection?.sendQsh({ command: setCommand });

    const qshEscapeResult = await connection?.sendQsh({ command: printEscapeChar });
    const paseEscapeResult = await connection?.sendCommand({ command: printEscapeChar });

    console.log(qshEscapeResult?.stdout);
    console.log(paseEscapeResult?.stdout);

    const qshTextResultA = await connection?.sendQsh({ command: basicCommandA });
    const paseTextResultA = await connection?.sendCommand({ command: basicCommandA });

    const qshTextResultB = await connection?.sendQsh({ command: basicCommandB });
    const paseTextResultB = await connection?.sendCommand({ command: basicCommandB });

    const qshTextResultC = await connection?.sendQsh({ command: basicCommandC });
    const paseTextResultC = await connection?.sendCommand({ command: basicCommandC });

    expect(paseEscapeResult?.stdout).toBe(`\\`);
    expect(qshTextResultA?.stdout).toBe(text);
    expect(paseTextResultA?.stdout).toBe(text);
    expect(qshTextResultB?.stdout).toBe(text);
    expect(paseTextResultB?.stdout).toBe(text);
  }, { timeout: 25000 });

  it('streamfileResolve with dollar', async () => {
    await connection.withTempDirectory(async tempDir => {
      const tempFile = path.posix.join(tempDir, `$hello`);
      await connection.getContent().createStreamFile(tempFile);

      const resolved = await connection.getContent().streamfileResolve([tempFile], [`/`]);

      expect(resolved).toBe(tempFile);
    });
  });

  SHELL_CHARS.forEach(char => {
    it(`Test streamfiles with shell character ${char}`, async () => {
      const nameCombos = [`${char}ABC`, `ABC${char}`, `${char}ABC${char}`, `A${char}C`];

      await connection.withTempDirectory(async tempDir => {
        for (const name of nameCombos) {
          const tempFile = path.posix.join(tempDir, `${name}.txt`);
          await connection.getContent().createStreamFile(tempFile);

          const resolved = await connection.getContent().streamfileResolve([tempFile], [`/`]);
          expect(resolved).toBe(tempFile);

          const attributes = await connection.getContent().getAttributes(resolved!, `CCSID`);
          expect(attributes).toBeTruthy();
        }
      });
    });

    it(`Test members with shell character ${char}`, async () => {
      const content = connection.getContent();
      const config = connection.getConfig()

      if (!connection.variantChars.local.includes(char)) {
        return;
      }

      const tempLib = config!.tempLibrary,
        tempSPF = `TESTINGS`,
        tempMbr = char + Tools.makeid(4);

      await connection!.runCommand({
        command: `CRTSRCPF ${tempLib}/${tempSPF} MBR(*NONE)`,
        environment: `ile`
      });

      await connection!.runCommand({
        command: `ADDPFM FILE(${tempLib}/${tempSPF}) MBR(${tempMbr}) `,
        environment: `ile`
      });

      const baseContent = `Hello world\r\n`;

      const attributes = await content?.getAttributes({ library: tempLib, name: tempSPF, member: tempMbr }, `CCSID`);
      expect(attributes).toBeTruthy();

      const uploadResult = await content?.uploadMemberContent(tempLib, tempSPF, tempMbr, baseContent);
      expect(uploadResult).toBeTruthy();

      const memberContentA = await content?.downloadMemberContent(tempLib, tempSPF, tempMbr);
      expect(memberContentA).toBe(baseContent);
    });
  });

  it('Listing objects with variants', { timeout: 15000 }, async () => {
    const content = connection.getContent();
    if (connection && content) {
      const tempLib = connection.getConfig().tempLibrary!;
      const ccsid = connection.getCcsid();

      let library = `TESTLIB${connection.variantChars.local}`;
      let skipLibrary = false;
      const sourceFile = `${connection.variantChars.local}TESTFIL`;
      const dataArea = `TSTDTA${connection.variantChars.local}`;
      const members: string[] = [];

      for (let i = 0; i < 5; i++) {
        members.push(`TSTMBR${connection.variantChars.local}${i}`);
      }

      await connection.runCommand({ command: `DLTLIB LIB(${library})`, noLibList: true });

      const crtLib = await connection.runCommand({ command: `CRTLIB LIB(${library}) TYPE(*PROD)`, noLibList: true });
      if (Tools.parseMessages(crtLib.stderr).findId("CPD0032")) {
        library = tempLib;
        skipLibrary = true;
      }

      let commands: string[] = [];

      commands.push(`CRTSRCPF FILE(${library}/${sourceFile}) RCDLEN(112) CCSID(${ccsid})`);
      for (const member of members) {
        commands.push(`ADDPFM FILE(${library}/${sourceFile}) MBR(${member}) SRCTYPE(TXT) TEXT('Test ${member}')`);
      }

      commands.push(`CRTDTAARA DTAARA(${library}/${dataArea}) TYPE(*CHAR) LEN(50) VALUE('hi')`);

      const result = await runCommandsWithCCSID(connection, commands, ccsid);
      expect(result.code).toBe(0);

      if (!skipLibrary) {
        const [expectedLibrary] = await content.getLibraries({ library });
        expect(expectedLibrary).toBeTruthy();
        expect(library).toBe(expectedLibrary.name);

        const validated = await connection.getContent().validateLibraryList([tempLib, library]);
        expect(validated.length).toBe(0);

        const libl = await content.getLibraryList([library]);
        expect(libl.length).toBe(1);
        expect(libl[0].name).toBe(library);
      }

      const checkFile = (expectedObject: IBMiObject) => {
        expect(expectedObject).toBeTruthy();
        expect(expectedObject.sourceFile).toBeTruthy();
        expect(expectedObject.name).toBe(sourceFile);
        expect(expectedObject.library).toBe(library);
      };

      const nameFilter = await content.getObjectList({ library, types: ["*ALL"], object: `${connection.variantChars.local[0]}*` });
      expect(nameFilter.length).toBe(1);
      expect(nameFilter.some(obj => obj.library === library && obj.type === `*FILE` && obj.name === sourceFile)).toBeTruthy();

      const objectList = await content.getObjectList({ library, types: ["*ALL"] });
      expect(objectList.some(obj => obj.library === library && obj.type === `*FILE` && obj.name === sourceFile && obj.sourceFile === true)).toBeTruthy();
      expect(objectList.some(obj => obj.library === library && obj.type === `*DTAARA` && obj.name === dataArea)).toBeTruthy();

      const expectedMembers = await content.getMemberList({ library, sourceFile });
      expect(expectedMembers).toBeTruthy();
      expect(expectedMembers.every(member => members.find(m => m === member.name && member.text?.includes(m)))).toBeTruthy();

      const sourceFilter = await content.getObjectList({ library, types: ["*SRCPF"], object: `${connection.variantChars.local[0]}*` });
      expect(sourceFilter.length).toBe(1);
      expect(sourceFilter.some(obj => obj.library === library && obj.type === `*FILE` && obj.name === sourceFile)).toBeTruthy();

      const [expectDataArea] = await content.getObjectList({ library, object: dataArea, types: ["*DTAARA"] });
      expect(expectDataArea.name).toBe(dataArea);
      expect(expectDataArea.library).toBe(library);
      expect(expectDataArea.type).toBe(`*DTAARA`);

      const [expectedSourceFile] = await content.getObjectList({ library, object: sourceFile, types: ["*SRCPF"] });
      checkFile(expectedSourceFile);
    }
  });

  it('Library list supports dollar sign variant', async () => {
    const library = `TEST${connection.variantChars.local}LIB`;
    const sourceFile = `TEST${connection.variantChars.local}FIL`;
    const member = `TEST${connection.variantChars.local}MBR`;
    const ccsid = connection.getCcsid();

    if (library.includes(`$`)) {
      await connection.runCommand({ command: `DLTLIB LIB(${library})`, noLibList: true });

      const crtLib = await connection.runCommand({ command: `CRTLIB LIB(${library}) TYPE(*PROD)`, noLibList: true });
      if (Tools.parseMessages(crtLib.stderr).findId("CPD0032")) {
        return;
      }

      const createSourceFileCommand = await connection.runCommand({ command: `CRTSRCPF FILE(${library}/${sourceFile}) RCDLEN(112) CCSID(${ccsid})`, noLibList: true });
      expect(createSourceFileCommand.code).toBe(0);

      const addPf = await connection.runCommand({ command: `ADDPFM FILE(${library}/${sourceFile}) MBR(${member}) SRCTYPE(TXT)`, noLibList: true });
      expect(addPf.code).toBe(0);

      await connection.getContent().uploadMemberContent(library, sourceFile, member, [`**free`, `dsply 'Hello world';`, `return;`].join(`\n`));

      const compileResultA = await connection.runCommand({ command: `CRTBNDRPG PGM(${library}/${member}) SRCFILE(${library}/${sourceFile}) SRCMBR(${member})`, env: { '&CURLIB': library } });
      expect(compileResultA.code).toBe(0);

      const compileResultB = await connection.runCommand({ command: `CRTBNDRPG PGM(${library}/${member}) SRCFILE(${library}/${sourceFile}) SRCMBR(${member})`, env: { '&LIBL': library } });
      expect(compileResultB.code).toBe(0);
    }
  });

  it('Variant character in source names and commands', { timeout: 45000 }, async () => {
    const config = connection.getConfig();
    const ccsidData = connection.getCcsids()!;
    const tempLib = config.tempLibrary;

    async function testSingleVariant(varChar: string) {
      const testFile = `${varChar}${Tools.makeid(4)}`.toUpperCase();
      const testMember = `${varChar}${Tools.makeid(4)}`.toUpperCase();
      const variantMember = `${connection.variantChars.local}MBR`;

      await connection.runCommand({ command: `DLTF FILE(${tempLib}/${testFile})`, noLibList: true });

      const createResult = await runCommandsWithCCSID(connection, [`CRTSRCPF FILE(${tempLib}/${testFile}) RCDLEN(112) CCSID(${ccsidData.userDefaultCCSID})`], ccsidData.userDefaultCCSID);
      expect(createResult.code).toBe(0);

      const addPf = await connection.runCommand({ command: `ADDPFM FILE(${tempLib}/${testFile}) MBR(${testMember}) SRCTYPE(TXT)`, noLibList: true });
      expect(addPf.code).toBe(0);

      const attributes = await connection.getContent().getAttributes({ library: tempLib, name: testFile, member: testMember }, `CCSID`);
      expect(attributes).toBeTruthy();
      expect(attributes![`CCSID`]).toBe(String(ccsidData.userDefaultCCSID));

      const addPfB = await connection.runCommand({ command: `ADDPFM FILE(${tempLib}/${testFile}) MBR(${variantMember}) SRCTYPE(TXT)`, noLibList: true });
      expect(addPfB.code).toBe(0);

      const attributesB = await connection.getContent().getAttributes({ library: tempLib, name: testFile, member: variantMember }, `CCSID`);
      expect(attributesB).toBeTruthy();
      expect(attributesB![`CCSID`]).toBe(String(ccsidData.userDefaultCCSID));

      const objects = await connection.getContent().getObjectList({ library: tempLib, types: [`*SRCPF`] });
      expect(objects.length).toBeTruthy();
      expect(objects.some(obj => obj.name === testFile)).toBeTruthy();

      const members = await connection.getContent().getMemberList({ library: tempLib, sourceFile: testFile });
      expect(members.length).toBeTruthy();
      expect(members.some(m => m.name === testMember)).toBeTruthy();
      expect(members.some(m => m.file === testFile)).toBeTruthy();

      const smallFilter = await connection.getContent().getMemberList({ library: tempLib, sourceFile: testFile, members: `${varChar}*` });
      expect(smallFilter.length).toBeTruthy();

      const files = await connection.getContent().getFileList(`/QSYS.LIB/${tempLib}.LIB/${connection.sysNameInAmerican(testFile)}.FILE`);
      expect(files.length).toBeTruthy();
      expect(files.some(f => f.name === connection.sysNameInAmerican(variantMember) + `.MBR`)).toBeTruthy();
      expect(files.some(f => f.name === connection.sysNameInAmerican(testMember) + `.MBR`)).toBeTruthy();

      await connection.getContent().uploadMemberContent(tempLib, testFile, testMember, [`**free`, `dsply 'Hello world';`, `   `, `   `, `return;`].join(`\n`));

      const compileResult = await connection.runCommand({ command: `CRTBNDRPG PGM(${tempLib}/${testMember}) SRCFILE(${tempLib}/${testFile}) SRCMBR(${testMember})`, noLibList: true });
      console.log(compileResult);
      expect(compileResult.code).toBe(0);

      if (compileResult.code === 0) {
        await connection.runCommand({ command: `DLTOBJ OBJ(${tempLib}/${testMember}) OBJTYPE(*PGM)`, noLibList: true });
      }
    }

    for (const varChar of connection.variantChars.local) {
      await testSingleVariant(varChar);
    }
  });
});
