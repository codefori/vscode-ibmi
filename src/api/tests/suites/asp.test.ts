import assert from "assert";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import IBMi from "../../IBMi";
import { Search } from "../../Search";
import { CONNECTION_TIMEOUT, disposeConnection, newConnection } from "../connection";

const LIBNAME = `VSCODELIBT`;
const SPFNAME = `VSCODESPFT`;
const MBRNAME = `VSCODEMBRT`;

function checkAsps(connection: IBMi) {
  const asps = connection.getAllIAsps();
  if (asps.length === 0) return false;

  const currentAsp = connection.getCurrentIAspName();
  if (!currentAsp) return false;

  return true;
}

async function ensureLibExists(connection: IBMi) {
  const detail = connection.getIAspDetail(connection.getCurrentIAspName()!)!;
  const res = await connection.runCommand({ command: `CRTLIB LIB(${LIBNAME}) ASPDEV(${detail.name})` });
  if (res.code) {
    assert.strictEqual(res.code, 0, res.stderr || res.stdout);
  }
}

async function createTempRpgle(connection: IBMi) {
  const content = connection.getContent();

  await connection.runCommand({
    command: `CRTSRCPF ${LIBNAME}/${SPFNAME} MBR(*NONE)`,
    environment: `ile`
  });

  await connection.runCommand({
    command: `ADDPFM FILE(${LIBNAME}/${SPFNAME}) MBR(${MBRNAME}) `,
    environment: `ile`
  });

  const baseContent = `**FREE\ndsply 'hello world';`;

  return await content?.uploadMemberContent(LIBNAME, SPFNAME, MBRNAME, baseContent);
}

describe(`iASP tests`, { concurrent: true }, () => {
  let connection: IBMi
  let skipAsp = false;
  beforeAll(async () => {
    connection = await newConnection();
    if (checkAsps(connection)) {
      await ensureLibExists(connection);
      await createTempRpgle(connection);
    } else {
      console.log(`Skipping iASP tests, no ASPs found.`);
      skipAsp = true;
    }
  }, CONNECTION_TIMEOUT)

  afterAll(async () => {
    await connection.runCommand({ command: `DLTLIB LIB(${LIBNAME})` });
    disposeConnection(connection);
  });

  beforeEach((t) => {
    if (skipAsp) {
      t.skip();
    }
  });

  it('Read members in ASP and base', async () => {
    const aspMbrContents = await connection.getContent()?.downloadMemberContent(LIBNAME, SPFNAME, MBRNAME);

    assert.ok(aspMbrContents);
  });

  it('can find ASP members via search', async () => {
    const searchResults = await Search.searchMembers(connection, LIBNAME, SPFNAME, `hello world`, `*`);
    expect(searchResults.hits.length).toBeGreaterThan(0);
    // TODO: additional expects
  });

  it('can resolve member info from ASP', async () => {
    const resolved = await connection.getContent().memberResolve(MBRNAME, [
      { library: `QSYS`, name: `QSYSINC` },
      { library: LIBNAME, name: SPFNAME }
    ]);

    expect(resolved).toBeDefined();
    //TODO: additional expects
  });
});
