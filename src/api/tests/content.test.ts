
import { expect, test, describe } from 'vitest'
import { getConnection } from './state'

describe('Content Tests', () => {
  test('Test memberResolve', async () => {
    const connection = getConnection();
    const content = connection.getContent();

    const member = await content?.memberResolve(`MATH`, [
      { library: `QSYSINC`, name: `MIH` }, // Doesn't exist here
      { library: `QSYSINC`, name: `H` } // Does exist
    ]);

    expect(member).toEqual({
      asp: undefined,
      library: `QSYSINC`,
      file: `H`,
      name: `MATH`,
      extension: `MBR`,
      basename: `MATH.MBR`
    });
  });

  test('Test memberResolve (with invalid ASP)', async () => {
    const connection = getConnection();
    const content = connection.getContent();

    const member = await content?.memberResolve(`MATH`, [
      { library: `QSYSINC`, name: `MIH` }, // Doesn't exist here
      { library: `QSYSINC`, name: `H`, asp: `myasp` } // Does exist, but not in the ASP
    ]);

    expect(member).toEqual({
      asp: undefined,
      library: `QSYSINC`,
      file: `H`,
      name: `MATH`,
      extension: `MBR`,
      basename: `MATH.MBR`
    });
  });

  test('Test memberResolve with variants', async () => {
    const connection = getConnection();
    const content = connection.getContent();
    const config = connection.getConfig();
    const tempLib = config!.tempLibrary,
      tempSPF = `O_ABC`.concat(connection!.variantChars.local),
      tempMbr = `O_ABC`.concat(connection!.variantChars.local);

    const result = await connection!.runCommand({
      command: `CRTSRCPF ${tempLib}/${tempSPF} MBR(${tempMbr})`,
      environment: `ile`
    });

    const member = await content?.memberResolve(tempMbr, [
      { library: `QSYSINC`, name: `MIH` }, // Doesn't exist here
      { library: `NOEXIST`, name: `SUP` }, // Doesn't exist here
      { library: tempLib, name: tempSPF } // Does exist here
    ]);

    expect(member).toEqual({
      asp: undefined,
      library: tempLib,
      file: tempSPF,
      name: tempMbr,
      extension: `MBR`,
      basename: `${tempMbr}.MBR`
    });

    // Cleanup...
    await connection!.runCommand({
      command: `DLTF ${tempLib}/${tempSPF}`,
      environment: `ile`
    });
  });

  test('Test memberResolve with bad name', async () => {
    const connection = getConnection();
    const content = connection.getContent();

    const member = await content?.memberResolve(`BOOOP`, [
      { library: `QSYSINC`, name: `MIH` }, // Doesn't exist here
      { library: `NOEXIST`, name: `SUP` }, // Doesn't exist here
      { library: `QSYSINC`, name: `H` } // Doesn't exist here
    ]);

    expect(member).toBeUndefined();
  });

  test('Test objectResolve .FILE', async () => {
    const connection = getConnection();
    const content = connection.getContent();

    const lib = await content?.objectResolve(`MIH`, [
      "QSYS2", // Doesn't exist here
      "QSYSINC" // Does exist
    ]);

    expect(lib).toBe("QSYSINC");
  });

  test('Test objectResolve .PGM', async () => {
    const connection = getConnection();
    const content = connection.getContent();

    const lib = await content?.objectResolve(`CMRCV`, [
      "QSYSINC", // Doesn't exist here
      "QSYS2" // Does exist
    ]);

    expect(lib).toBe("QSYS2");
  });

  test('Test objectResolve .DTAARA with variants', async () => {
    const connection = getConnection();
    const content = connection.getContent();
    const config = connection.getConfig();
    const tempLib = config!.tempLibrary,
      tempObj = `O_ABC`.concat(connection!.variantChars.local);

    await connection!.runCommand({
      command: `CRTDTAARA ${tempLib}/${tempObj} TYPE(*CHAR)`,
      environment: `ile`
    });

    const lib = await content?.objectResolve(tempObj, [
      "QSYSINC", // Doesn't exist here
      "QSYS2", // Doesn't exist here
      tempLib // Does exist here
    ]);

    expect(lib).toBe(tempLib);

    // Cleanup...
    await connection!.runCommand({
      command: `DLTDTAARA ${tempLib}/${tempObj}`,
      environment: `ile`
    });
  });

  test('Test objectResolve with bad name', async () => {
    const connection = getConnection();
    const content = connection.getContent();

    const lib = await content?.objectResolve(`BOOOP`, [
      "BADLIB", // Doesn't exist here
      "QSYS2", // Doesn't exist here
      "QSYSINC", // Doesn't exist here
    ]);

    expect(lib).toBeUndefined();
  });

  test('Test streamfileResolve', async () => {
    const content = getConnection().getContent();

    const streamfilePath = await content?.streamfileResolve([`git`], [`/QOpenSys/pkgs/sbin`, `/QOpenSys/pkgs/bin`]);

    expect(streamfilePath).toBe(`/QOpenSys/pkgs/bin/git`);
  });

  test('Test streamfileResolve with bad name', async () => {
    const content = getConnection().getContent();

    const streamfilePath = await content?.streamfileResolve([`sup`], [`/QOpenSys/pkgs/sbin`, `/QOpenSys/pkgs/bin`]);

    expect(streamfilePath).toBeUndefined();
  });

  test('Test streamfileResolve with multiple names', async () => {
    const content = getConnection().getContent();

    const streamfilePath = await content?.streamfileResolve([`sup`, `sup2`, `git`], [`/QOpenSys/pkgs/sbin`, `/QOpenSys/pkgs/bin`]);

    expect(streamfilePath).toBe(`/QOpenSys/pkgs/bin/git`);
  });

  test('Test streamfileResolve with blanks in names', async () => {
    const connection = getConnection();
    const content = connection.getContent();
    const files = [`normalname`, `name with blank`, `name_with_quote'`, `name_with_dollar$`];
    const dir = `/tmp/${Date.now()}`;
    const dirWithSubdir = `${dir}/${files[0]}`;

    let result;

    result = await connection?.sendCommand({ command: `mkdir -p "${dir}"` });
    expect(result?.code).toBe(0);
    try {
      for (const file of files) {
        result = await connection?.sendCommand({ command: `touch "${dir}/${file}"` });
        expect(result?.code).toBe(0);
      };

      for (const file of files) {
        let result = await content?.streamfileResolve([`${Date.now()}`, file], [`${Date.now()}`, dir]);
        expect(result).toBe(`${dir}/${file}`);
      }
    }
    finally {
      result = await connection?.sendCommand({ command: `rm -r "${dir}"` });
      expect(result?.code).toBe(0);
    }
  });
});
