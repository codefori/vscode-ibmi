import * as dns from 'dns';
import { existsSync, readFileSync } from "fs";
import * as os from "os";
import path, { dirname } from "path";
import { promisify } from 'util';
import vscode from "vscode";
import { instance } from '../../instantiate';
import { t } from '../../locale';
import IBMi from "../IBMi";
import IBMiContent from '../IBMiContent';
import { Tools } from '../Tools';
import { DebugConfiguration } from './config';

type HostInfo = {
  ip: string
  hostName: string
}

export type ImportedCertificate = {
  localFile?: vscode.Uri
  remoteFile?: string
  password: string
}

const ENCRYPTION_KEY = ".code4i.debug";
const IP_REGEX = /^(([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\.){3}([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])$/gi;
const dnsLookup = promisify(dns.lookup);
export const SERVICE_CERTIFICATE = `debug_service.pfx`;
export const CLIENT_CERTIFICATE = `debug_service.crt`;

export const LEGACY_CERT_DIRECTORY = `/QIBM/ProdData/IBMiDebugService/bin/certs`;

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

/**
 * Generate debug service certifciate
 */
export async function setup(connection: IBMi, imported?: ImportedCertificate) {
  await vscode.window.withProgress({ title: "Configuring debug service", location: vscode.ProgressLocation.Window }, async () => {
    if (!connection.usingBash()) {
      if (connection.remoteFeatures[`bash`]) {
        throw new Error(`Bash is installed on the IBM i, but it is not your default shell. Please switch to bash to setup the debug service.`);
      } else {
        throw new Error(`The debug service setup requires bash to be installed on the IBM i. Please install bash and try again.`);
      }
    }

    const debugConfig = await new DebugConfiguration().load();

    const certificatePath = debugConfig.getRemoteServiceCertificatePath();
    const directory = dirname(certificatePath);
    const mkdirResult = await connection.sendCommand({
      command: `mkdir -p ${directory}`
    });

    if (mkdirResult.code && mkdirResult.code > 0) {
      throw new Error(`Failed to create server certificate directory ${directory}: ${mkdirResult.stderr}`);
    }

    let password;
    if (imported) {
      password = imported.password;
      if (imported.localFile) {
        await connection.uploadFiles([{ local: imported.localFile, remote: debugConfig.getRemoteServiceCertificatePath() }]);
      }
      else if (imported.remoteFile) {
        const copy = await connection.sendCommand({ command: `cp ${imported.remoteFile} ${debugConfig.getRemoteServiceCertificatePath()}` });
        if (copy.code) {
          throw copy.stderr;
        }
      }
      const clientCertificate = await connection.sendCommand({
        command: `openssl pkcs12 -in ${debugConfig.getRemoteServiceCertificatePath()} -passin pass:${password} -info -nokeys -clcerts 2>/dev/null | openssl x509 -outform PEM`,
      });
      try {
        if (!clientCertificate.code) {
          instance.getContent()!.writeStreamfileRaw(debugConfig.getRemoteClientCertificatePath(), Buffer.from(clientCertificate.stdout), "utf-8");
          await connection.sendCommand({ command: "chmod 444 debug_service.*", directory });
        }
        else {
          throw clientCertificate.stderr;
        }
      }
      catch (error) {
        await connection.sendCommand({ command: `rm ${SERVICE_CERTIFICATE}`, directory });
        throw new Error(`Failed to import service certificate: ${error}`);
      }
    }
    else {
      password = Tools.makeid(50);
      const hostInfo = await getHostInfo(connection);
      const extFileContent = await getExtFileContent(hostInfo);
      const commands = [
        `openssl genrsa -out debug_service.key 2048`,
        `openssl req -new -key debug_service.key -out debug_service.csr -subj '/CN=${hostInfo.hostName}'`,
        `openssl x509 -req -in debug_service.csr -signkey debug_service.key -out ${CLIENT_CERTIFICATE} -days 1095 -sha256 -req -extfile <(printf "${extFileContent}")`,
        `openssl pkcs12 -export -out ${SERVICE_CERTIFICATE} -inkey debug_service.key -in ${CLIENT_CERTIFICATE} -password pass:${password}`,
        `rm debug_service.key debug_service.csr`,
        `chmod 444 debug_service.*`
      ];

      const creationResults = await connection.sendCommand({
        command: commands.join(` && `),
        directory
      });

      if (creationResults.code && creationResults.code > 0) {
        throw new Error(`Failed to create server certificate: ${creationResults.stderr}`);
      }
    }

    try {
      if (debugConfig.get("DEBUG_SERVICE_KEYSTORE_PASSWORD") !== undefined) {
        debugConfig.delete("DEBUG_SERVICE_KEYSTORE_PASSWORD");
        await debugConfig.save();
      }
      const encryptResult = await connection.sendCommand({
        command: `${path.posix.join(debugConfig.getRemoteServiceBin(), `encryptKeystorePassword.sh`)} | /usr/bin/tail -n 1`,
        env: {
          DEBUG_SERVICE_KEYSTORE_PASSWORD: password
        }
      });

      if (!encryptResult.code) {
        const backupKey = await connection.sendCommand({ command: `cp key.properties ${ENCRYPTION_KEY}`, directory: debugConfig.getRemoteServiceWorkDir() });
        if (!backupKey.code) {
          debugConfig.set("DEBUG_SERVICE_KEYSTORE_FILE", certificatePath);
          debugConfig.set("DEBUG_SERVICE_KEYSTORE_PASSWORD", encryptResult.stdout);
          debugConfig.set("CODE4IDEBUG", `$([ -f $DBGSRV_WRK_DIR/${ENCRYPTION_KEY} ] && cp $DBGSRV_WRK_DIR/${ENCRYPTION_KEY} $DBGSRV_WRK_DIR/key.properties)`);
          debugConfig.save();
        }
        else {
          throw new Error(`Failed to backup encryption key: ${backupKey.stderr}`);
        }
      }
      else {
        throw new Error(`Failed to encrypt service certificate password: ${encryptResult.stdout || encryptResult.stderr}`);
      }
    }
    catch (error) {
      //At this point, the certificate is deemed unusable and must be removed
      await connection.sendCommand({ command: `rm ${SERVICE_CERTIFICATE}`, directory });
      throw error;
    }
  });
}

export async function remoteCertificatesExists(debugConfig?: DebugConfiguration) {
  const content = instance.getContent();
  if (content) {
    debugConfig = debugConfig || await new DebugConfiguration().load();
    return await content.testStreamFile(debugConfig.getRemoteServiceCertificatePath(), "f") && await content.testStreamFile(debugConfig.getRemoteClientCertificatePath(), "f");
  }
  else {
    throw new Error("Not connected to an IBM i");
  }
}

export async function downloadClientCert(connection: IBMi) {
  const content = instance.getContent();
  if (content) {
    await content.downloadStreamfileRaw((await new DebugConfiguration().load()).getRemoteClientCertificatePath(), getLocalCertPath(connection));
  }
  else {
    throw new Error("Not connected to an IBM i");
  }
}

export function getLocalCertPath(connection: IBMi) {
  const host = connection.currentHost;
  return path.join(os.homedir(), `${host}_${CLIENT_CERTIFICATE}`);
}

export async function checkClientCertificate(connection: IBMi, debugConfig?: DebugConfiguration) {
  const locaCertificatePath = getLocalCertPath(connection);
  if (existsSync(locaCertificatePath)) {
    debugConfig = debugConfig || await new DebugConfiguration().load();
    const remote = (await connection.sendCommand({ command: `cat ${debugConfig.getRemoteClientCertificatePath()}` }));
    if (!remote.code) {
      const localCertificate = readFileSync(locaCertificatePath).toString("utf-8");
      if (localCertificate.trim() !== remote.stdout.trim()) {
        throw new Error(t('local.dont.match.remote'));
      }
    }
    else {
      throw new Error(`Could not read client certificate on host: ${remote.stderr}`);
    }
  }
  else {
    throw new Error(t('local.certificate.not.found'));
  }
}

export async function sanityCheck(connection: IBMi, content: IBMiContent) {
  //Since Code for IBM i v2.10.0, the debug configuration is managed from the debug service .env file
  //The encryption key is backed up since it's destroyed every time the service starts up
  //The remote certificate is only valid if the client certificate is found too
  const debugConfig = await new DebugConfiguration().load();
  const remoteCertExists = await content.testStreamFile(debugConfig.getRemoteServiceCertificatePath(), "f");
  const remoteClientCertExists = await content.testStreamFile(debugConfig.getRemoteClientCertificatePath(), "f");
  const encryptionKeyExists = await content.testStreamFile(`${debugConfig.getRemoteServiceWorkDir()}/${ENCRYPTION_KEY}`, "f");
  const legacyCertExists = await content.testStreamFile(`${LEGACY_CERT_DIRECTORY}/${SERVICE_CERTIFICATE}`, "f");

  if ((encryptionKeyExists && remoteCertExists && remoteClientCertExists) || (!legacyCertExists && !remoteCertExists)) {
    //We're good! Let's clean up the legacy certificate if needed
    if (legacyCertExists) {
      await connection.sendCommand({
        command: `rm -rf ${LEGACY_CERT_DIRECTORY}`,
      })
    }
  }
  else {
    try {
      if (legacyCertExists && !remoteCertExists) {
        //import legacy
        await setup(connection, { remoteFile: `${LEGACY_CERT_DIRECTORY}/${SERVICE_CERTIFICATE}`, password: connection.currentHost });
        await connection.sendCommand({
          command: `rm -rf ${LEGACY_CERT_DIRECTORY}`,
        });
      }
      else if (remoteCertExists && !(remoteClientCertExists && encryptionKeyExists)) {
        //This is probably a certificate whose password was the connection's hostname; we can reimport it to set everything right
        await setup(connection, { password: connection.currentHost });
      }
    }
    catch (error) {
      vscode.window.showWarningMessage(`Debug service sanity check failed (${error}); the debug service certificate should be re-generated`, "Regenerate")
        .then(regen => {
          if (regen) {
            vscode.commands.executeCommand(`code-for-ibmi.debug.setup.remote`);
          }
        });
    }
  }
}