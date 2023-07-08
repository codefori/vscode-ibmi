import path from "path";
import {promises as fs} from "fs";
import * as os from "os";
import IBMi from "../IBMi";

const pfxName = `debug_service.pfx`;
const crtName = `debug_service.crt`;

function getRemoteCertDirectory(connection: IBMi) {
  return connection.config?.debugCertDirectory!;
}

export function getKeystorePath(connection: IBMi) {
  return path.posix.join(getRemoteCertDirectory(connection), pfxName);
}

export function getLocalCertPath(connection: IBMi) {
  const host = connection.currentHost;
  return path.join(os.homedir(), `${host}_${crtName}`);
}

export async function checkRemoteExists(connection: IBMi) {
  const pfxPath = getKeystorePath(connection);

  const dirList = await connection.sendCommand({
    command: `ls -p ${pfxPath}`
  });

  const list = dirList.stdout.split(`\n`);

  return list.includes(pfxPath);
}

export async function setup(connection: IBMi) {
  const host = connection.currentHost;
  const commands = [
    `openssl genrsa -out debug_service_ca.key 2048`,
    `openssl req -x509 -new -nodes -key debug_service_ca.key -sha256 -days 1825 -out debug_service_ca.pem -subj '/CN=${host}'`,
    `openssl genrsa -out debug_service.key 2048`,
    `openssl req -new -key debug_service.key -out debug_service.csr -subj '/CN=${host}'`,
    `openssl x509 -req -in debug_service.csr -CA debug_service_ca.pem -CAkey debug_service_ca.key -CAcreateserial -out debug_service.crt -days 1095 -sha256`,
    `openssl pkcs12 -export -out debug_service.pfx -inkey debug_service.key -in debug_service.crt -password pass:${host}`
  ];

  const directory = getRemoteCertDirectory(connection);

  const mkdirResult = await connection.sendCommand({
    command: `mkdir -p ${directory}`
  });

  if (mkdirResult.code && mkdirResult.code > 0) {
    throw new Error(`Failed to create certificate directory: ${directory}`);
  }

  const creationResults = await connection.sendCommand({
    command: commands.join(` && `),
    directory
  });

  if (creationResults.code && creationResults.code > 0) {
    throw new Error(`Failed to create certificates.`);
  }
}

export async function checkLocalExists(connection: IBMi) {
  try {
    await fs.stat(getLocalCertPath(connection));
    // TODO: if local exists, but it's out of date with the server? e.g. md5 is different for example
    return true;
  } catch (e) {
    return false;
  }
}