import * as dns from 'dns';
import { promises as fs } from "fs";
import * as os from "os";
import path from "path";
import { promisify } from 'util';
import { ConnectionConfiguration } from "../Configuration";
import IBMi from "../IBMi";

type HostInfo = {
  ip: string
  hostName: string
}

const IP_REGEX = /^(([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\.){3}([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])$/gi;
const dnsLookup = promisify(dns.lookup);
const SERVER_CERTIFICATE = `debug_service.pfx`;
const CLIENT_CERTIFICATE = `debug_service.crt`;

export const LEGACY_CERT_DIRECTORY = `/QIBM/ProdData/IBMiDebugService/bin/certs`;
export const DEFAULT_CERT_DIRECTORY = `/QIBM/UserData/IBMiDebugService/certs`;

export function getRemoteCertificateDirectory(connection: IBMi) {
  return connection.config?.debugCertDirectory!;
}

async function getHostInfo(connection: IBMi): Promise<HostInfo> {
  const hostName = (await connection.sendCommand({ command: `hostname` })).stdout;
  if (!hostName) {
    throw new Error(`Hostname is undefined on ${connection.currentHost}; please fix the TCP/IP configuration.`);
  }

  let ip;
  try {
    ip = (await dnsLookup(hostName)).address
  }
  catch (error) {
    if (IP_REGEX.test(connection.currentHost)) {
      ip = connection.currentHost;
    }
    else {
      throw new Error(`IP address for ${hostName} could not be resolved: ${error}`);
    }
  }

  return { hostName, ip };
}

async function getExtFileContent(hostInfo: HostInfo) {
  let extFileContent;
  if (hostInfo.ip && hostInfo.hostName) {
    extFileContent = `subjectAltName=DNS:${hostInfo.hostName},IP:${hostInfo.ip}`;
  } else if (hostInfo.hostName) {
    extFileContent = `subjectAltName=DNS:${hostInfo.hostName}`;
  } else {
    extFileContent = `subjectAltName=IP:${hostInfo.ip}`;
  }

  return extFileContent;
}

function getLegacyCertificatePath() {
  return path.posix.join(LEGACY_CERT_DIRECTORY, SERVER_CERTIFICATE);
}

export function getRemoteServerCertificatePath(connection: IBMi) {
  return path.posix.join(getRemoteCertificateDirectory(connection), SERVER_CERTIFICATE);
}

export async function remoteServerCertificateExists(connection: IBMi, legacy = false) {
  const pfxPath = legacy ? getLegacyCertificatePath() : getRemoteServerCertificatePath(connection);

  const dirList = await connection.sendCommand({
    command: `ls -p ${pfxPath}`
  });

  const list = dirList.stdout.split(`\n`);

  return list.includes(pfxPath);
}

/**
 * Generate debug service certifciate
 */
export async function setup(connection: IBMi) {
  if (!connection.usingBash()) {
    if (connection.remoteFeatures[`bash`]) {
      throw new Error(`Bash is installed on the IBM i, but it is not your default shell. Please switch to bash to setup the debug service.`);
    } else {
      throw new Error(`The debug service setup requires bash to be installed on the IBM i. Please install bash and try again.`);
    }
  }

  const hostInfo = await getHostInfo(connection);
  const extFileContent = await getExtFileContent(hostInfo);
  const commands = [
    `openssl genrsa -out debug_service.key 2048`,
    `openssl req -new -key debug_service.key -out debug_service.csr -subj '/CN=${hostInfo.hostName}'`,
    `openssl x509 -req -in debug_service.csr -signkey debug_service.key -out debug_service.crt -days 1095 -sha256 -req -extfile <(printf "${extFileContent}")`,
    `openssl pkcs12 -export -out debug_service.pfx -inkey debug_service.key -in debug_service.crt -password pass:${hostInfo.hostName}`,
    `rm debug_service.key debug_service.csr debug_service.crt`,
    `chmod 444 debug_service.pfx`
  ];

  const directory = getRemoteCertificateDirectory(connection);

  const mkdirResult = await connection.sendCommand({
    command: `mkdir -p ${directory}`
  });

  if (mkdirResult.code && mkdirResult.code > 0) {
    throw new Error(`Failed to create server certificate directory ${directory}: ${mkdirResult.stderr}`);
  }

  const creationResults = await connection.sendCommand({
    command: commands.join(` && `),
    directory
  });

  if (creationResults.code && creationResults.code > 0) {
    throw new Error(`Failed to create server certificate: ${creationResults.stderr}`);
  }
}

export async function downloadClientCert(connection: IBMi) {
  const localPath = getLocalCertPath(connection);
  await fs.writeFile(localPath, await readRemoteCertificate(connection), { encoding: `utf8` });
}

export async function readRemoteCertificate(connection: IBMi) {
  const keyPass = (await getHostInfo(connection)).hostName;

  const result = await connection.sendCommand({
    command: `openssl pkcs12 -in ${getRemoteServerCertificatePath(connection)} -passin pass:${keyPass} -info -nokeys -clcerts 2>/dev/null | openssl x509 -outform PEM`,
    directory: getRemoteCertificateDirectory(connection)
  });

  if (result.code && result.code > 0) {
    throw new Error(`Failed to download client certificate: ${result.stderr}`);
  }

  return result.stdout;
}

export function getLocalCertPath(connection: IBMi) {
  const host = connection.currentHost;
  return path.join(os.homedir(), `${host}_${CLIENT_CERTIFICATE}`);
}

export async function localClientCertExists(connection: IBMi) {
  try {
    await fs.stat(getLocalCertPath(connection));
    // TODO: if local exists, but it's out of date with the server? e.g. md5 is different for example
    return true;
  } catch (e) {
    return false;
  }
}

export async function legacyCertificateChecks(connection: IBMi, serviceIsRunning: boolean) {
  // We need to migrate away from using the old legacy directory to a new one if
  // the user has the old directory configured but isn't running the server
  const usingLegacyCertPath = (getRemoteCertificateDirectory(connection) === LEGACY_CERT_DIRECTORY);
  const certsExistAtConfig = await remoteServerCertificateExists(connection);

  let changeCertDirConfig: string | undefined;

  if (usingLegacyCertPath) {
    if (serviceIsRunning) {
      // The server is running and they still have the legacy path configured. Do certs exist inside of the legacy path?

      // If the legacy certs do exist, it might be using them!

      // If not...
      if (!certsExistAtConfig) {
        // The server is running but the certs don't exist in the legacy path. 
        // Let's change their default path from the legacy path to the new default path!
        changeCertDirConfig = DEFAULT_CERT_DIRECTORY;
      }

    } else {
      // The server isn't running. Let's change their default path from the legacy path
      // to the new default path! And even.. let's try and delete the old certs directory!
      changeCertDirConfig = DEFAULT_CERT_DIRECTORY;

      // To be safe, let's try to delete the old directory.
      // We don't care if it fails really.
      await connection.sendCommand({
        command: `rm -rf ${LEGACY_CERT_DIRECTORY}`,
      })
    }
  } else {
    // If the config isn't using the legacy path, we should check if the legacy certificates exist

    if (serviceIsRunning) {
      if (!certsExistAtConfig) {
        // The server is running but the certs don't exist in the new path, let's
        // check if they exist at the legacy path and switch back to that
        const legacyCertsExist = await remoteServerCertificateExists(connection, true);
        if (legacyCertsExist) {
          changeCertDirConfig = LEGACY_CERT_DIRECTORY;
        }
      }
    }
  }

  if (changeCertDirConfig) {
    await ConnectionConfiguration.update({
      ...connection.config!,
      debugCertDirectory: changeCertDirConfig
    })
  }
}