import assert from "assert";
import { randomInt } from "crypto";
import { posix } from "path";
import tmp from 'tmp';
import util, { TextDecoder } from 'util';
import { Uri, workspace } from "vscode";
import { TestSuite } from ".";
import { Tools } from "../api/Tools";
import { getMemberUri } from "../filesystems/qsys/QSysFs";
import { instance } from "../instantiate";
import { CommandResult } from "../typings";
import IBMi from "../api/IBMi";
import { Search } from "../api/Search";

const LIBNAME = `VSCODELIBT`;
const SPFNAME = `VSCODESPFT`;
const MBRNAME = `VSCODEMBRT`;

function checkAsps(connection: IBMi) {
  const asps = connection.getAllIAsps();
  assert.ok(asps?.length, `ASP list is empty`);

  const currentAsp = connection.getCurrentIAspName();
  assert.ok(currentAsp, `Current ASP not defined`);
}

async function ensureLibExists(connection: IBMi) {
  const detail = connection.getIAspDetail(connection.getCurrentIAspName()!)!;
  const res = await connection.runCommand({command: `CRTLIB LIB(${LIBNAME}) ASP(${detail.id})`});
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

  const uploadResult = await content?.uploadMemberContent(undefined, LIBNAME, SPFNAME, MBRNAME, baseContent);
  assert.ok(uploadResult);
}

export const AspSuite: TestSuite = {
  name: `ASP API tests`,
  before: async () => {
    const connection = instance.getConnection()!;
    checkAsps(connection);
    await ensureLibExists(connection);
  },
  tests: [
    {
      name: `Read members in ASP and base`, test: async () => {
        const connection = instance.getConnection()!;
        checkAsps(connection);
        
        await ensureLibExists(connection);
        await createTempRpgle(connection);

        const aspUri = getMemberUri({ asp: connection.getCurrentIAspName(), library: LIBNAME, file: SPFNAME, name: MBRNAME, extension: `rpgle` });

        // We have to read it first to create the alias!
        const aspMbrContents = await workspace.fs.readFile(aspUri);
        
        assert.ok(aspMbrContents);
      }
    },
  ]
};
