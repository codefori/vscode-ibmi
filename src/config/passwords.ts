import { ExtensionContext } from "vscode";

const getPasswordKey = (connectionName: string) => `${connectionName}_password`;
const getPassphraseKey = (connectionName: string) => `${connectionName}_passphrase`;

export function getStoredPassword(context: ExtensionContext, connectionName: string) {
  return context.secrets.get(getPasswordKey(connectionName));
}

export function setStoredPassword(context: ExtensionContext, connectionName: string, password: string) {
  return context.secrets.store(getPasswordKey(connectionName), password);
}

export function deleteStoredPassword(context: ExtensionContext, connectionName: string) {
  return context.secrets.delete(getPasswordKey(connectionName));
}

export function getStoredPassphrase(context: ExtensionContext, connectionName: string) {
  return context.secrets.get(getPassphraseKey(connectionName));
}

export function setStoredPassphrase(context: ExtensionContext, connectionName: string, passphrase: string) {
  return context.secrets.store(getPassphraseKey(connectionName), passphrase);
}

export function deleteStoredPassphrase(context: ExtensionContext, connectionName: string) {
  return context.secrets.delete(getPassphraseKey(connectionName));
}