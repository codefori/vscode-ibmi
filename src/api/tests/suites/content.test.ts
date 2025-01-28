
import { expect, describe, it, afterAll, beforeAll } from 'vitest';
import util, { TextDecoder } from 'util';
import tmp from 'tmp';
import { Tools } from '../../Tools';
import { posix } from 'path';
import IBMi from '../../IBMi';
import { newConnection, disposeConnection, CONNECTION_TIMEOUT } from '../connection';
import { ModuleExport, ProgramExportImportInfo } from '../../types';

describe('Content Tests', {concurrent: true}, () => {
  let connection: IBMi
  beforeAll(async () => {
    connection = await newConnection();
  }, CONNECTION_TIMEOUT)

  afterAll(async () => {
    disposeConnection(connection);
  });

  it('memberResolve', async () => {
    const content = connection.getContent();

    const member = await content?.memberResolve('MATH', [
      { library: 'QSYSINC', name: 'MIH' }, // Doesn't exist here
      { library: 'QSYSINC', name: 'H' } // Does exist
    ]);

    expect(member).toEqual({
      asp: undefined,
      library: 'QSYSINC',
      file: 'H',
      name: 'MATH',
      extension: 'MBR',
      basename: 'MATH.MBR'
    });
  });

  it('memberResolve (with invalid ASP)', async () => {
    const content = connection.getContent();

    const member = await content?.memberResolve('MATH', [
      { library: 'QSYSINC', name: 'MIH' }, // Doesn't exist here
      { library: 'QSYSINC', name: 'H', asp: 'myasp' } // Does exist, but not in the ASP
    ]);

    expect(member).toEqual({
      asp: undefined,
      library: 'QSYSINC',
      file: 'H',
      name: 'MATH',
      extension: 'MBR',
      basename: 'MATH.MBR'
    });
  });

  it('memberResolve with variants', async () => {
    const content = connection.getContent();
    const config = connection.getConfig();
    const tempLib = config!.tempLibrary,
      tempSPF = `O_ABC`.concat(connection!.variantChars.local),
      tempMbr = `O_ABC`.concat(connection!.variantChars.local);

    const result = await connection!.runCommand({
      command: `CRTSRCPF ${tempLib}/${tempSPF} MBR(${tempMbr})`,
      environment: 'ile'
    });

    const member = await content?.memberResolve(tempMbr, [
      { library: 'QSYSINC', name: 'MIH' }, // Doesn't exist here
      { library: 'NOEXIST', name: 'SUP' }, // Doesn't exist here
      { library: tempLib, name: tempSPF } // Does exist here
    ]);

    expect(member).toEqual({
      asp: undefined,
      library: tempLib,
      file: tempSPF,
      name: tempMbr,
      extension: 'MBR',
      basename: `${tempMbr}.MBR`
    });

    // Cleanup...
    await connection!.runCommand({
      command: `DLTF ${tempLib}/${tempSPF}`,
      environment: 'ile'
    });
  });

  it('memberResolve with bad name', async () => {
    const content = connection.getContent();

    const member = await content?.memberResolve('BOOOP', [
      { library: 'QSYSINC', name: 'MIH' }, // Doesn't exist here
      { library: 'NOEXIST', name: 'SUP' }, // Doesn't exist here
      { library: 'QSYSINC', name: 'H' } // Doesn't exist here
    ]);

    expect(member).toBeUndefined();
  });

  it('objectResolve .FILE', async () => {
    const content = connection.getContent();

    const lib = await content?.objectResolve('MIH', [
      'QSYS2', // Doesn't exist here
      'QSYSINC' // Does exist
    ]);

    expect(lib).toBe('QSYSINC');
  });

  it('objectResolve .PGM', async () => {
    const content = connection.getContent();

    const lib = await content?.objectResolve('CMRCV', [
      'QSYSINC', // Doesn't exist here
      'QSYS2' // Does exist
    ]);

    expect(lib).toBe('QSYS2');
  });

  it('objectResolve .DTAARA with variants', async () => {
    const content = connection.getContent();
    const config = connection.getConfig();
    const tempLib = config!.tempLibrary,
      tempObj = `O_ABC`.concat(connection!.variantChars.local);

    await connection!.runCommand({
      command: `CRTDTAARA ${tempLib}/${tempObj} TYPE(*CHAR)`,
      environment: 'ile'
    });

    const lib = await content?.objectResolve(tempObj, [
      'QSYSINC', // Doesn't exist here
      'QSYS2', // Doesn't exist here
      tempLib // Does exist here
    ]);

    expect(lib).toBe(tempLib);

    // Cleanup...
    await connection!.runCommand({
      command: `DLTDTAARA ${tempLib}/${tempObj}`,
      environment: 'ile'
    });
  });

  it('objectResolve with bad name', async () => {
    const content = connection.getContent();

    const lib = await content?.objectResolve('BOOOP', [
      'BADLIB', // Doesn't exist here
      'QSYS2', // Doesn't exist here
      'QSYSINC', // Doesn't exist here
    ]);

    expect(lib).toBeUndefined();
  });

  it('streamfileResolve', async () => {
    const content = connection.getContent();

    const streamfilePath = await content?.streamfileResolve(['git'], ['/QOpenSys/pkgs/sbin', '/QOpenSys/pkgs/bin']);

    expect(streamfilePath).toBe('/QOpenSys/pkgs/bin/git');
  });

  it('streamfileResolve with bad name', async () => {
    const content = connection.getContent();

    const streamfilePath = await content?.streamfileResolve(['sup'], ['/QOpenSys/pkgs/sbin', '/QOpenSys/pkgs/bin']);

    expect(streamfilePath).toBeUndefined();
  });

  it('streamfileResolve with multiple names', async () => {
    const content = connection.getContent();

    const streamfilePath = await content?.streamfileResolve(['sup', 'sup2', 'git'], ['/QOpenSys/pkgs/sbin', '/QOpenSys/pkgs/bin']);

    expect(streamfilePath).toBe('/QOpenSys/pkgs/bin/git');
  });

  it('streamfileResolve with blanks in names', async () => {
    const content = connection.getContent();
    const files = ['normalname', 'name with blank', 'name_with_quote\'', 'name_with_dollar$'];
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

  it('Test downloadMemberContent', async () => {
    const content = connection.getContent();

    const tmpFile = await util.promisify(tmp.file)();
    const memberContent = await content?.downloadMemberContent(undefined, 'QSYSINC', 'H', 'MATH', tmpFile);

    expect(memberContent).toBeTruthy();
  });

  it('Test runSQL (basic select)', async () => {

    const rows = await connection.runSQL('select * from qiws.qcustcdt');
    expect(rows?.length).not.toBe(0);

    const firstRow = rows![0];
    expect(typeof firstRow['BALDUE']).toBe('number');
    expect(typeof firstRow['CITY']).toBe('string');
  });

  it('Test runSQL (bad basic select)', async () => {

    try {
      await connection.runSQL('select from qiws.qcustcdt');
      expect.fail('Should have thrown an error');
    } catch (e: any) {
      expect(e.message).toBe('Token . was not valid. Valid tokens: , FROM INTO. (42601)');
      expect(e.sqlstate).toBe('42601');
    }
  });

  it('Test runSQL (with comments)', async () => {

    const rows = await connection.runSQL([
      '-- myselect',
      'select *',
      'from qiws.qcustcdt --my table',
      'limit 1',
    ].join('\n'));

    expect(rows?.length).toBe(1);
  });

  it('Test getTable', async () => {
    const content = connection.getContent();

    const rows = await content.getTable('qiws', 'qcustcdt', '*all');

    expect(rows?.length).not.toBe(0);
    const firstRow = rows![0];

    expect(typeof firstRow['BALDUE']).toBe('number');
    expect(typeof firstRow['CITY']).toBe('string');
  });

  it('Test validateLibraryList', async () => {
    const content = connection.getContent();

    const badLibs = await content.validateLibraryList(['SCOOBY', 'QSYSINC', 'BEEPBOOP']);

    expect(badLibs?.includes('BEEPBOOP')).toBe(true);
    expect(badLibs?.includes('QSYSINC')).toBe(false);
    expect(badLibs?.includes('SCOOBY')).toBe(true);
  });

  it('Test getFileList', async () => {
    const content = connection.getContent();

    const objects = await content?.getFileList('/');

    const qsysLib = objects?.find(obj => obj.name === 'QSYS.LIB');

    expect(qsysLib?.name).toBe('QSYS.LIB');
    expect(qsysLib?.path).toBe('/QSYS.LIB');
    expect(qsysLib?.type).toBe('directory');
    expect(qsysLib?.owner).toBe('qsys');
  });

  it('Test getFileList (non-existing file)', async () => {
    const content = connection.getContent();

    const objects = await content?.getFileList(`/tmp/${Date.now()}`);

    expect(objects?.length).toBe(0);
  });

  it('Test getFileList (special chars)', async () => {
    const content = connection.getContent();
    const files = ['name with blank', 'name_with_quote\'', 'name_with_dollar$'];
    const dir = `/tmp/${Date.now()}`;
    const dirWithSubdir = `${dir}/${files[0]}`;

    let result;

    result = await connection?.sendCommand({ command: `mkdir -p "${dirWithSubdir}"` });
    expect(result?.code).toBe(0);
    try {
      for (const file of files) {
        result = await connection?.sendCommand({ command: `touch "${dirWithSubdir}/${file}"` });
        expect(result?.code).toBe(0);
      };

      const objects = await content?.getFileList(`${dirWithSubdir}`);
      expect(objects?.length).toBe(files.length);
      expect(objects?.map(a => a.name).sort()).toEqual(files.sort());
    }
    finally {
      result = await connection?.sendCommand({ command: `rm -r "${dir}"` });
      expect(result?.code).toBe(0);
    }
  });

  it('Test getObjectList (all objects)', async () => {
    const content = connection.getContent();

    const objects = await content?.getObjectList({ library: 'QSYSINC' });

    expect(objects?.length).not.toBe(0);
  });

  it('Test getObjectList (pgm filter)', async () => {
    const content = connection.getContent();

    const objects = await content?.getObjectList({ library: 'QSYSINC', types: ['*PGM'] });

    expect(objects?.length).not.toBe(0);

    const containsNonPgms = objects?.some(obj => obj.type !== '*PGM');

    expect(containsNonPgms).toBe(false);
  });

  it('Test getObjectList (source files only)', async () => {
    const content = connection.getContent();

    const objects = await content?.getObjectList({ library: 'QSYSINC', types: ['*SRCPF'] });

    expect(objects?.length).not.toBe(0);

    const containsNonFiles = objects?.some(obj => obj.type !== '*FILE');

    expect(containsNonFiles).toBe(false);
  });

  it('Test getObjectList (single source file only, detailed)', async () => {
    const content = connection.getContent();

    const objectsA = await content?.getObjectList({ library: 'QSYSINC', types: ['*SRCPF'], object: 'MIH' });

    expect(objectsA?.length).toBe(1);
  });

  it('Test getObjectList (source files only, named filter)', async () => {
    const content = connection.getContent();

    const objects = await content?.getObjectList({ library: 'QSYSINC', types: ['*SRCPF'], object: 'MIH' });

    expect(objects?.length).toBe(1);

    expect(objects[0].type).toBe('*FILE');
    expect(objects[0].text).toBe('DATA BASE FILE FOR C INCLUDES FOR MI');
  });

  it('getLibraries (simple filters)', async () => {
    const content = connection.getContent();

    const qsysLibraries = await content?.getLibraries({ library: 'QSYS*' });
    expect(qsysLibraries?.length).not.toBe(0);
    expect(qsysLibraries?.every(l => l.name.startsWith('QSYS'))).toBe(true);

    const includeSYSLibraries = await content?.getLibraries({ library: '*SYS*' });
    expect(includeSYSLibraries?.length).not.toBe(0);
    expect(includeSYSLibraries?.every(l => l.name.includes('SYS'))).toBe(true);

    const libraries = ['QSYSINC', 'QGPL', 'QTEMP'];
    const multipleLibraries = await content?.getLibraries({ library: libraries.join(',') });
    expect(multipleLibraries?.length).toBe(libraries.length);
    expect(libraries.every(l => multipleLibraries.some(o => o.name === l))).toBe(true);
  });

  it('getLibraries (regexp filters)', async () => {
    const content = connection.getContent();

    const qsysLibraries = await content?.getLibraries({ library: '^.*SYS[^0-9]*$', filterType: 'regex' });
    expect(qsysLibraries?.length).not.toBe(0);
    expect(qsysLibraries?.every(l => /^.*SYS[^0-9]*$/.test(l.name))).toBe(true);
  });

  it('getObjectList (advanced filtering)', async () => {
    const content = connection.getContent();
    const objects = await content?.getObjectList({ library: 'QSYSINC', object: 'L*OU*' });

    expect(objects?.length).not.toBe(0);
    expect(objects?.map(o => o.name).every(n => n.startsWith('L') && n.includes('OU'))).toBe(true);
  });

  it('getMemberList (SQL, no filter)', async () => {
    const content = connection.getContent();

    let members = await content?.getMemberList({ library: 'qsysinc', sourceFile: 'mih', members: '*inxen' });

    expect(members?.length).toBe(3);

    members = await content?.getMemberList({ library: 'qsysinc', sourceFile: 'mih' });

    const actbpgm = members?.find(mbr => mbr.name === 'ACTBPGM');

    expect(actbpgm?.name).toBe('ACTBPGM');
    expect(actbpgm?.extension).toBe('C');
    expect(actbpgm?.text).toBe('ACTIVATE BOUND PROGRAM');
    expect(actbpgm?.library).toBe('QSYSINC');
    expect(actbpgm?.file).toBe('MIH');
  });

  it('getMemberList (advanced filtering)', async () => {
    const content = connection.getContent();

    const members = await content?.getMemberList({ library: 'QSYSINC', sourceFile: 'QRPGLESRC', members: 'SYS*,I*,*EX' });
    expect(members?.length).not.toBe(0);
    expect(members!.map(m => m.name).every(n => n.startsWith('SYS') || n.startsWith('I') || n.endsWith('EX'))).toBe(true);

    const membersRegex = await content?.getMemberList({ library: 'QSYSINC', sourceFile: 'QRPGLESRC', members: '^QSY(?!RTV).*$', filterType: 'regex' });
    expect(membersRegex?.length).not.toBe(0);
    expect(membersRegex!.map(m => m.name).every(n => n.startsWith('QSY') && !n.includes('RTV'))).toBe(true);
  });

  it('getQtempTable', async () => {
    const content = connection.getContent();

    const queries = [
      `CALL QSYS2.QCMDEXC('DSPOBJD OBJ(QSYSINC/*ALL) OBJTYPE(*ALL) OUTPUT(*OUTFILE) OUTFILE(QTEMP/DSPOBJD)')`,
      `Create Table QTEMP.OBJECTS As (
      Select ODLBNM as LIBRARY,
        ODOBNM as NAME,
        ODOBAT as ATTRIBUTE,
        ODOBTP as TYPE,
        Coalesce(ODOBTX, '') as TEXT
      From QTEMP.DSPOBJD
    ) With Data`
    ];


    const nosqlContent = await content?.getQTempTable(queries, "OBJECTS");
    const objects = nosqlContent?.map(row => ({
      library: row.LIBRARY,
      name: row.NAME,
      attribute: row.ATTRIBUTE,
      type: row.TYPE,
      text: row.TEXT,
    }));
    expect(objects?.length).not.toBe(0);
    expect(objects?.every(obj => obj.library === "QSYSINC")).toBe(true);

    const qrpglesrc = objects?.find(obj => obj.name === "QRPGLESRC");
    expect(qrpglesrc).toBeDefined();
    expect(qrpglesrc?.attribute).toBe("PF");
    expect(qrpglesrc?.type).toBe("*FILE");
  });

  it('toCl', () => {
    const command = connection.getContent().toCl("TEST", {
      ZERO: 0,
      NONE: '*NONE',
      EMPTY: `''`,
      OBJNAME: `OBJECT`,
      OBJCHAR: `ObJect`,
      IFSPATH: `/hello/world`
    });

    expect(command).toBe("TEST ZERO(0) NONE(*NONE) EMPTY('') OBJNAME(OBJECT) OBJCHAR('ObJect') IFSPATH('/hello/world')");
  });

  it('Check object (no exist)', async () => {
    const content = connection.getContent();

    const exists = await content?.checkObject({ library: 'QSYSINC', name: 'BOOOP', type: '*FILE' });
    expect(exists).toBe(false);
  });

  it('Check object (source member)', async () => {
    const content = connection.getContent();

    const exists = await content?.checkObject({ library: 'QSYSINC', name: 'H', type: '*FILE', member: 'MATH' });
    expect(exists).toBeTruthy();
  });

  it('Check getMemberInfo', async () => {
    const content = connection.getContent();

    const memberInfoA = await content?.getMemberInfo('QSYSINC', 'H', 'MATH');
    expect(memberInfoA).toBeTruthy();
    expect(memberInfoA?.library).toBe('QSYSINC');
    expect(memberInfoA?.file).toBe('H');
    expect(memberInfoA?.name).toBe('MATH');
    expect(memberInfoA?.extension).toBe('C');
    expect(memberInfoA?.text).toBe('STANDARD HEADER FILE MATH');

    const memberInfoB = await content?.getMemberInfo('QSYSINC', 'H', 'MEMORY');
    expect(memberInfoB).toBeTruthy();
    expect(memberInfoB?.library).toBe('QSYSINC');
    expect(memberInfoB?.file).toBe('H');
    expect(memberInfoB?.name).toBe('MEMORY');
    expect(memberInfoB?.extension).toBe('CPP');
    expect(memberInfoB?.text).toBe('C++ HEADER');

    try {
      await content?.getMemberInfo('QSYSINC', 'H', 'OH_NONO');
    } catch (error: any) {
      expect(error).toBeInstanceOf(Tools.SqlError);
      expect(error.sqlstate).toBe('38501');
    }
  });

  it('Test @clCommand + select statement', async () => {
    const content = connection.getContent();

    const [resultA] = await content.runSQL(`@CRTSAVF FILE(QTEMP/UNITTEST) TEXT('Code for i test');\nSelect * From Table(QSYS2.OBJECT_STATISTICS('QTEMP', '*FILE')) Where OBJATTRIBUTE = 'SAVF';`);

    expect(resultA.OBJNAME).toBe('UNITTEST');
    expect(resultA.OBJTEXT).toBe('Code for i test');

    const [resultB] = await content.runStatements(
      `@CRTSAVF FILE(QTEMP/UNITTEST) TEXT('Code for i test')`,
      `Select * From Table(QSYS2.OBJECT_STATISTICS('QTEMP', '*FILE')) Where OBJATTRIBUTE = 'SAVF'`
    );

    expect(resultB.OBJNAME).toBe('UNITTEST');
    expect(resultB.OBJTEXT).toBe('Code for i test');
  });

  it('should get attributes', async () => {
    const content = connection.getContent()
    await connection.withTempDirectory(async directory => {
      expect((await connection.sendCommand({ command: 'echo "I am a test file" > test.txt', directory })).code).toBe(0);
      const fileAttributes = await content.getAttributes(posix.join(directory, 'test.txt'), 'DATA_SIZE', 'OBJTYPE');
      expect(fileAttributes).toBeTruthy();
      expect(fileAttributes!.OBJTYPE).toBe('*STMF');
      expect(fileAttributes!.DATA_SIZE).toBe('17');

      const directoryAttributes = await content.getAttributes(directory, 'DATA_SIZE', 'OBJTYPE');
      expect(directoryAttributes).toBeTruthy();
      expect(directoryAttributes!.OBJTYPE).toBe('*DIR');
      expect(directoryAttributes!.DATA_SIZE).toBe('8192');
    });

    const qsysLibraryAttributes = await content.getAttributes('/QSYS.LIB/QSYSINC.LIB', 'ASP', 'OBJTYPE');
    expect(qsysLibraryAttributes).toBeTruthy();
    expect(qsysLibraryAttributes!.OBJTYPE).toBe('*LIB');
    expect(qsysLibraryAttributes!.ASP).toBe('1');

    const qsysFileAttributes = await content.getAttributes({ library: "QSYSINC", name: "H" }, 'ASP', 'OBJTYPE');
    expect(qsysFileAttributes).toBeTruthy();
    expect(qsysFileAttributes!.OBJTYPE).toBe('*FILE');
    expect(qsysFileAttributes!.ASP).toBe('1');

    const qsysMemberAttributes = await content.getAttributes({ library: "QSYSINC", name: "H", member: "MATH" }, 'ASP', 'OBJTYPE');
    expect(qsysMemberAttributes).toBeTruthy();
    expect(qsysMemberAttributes!.OBJTYPE).toBe('*MBR');
    expect(qsysMemberAttributes!.ASP).toBe('1');
  });

  it('should count members', async () => {
    const content = connection.getContent()
    const tempLib = connection.config?.tempLibrary;
    if (tempLib) {
      const file = Tools.makeid(8);
      const deleteSPF = async () => await connection.runCommand({ command: `DLTF FILE(${tempLib}/${file})`, noLibList: true });
      await deleteSPF();
      const createSPF = await connection.runCommand({ command: `CRTSRCPF FILE(${tempLib}/${file}) RCDLEN(112)`, noLibList: true });
      if (createSPF.code === 0) {
        try {
          const expectedCount = Math.floor(Math.random() * (10 - 5 + 1)) + 5;
          for (let i = 0; i < expectedCount; i++) {
            const createMember = await connection.runCommand({ command: `ADDPFM FILE(${tempLib}/${file}) MBR(MEMBER${i}) SRCTYPE(TXT)` });
            if (createMember.code) {
              throw new Error(`Failed to create member ${tempLib}/${file},MEMBER${i}: ${createMember.stderr}`);
            }
          }

          const count = await content.countMembers({ library: tempLib, name: file });
          expect(count).toBe(expectedCount);
        } finally {
          await deleteSPF();
        }
      } else {
        throw new Error(`Failed to create source physical file ${tempLib}/${file}: ${createSPF.stderr}`);
      }
    } else {
      throw new Error("No temporary library defined in configuration");
    }
  });

  it('should create streamfile', async () => {
    const content = connection.getContent()
    await connection.withTempDirectory(async dir => {
      const file = posix.join(dir, Tools.makeid());
      const fileExists = async () => content.testStreamFile(file, "f");
      expect(await fileExists()).toBe(false);
      await content.createStreamFile(file);
      expect(await fileExists()).toBe(true);
      const attributes = await content.getAttributes(file, "CCSID");
      expect(attributes).toBeTruthy();
      expect(attributes!.CCSID).toBe("1208");
    });
  });

  it('should handle long library name', async () => {
    const content = connection.getContent()
    const longName = Tools.makeid(18);
    const shortName = Tools.makeid(8);
    const createLib = await connection.runCommand({ command: `RUNSQL 'create schema "${longName}" for ${shortName}' commit(*none)`, noLibList: true });
    if (createLib.code === 0) {
      await connection.runCommand({ command: `CRTSRCPF FILE(${shortName}/SFILE) MBR(MBR) TEXT('Test long library name')` });

      const libraries = await content.getLibraries({ library: `${shortName}` });
      expect(libraries?.length).toBe(1);

      const objects = await content.getObjectList({ library: `${shortName}`, types: [`*SRCPF`], object: `SFILE` });
      expect(objects?.length).toBe(1);
      expect(objects[0].type).toBe(`*FILE`);
      expect(objects[0].text).toBe(`Test long library name`);

      const memberCount = await content.countMembers({ library: `${shortName}`, name: `SFILE` });
      expect(memberCount).toBe(1);
      const members = await content.getMemberList({ library: `${shortName}`, sourceFile: `SFILE` });

      expect(members?.length).toBe(1);

      await connection.runCommand({ command: `RUNSQL 'drop schema "${longName}"' commit(*none)`, noLibList: true });
    } else {
      throw new Error(`Failed to create schema "${longName}"`);
    }
  });

  it('getModuleExport', async () => {
    const content = connection.getContent();
    const config = connection.getConfig();
    const tempLib = config!.tempLibrary;
    const id: string = `${Tools.makeid().toUpperCase()}`;
    const source: string = `/tmp/vscodetemp-${id}.clle`;
    await content.runStatements(
      `CALL QSYS2.IFS_WRITE(PATH_NAME =>'${source}', 
                       LINE => 'PGM', 
                       OVERWRITE => 'NONE', 
                       END_OF_LINE => 'CRLF')`,
      `CALL QSYS2.IFS_WRITE(PATH_NAME =>'${source}', 
                       LINE => 'ENDPGM', 
                       OVERWRITE => 'APPEND', 
                       END_OF_LINE => 'CRLF')`,
      `@CRTCLMOD MODULE(${tempLib}/${id}) SRCSTMF('${source}')`,
      `select 1 from sysibm.sysdummy1`
    );
    let exports: ModuleExport[] = await content.getModuleExports(tempLib, id);
    
    expect(exports.length).toBe(1);
    expect(exports.at(0)?.symbol_name).toBe(id);

    await connection!.runCommand({
      command: `DLTMOD MODULE(${tempLib}/${id})`,
      environment: 'ile'
    });
    await connection!.runCommand({
      command: `DEL OBJLNK('${source}')`,
      environment: 'ile'
    });
  });

  it('getProgramExportImportInfo', async () => {
    const content = connection.getContent();
    const config = connection.getConfig();
    const tempLib = config!.tempLibrary;
    const id: string = `${Tools.makeid().toUpperCase()}`;
    const source: string = `/tmp/vscodetemp-${id}.clle`;
    await content.runStatements(
      `CALL QSYS2.IFS_WRITE(PATH_NAME =>'${source}', 
                       LINE => 'PGM', 
                       OVERWRITE => 'NONE', 
                       END_OF_LINE => 'CRLF')`,
      `CALL QSYS2.IFS_WRITE(PATH_NAME =>'${source}', 
                       LINE => 'ENDPGM', 
                       OVERWRITE => 'APPEND', 
                       END_OF_LINE => 'CRLF')`,
      `@CRTCLMOD MODULE(${tempLib}/${id}) SRCSTMF('${source}')`,
      `@CRTSRVPGM SRVPGM(${tempLib}/${id}) MODULE(${tempLib}/${id}) EXPORT(*ALL)`,
      `select 1 from sysibm.sysdummy1`
    );

    const info: ProgramExportImportInfo[] = (await content.getProgramExportImportInfo(tempLib, id, '*SRVPGM'))
      .filter(info => info.symbol_usage === '*PROCEXP');

    expect(info.length).toBe(1);
    expect(info.at(0)?.symbol_name).toBe(id);

    await connection!.runCommand({
      command: `DLTSRVPGM SRVPGM(${tempLib}/${id})`,
      environment: 'ile'
    });
    await connection!.runCommand({
      command: `DLTMOD MODULE(${tempLib}/${id})`,
      environment: 'ile'
    });
    await connection!.runCommand({
      command: `DEL OBJLNK('${source}')`,
      environment: 'ile'
    });
  });
});
