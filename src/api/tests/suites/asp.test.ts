import assert from "assert";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import IBMi from "../../IBMi";
import { SearchTools } from "../../SearchTools";
import { Tools } from "../../Tools";
import { CONNECTION_TIMEOUT, disposeConnection, newConnection } from "../connection";

const SPFNAME = `VSCODESPFT`;
const MBRNAME = `VSCODEMBRT`;

async function createTestASPLibrary(connection: IBMi) {
  const asp = connection.getConfig().iasp;
  if (asp) {
    const tempLibName = Tools.makeid();
    const res = await connection.runCommand({ command: `QSYS/CRTLIB LIB(${tempLibName}) ASPDEV(${asp})` });
    if (res.code === 0) {
      assert.strictEqual(await connection.getLibraryIAsp(tempLibName), asp, "Temp library ASP doesn't match the expected ASP.")
      return tempLibName;
    }
    else {
      console.log(`Can't create library on iASP ${asp}: ${res.stderr || res.stdout}`);
    }
  }
}

async function createTempRpgle(connection: IBMi, library: string) {
  const content = connection.getContent();

  await connection.runCommand({
    command: `QSYS/CRTSRCPF ${library}/${SPFNAME} MBR(*NONE)`,
    environment: `ile`
  });

  await connection.runCommand({
    command: `QSYS/ADDPFM FILE(${library}/${SPFNAME}) MBR(${MBRNAME}) `,
    environment: `ile`
  });

  const baseContent = `**FREE\ndsply 'hello world';`;

  return await content?.uploadMemberContent(library, SPFNAME, MBRNAME, baseContent);
}

describe(`iASP tests`, { concurrent: true }, () => {
  let connection: IBMi
  let skipAsp = false;
  let tempLib: string | undefined;
  beforeAll(async () => {
    connection = await newConnection();
    tempLib = await createTestASPLibrary(connection);
    if (tempLib) {
      await createTempRpgle(connection, tempLib);
    } else {
      console.log(`Skipping iASP tests, no iASP set in configuration.`);
      skipAsp = true;
    }
  }, CONNECTION_TIMEOUT)

  afterAll(async () => {
    await connection.runCommand({ command: `QSYS/DLTLIB LIB(${tempLib})` });
    await disposeConnection(connection);
  });

  beforeEach((t) => {
    if (skipAsp) {
      t.skip();
    }
  });

  it('Read members in ASP and base', async () => {
    const aspMbrContents = await connection.getContent()?.downloadMemberContent(tempLib!, SPFNAME, MBRNAME);

    assert.ok(aspMbrContents);
  });

  it('can find ASP members via search', async () => {
    const searchResults = await SearchTools.searchMembers(connection, tempLib!, SPFNAME, `hello world`, `*`);
    expect(searchResults.hits.length).toBeGreaterThan(0);
    // TODO: additional expects
  });

  it('can resolve member info from ASP', async () => {
    const resolved = await connection.getContent().memberResolve(MBRNAME, [
      { library: `QSYS`, name: `QSYSINC` },
      { library: tempLib!, name: SPFNAME }
    ]);

    expect(resolved).toBeDefined();
    //TODO: additional expects
  });
});
