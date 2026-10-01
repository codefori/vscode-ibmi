import { existsSync, mkdirSync, readFileSync, unlinkSync } from "fs";
import * as os from "os";
import path, {  } from "path";
import vscode from "vscode";
import IBMi from "../api/IBMi";
import { DebugConfiguration, CLIENT_CERTIFICATE } from '../api/configuration/DebugConfiguration';
import { instance } from "../instantiate";

const CERTIFICATE_DIRECTORY_SETTING = `debug.certificateDirectory`;


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
  const localCertPath = getLocalCertPath(connection);

  mkdirSync(path.dirname(localCertPath), { recursive: true });
  await content.downloadStreamfileRaw(debugConfig.getRemoteClientCertificatePath(), localCertPath);
}

export function getCertificateDirectory() {
  const configured = IBMi.connectionManager.get(CERTIFICATE_DIRECTORY_SETTING);
  return configured?.trim() || os.homedir();
}

export function getLocalCertPath(connection: IBMi) {
  const host = connection.currentHost;
  return path.join(getCertificateDirectory(), `${host}_${CLIENT_CERTIFICATE}`);
}

export function getRecommendedCertDirectory(context: vscode.ExtensionContext) {
  return context.globalStorageUri.fsPath;
}

export function isUsingRecommendedCertDirectory(context: vscode.ExtensionContext) {
  const current = path.resolve(getCertificateDirectory());
  const recommended = path.resolve(getRecommendedCertDirectory(context));
  // Windows/macOS filesystems are typically case-insensitive, so a differently-cased
  // drive letter or path segment shouldn't be treated as a different directory.
  return process.platform === `win32` || process.platform === `darwin`
    ? current.toLowerCase() === recommended.toLowerCase()
    : current === recommended;
}

export async function useRecommendedCertDirectory(context: vscode.ExtensionContext, connection: IBMi) {
  const oldCertPath = getLocalCertPath(connection);
  const recommendedDir = getRecommendedCertDirectory(context);

  await IBMi.connectionManager.set(CERTIFICATE_DIRECTORY_SETTING, recommendedDir);
  await downloadClientCert(connection);

  const newCertPath = getLocalCertPath(connection);
  if (newCertPath !== oldCertPath && existsSync(oldCertPath)) {
    unlinkSync(oldCertPath);
  }
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