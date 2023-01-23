import { ExtensionContext, Uri } from "vscode";
import Instance from "./Instance";

const vscode = require(`vscode`);
const path = require(`path`);

const Configuration = require(`./Configuration`);
const IBMi = require(`./IBMi`);

/**
 * @param {*} instance 
 * @param {vscode.ExtensionContext} context 
 */
export function initialise(instance: Instance, context: ExtensionContext) {
  const startDebugging = (options: DebugOptions) => {
    exports.startDebug(instance, options);
  }

  /** @param {vscode.Uri} uri */
  const getObjectFromUri = (uri: Uri) => {
    /** @type {IBMi} */
    const connection = instance.getConnection();
  
    /** @type {Configuration} */
    const configuration = instance.getConfig();
    
    const qualifiedPath: {
      library: string|undefined,
      object: string|undefined
    } = {library: undefined, object: undefined};

    if (connection && configuration) {

    switch (uri.scheme) {
    case `member`:
      const memberPath = connection.parserMemberPath(uri.path);
      qualifiedPath.library = memberPath.library;
      qualifiedPath.object = memberPath.member;
      break;
    case `streamfile`:
    case `file`:
      const parsedPath = path.parse(uri.path);
      qualifiedPath.library = configuration.currentLibrary;
      qualifiedPath.object = parsedPath.name;
      break;
    }

    if (qualifiedPath.object) {
      // Remove .pgm ending potentially
      qualifiedPath.object = qualifiedPath.object.toUpperCase();
      if (qualifiedPath.object.endsWith(`.PGM`))
        qualifiedPath.object = qualifiedPath.object.substring(0, qualifiedPath.object.length - 4);
    }
  }

    return qualifiedPath;
  }

  const getPassword = async () => {
    /** @type {IBMi} */
    const connection = instance.getConnection();

    let password = await context.secrets.get(`${connection!.currentConnectionName}_password`);
    if (!password) {
      password = await vscode.window.showInputBox({
        password: true,
        prompt: `Password for user profile ${connection!.currentUser} is required to debug.`
      });
    }

    return password;
  }
  
  context.subscriptions.push(
    vscode.commands.registerCommand(`code-for-ibmi.debug.activeEditor`, async () => {
      const activeEditor = vscode.window.activeTextEditor;

      if (activeEditor) {
        const qualifiedObject = getObjectFromUri(activeEditor.document.uri);
        const password = await getPassword();

        if (password && qualifiedObject.library && qualifiedObject.object) {
          const debugOpts: DebugOptions = {
            password,
            library: qualifiedObject.library,
            object: qualifiedObject.object
          };

          startDebugging(debugOpts);
        }
      }
    })
  )
}

interface DebugOptions {
  password: string;
  library: string;
  object: string;
};

export async function startDebug(instance: Instance, options: DebugOptions) {
  /** @type {IBMi} */
  const connection = instance.getConnection();
  const port = `8005`; //TODO: make configurable
  const updateProductionFiles = false; // TODO: configurable
  const enableDebugTracing = false; // TODO: configurable

  const secure = false; // TODO: make configurable

  if (secure) {
    // TODO: automatically download .p12, decode and place into local filesystem
    process.env[`DEBUG_CA_PATH`] = `/Users/barry/Downloads/merlin-https-cert.ca.crt`
  }

  const config = {
    "type": `IBMiDebug`,
    "request": `launch`,
    "name": `Remote debug: Launch a batch debug session`,
    "user": connection!.currentUser.toUpperCase(),
    "password": options.password,
    "host": connection!.currentHost,
    "port": port,
    "secure": secure,  // Enforce secure mode
    "ignoreCertificateErrors": !secure,
    "library": options.library.toUpperCase(),
    "program": options.object.toUpperCase(),
    "startBatchJobCommand": `SBMJOB CMD(CALL PGM(` + options.library + `/` + options.object + `))`,
    "updateProductionFiles": updateProductionFiles,
    "trace": enableDebugTracing,
  };

  vscode.debug.startDebugging(undefined, config, undefined);
}