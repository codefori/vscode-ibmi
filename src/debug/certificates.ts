import { existsSync, readFileSync } from "fs";
import * as os from "os";
import path, {  } from "path";
import vscode from "vscode";
import IBMi from "../api/IBMi";
import { DebugConfiguration, CLIENT_CERTIFICATE } from '../api/configuration/DebugConfiguration';
import { instance } from "../instantiate";


export type ImportedCertificate = {
  localFile?: vscode.Uri
  remoteFile?: string
  password: string
}

export async function remoteCertificatesExists(debugConfig?: DebugConfiguration) {
  const connection = instance.getConnection();
  if (connection) {
    const content = connection.getContent();
    debugConfig = debugConfig || await new DebugConfiguration(connection).load();
    return await content.testStreamFile(debugConfig.getRemoteClientCertificatePath(), "f");
  }
  else {
    throw new Error("Not connected to an IBM i");
  }
}

export async function downloadClientCert(connection: IBMi) {
  const content = connection.getContent();
  const debugConfig = await new DebugConfiguration(connection).load();

  await content.downloadStreamfileRaw(debugConfig.getRemoteClientCertificatePath(), getLocalCertPath(connection));
}

export function getLocalCertPath(connection: IBMi) {
  const host = connection.currentHost;
  return path.join(os.homedir(), `${host}_${CLIENT_CERTIFICATE}`);
}

export async function checkClientCertificate(connection: IBMi, debugConfig?: DebugConfiguration) {
  const locaCertificatePath = getLocalCertPath(connection);
  if (existsSync(locaCertificatePath)) {
    debugConfig = debugConfig || await new DebugConfiguration(connection).load();
    const remote = (await connection.sendCommand({ command: `cat ${debugConfig.getRemoteClientCertificatePath()}` }));
    if (!remote.code) {
      const localCertificate = readFileSync(locaCertificatePath).toString("utf-8");
      if (localCertificate.trim() !== remote.stdout.trim()) {
        throw new Error(vscode.l10n.t(`Local certificate doesn't match remote`));
      }
    }
    else {
      throw new Error(`Could not read client certificate on host: ${remote.stderr}`);
    }
  }
  else {
    throw new Error(vscode.l10n.t(`Local certificate not found`));
  }
}