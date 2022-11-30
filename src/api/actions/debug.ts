import { debug } from "vscode";

export function launchRemoteDebug(config: RemoteDebugConfig) {
  /** @type {WorkspaceFolder} */
  const workspace = config.workspace;

  switch (config.type) {
  case `node`:
    return debug.startDebugging(workspace, {
      type: `node`,
      name: `Node.js Attach`,
      request: `attach`,
      localRoot: workspace.uri.fsPath,
      address: config.address,
      port: config.port,
      remoteRoot: config.remoteRoot,
      skipFiles: [
        `<node_internals>/**`
      ]
    });

  case `python`:
    return debug.startDebugging(workspace, {
      "name": `Python: Attach`,
      "type": `python`,
      "request": `attach`,
      "connect": {
        "host": config.address,
        "port": config.port
      },
      "pathMappings": [
        {
          "localRoot": workspace.uri.fsPath, // Maps C:\Users\user1\project1
          "remoteRoot": config.remoteRoot // To current working directory ~/project1
        }
      ],
      "stopOnEntry": true,
      "justMyCode": false
    })
    break;
  
  default:
  }
}