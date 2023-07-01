import { Locale } from "..";

export const en: Locale = {
  'Yes': `Yes`,
  'No': `No`,
  'sandbox.input.user.title': `User for server`,
  'sandbox.input.user.prompt': `Enter username for {0}`,
  'sandbox.input.password.title': `Password for server`,
  'sandbox.input.password.prompt': `Enter password for {0}@{1}`,
  'sandbox.failedToConnect.text': 'Failed to connect to {0} as {1}',
  'sandbox.failedToConnect.title': `Failed to connect`,
  'sandbox.noPassword': `Connection to {0} ended as no password was provided.`,
  'sandbox.alreadyConnected': `This Visual Studio Code instance is already connected to a server.`,
  'sandbox.connected.modal.title': `Thanks for trying the Code for IBM i Sandbox!`,
  'sandbox.connected.modal.detail': `You are using this system at your own risk. Do not share any sensitive or private information.`,
  'sandbox.noconnection.modal.title': `Oh no! The sandbox is down.`,
  'sandbox.noconnection.modal.detail': `Sorry, but the sandbox is offline right now. Try again another time.`,
  // ConnectionBrowser:
  'connectionBrowser.connectTo.lastConnection': `Last connection`,
  'connectionBrowser.connectTo.lastUsed': `Last used: {0}`,
  'connectionBrowser.connectTo.title': `Last IBM i connections`,
  'connectionBrowser.connectTo.error': `Use the Server Browser to select which system to connect to.`,
  'connectionBrowser.deleteConnection.warning': `Are you sure you want to delete the connection {0}?`,
  'connectionBrowser.ServerItem.tooltip': ` (previous connection)`,
  'connectionBrowser.ServerItem.title': `Connect`
};