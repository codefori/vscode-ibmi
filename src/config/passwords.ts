import { ExtensionContext } from "vscode";

const getPasswordKey = (connectionName: string) => `${connectionName}_password`;

export function getStoredPassword(context: ExtensionContext, connectionName: string) {
  const connectionKey = getPasswordKey(connectionName);
  return context.secrets.get(connectionKey);
}

export function setStoredPassword(context: ExtensionContext, connectionName: string, password: string) {
  const connectionKey = getPasswordKey(connectionName);
  return context.secrets.store(connectionKey, password);
}

export function deleteStoredPassword(context: ExtensionContext, connectionName: string) {
  const connectionKey = getPasswordKey(connectionName);
  return context.secrets.delete(connectionKey);
}