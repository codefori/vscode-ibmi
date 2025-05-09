import assert from "assert";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import IBMi from "../../IBMi";
import { Search } from "../../Search";
import { CONNECTION_TIMEOUT, disposeConnection, newConnection } from "../connection";

const LIBNAME = `VSCODELIBT`;
const SPFNAME = `VSCODESPFT`;
const MBRNAME = `VSCODEMBRT`;

/**
 * Check the system has at least one iASP available,
 * and the user profile is set to use *SYSBAS
 */
function checkAsps(connection: IBMi) {
  const asps = connection.getAllIAsps();
  if (asps.length === 0) return false;

  const currentAsp = connection.getCurrentUserIAspName();
  if (currentAsp !== undefined) return false;

  return true;
}

async function ensureLibExists(connection: IBMi, aspName: string) {
  const res = await connection.runCommand({ command: `CRTLIB LIB(${LIBNAME}) ASPDEV(${aspName})` });
}

async function setToAsp(connection: IBMi, name?: string) {
  connection.getConfig().chosenAsp = name || `*SYSBAS`;
}

async function createTempRpgle(connection: IBMi) {
  const content = connection.getContent();

  await connection.runCommand({
    command: `CRTSRCPF ${LIBNAME}/${SPFNAME} MBR(*NONE)`,
    environment: `ile`
  });

  await connection.runCommand({
    command: `ADDPFM FILE(${LIBNAME}/${SPFNAME}) MBR(${MBRNAME})`,
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
    setToAsp(connection);

    if (checkAsps(connection)) {
      const useiAsp = connection.getAllIAsps()[0].name;

      await ensureLibExists(connection, useiAsp);

      setToAsp(connection, useiAsp);
      await createTempRpgle(connection);
    } else {
      console.log(`Skipping iASP tests, no ASPs found.`);
      skipAsp = true;
    }
  }, CONNECTION_TIMEOUT)

  afterAll(async () => {
    if (checkAsps(connection)) {
      setToAsp(connection, connection.getAllIAsps()[0].name);

      await connection.runCommand({ command: `DLTLIB LIB(${LIBNAME})` });
      disposeConnection(connection);
    }
  });

  beforeEach((t) => {
    if (skipAsp) {
      t.skip();
    }

    setToAsp(connection, connection.getAllIAsps()[0].name);
  });

  it('CHKOBJ works with ASP set and unset', async () => {
    expect(connection.getConfiguredIAsp()).toBeDefined();

    const aspObjectExists = await connection.getContent()?.checkObject({library: LIBNAME, name: SPFNAME, type: `*FILE`});
    expect(aspObjectExists).toBeTruthy();

    setToAsp(connection); // Reset to *SYSBAS
    const aspObjectNotFound = await connection.getContent()?.checkObject({library: LIBNAME, name: SPFNAME, type: `*FILE`});
    expect(aspObjectNotFound).toBeFalsy();
  });

  it('Read members in ASP and base', async () => {
    expect(connection.getConfiguredIAsp()).toBeDefined();

    const aspMbrContents = await connection.getContent()?.downloadMemberContent(LIBNAME, SPFNAME, MBRNAME);

    assert.ok(aspMbrContents);
  });

  it('can find ASP members via search', async () => {
    expect(connection.getConfiguredIAsp()).toBeDefined();

    const searchResults = await Search.searchMembers(connection, LIBNAME, SPFNAME, `hello world`, `*`);
    expect(searchResults.hits.length).toBeGreaterThan(0);
    // TODO: additional expects
  });

  it('can resolve member info from ASP', async () => {
    expect(connection.getConfiguredIAsp()).toBeDefined();

    const resolved = await connection.getContent().memberResolve(MBRNAME, [
      { library: `QSYS`, name: `QSYSINC` },
      { library: LIBNAME, name: SPFNAME }
    ]);

    expect(resolved).toBeDefined();

    const attrA = await connection.getContent().getAttributes({library: LIBNAME, name: SPFNAME, member: MBRNAME, asp: connection.getConfiguredIAsp()?.name});
    console.log(attrA);
    expect(attrA).toBeDefined();
    //TODO: additional expects

    setToAsp(connection); // Reset to *SYSBAS
    const attrB = await connection.getContent().getAttributes({library: LIBNAME, name: SPFNAME, member: MBRNAME});
    expect(attrB).toBeUndefined();
  });

  it('can get library info', {timeout: 1000000}, async () => {
    // Long running test on systems with many libraries
    expect(connection.getConfiguredIAsp()).toBeDefined();

    const librariesA = await connection.getContent().getLibraryList([`QSYS2`, LIBNAME]);
    expect(librariesA.length).toBe(2);
    expect(librariesA.some(lib => lib.name === `QSYS2`)).toBeTruthy();
    expect(librariesA.some(lib => lib.name === LIBNAME)).toBeTruthy();

    setToAsp(connection); // Reset to *SYSBAS
    const librariesB = await connection.getContent().getLibraryList([`QSYS2`, LIBNAME]);
    expect(librariesB.length).toBe(2);
    expect(librariesB.some(lib => lib.name === `QSYS2`)).toBeTruthy();

    const notFound = librariesB.find(lib => lib.name === LIBNAME);
    expect(notFound).toBeTruthy();
    expect(notFound!.text).toBe(`*** NOT FOUND ***`);
  });

  it('can validate libraries in ASP', async () => {
    expect(connection.getConfiguredIAsp()).toBeDefined();

    const badLibsA = await connection.getContent().validateLibraryList([`QSYS2`, LIBNAME]);
    expect(badLibsA.length).toBe(0);

    setToAsp(connection); // Reset to *SYSBAS
    const badLibsB = await connection.getContent().validateLibraryList([`QSYS2`, LIBNAME]);
    expect(badLibsB.length).toBe(1);
    expect(badLibsB[0]).toBe(LIBNAME);
  })

  it('can change ASP', async () => {
    setToAsp(connection); // Reset to *SYSBAS

    expect(connection.getConfiguredIAsp()).toBeUndefined();
  });
});
