
import path from 'path';
import vscode, { commands } from 'vscode';
import { instance } from '../instantiate';
import IBMi from '../api/IBMi';
import { Tools } from '../api/Tools';

const PASE_INIT_FLAG = '#C4IINIT';
const PASE_INIT_FLAG_REGEX = /#+C+4+I+I+N+I+T+$/

function getOrDefaultToUndefined(value: string) {
  if (value && value !== `default`) {
    return value;
  }
}

export namespace Terminal {
  export enum TerminalType {
    PASE = "PASE",
    _5250 = "5250"
  }

  const typeItems = Object.values(TerminalType).map(entry => {
    return {
      label: entry,
      type: entry
    }
  });

  type TerminalSettings = {
    type: TerminalType
    location: vscode.TerminalLocation
    encoding?: string
    terminal?: string
    name?: string
    connectionString?: string
    currentDirectory?: string
  }

  let terminalCount = 0;

  function setHalted(state: boolean) {
    commands.executeCommand(`setContext`, `code-for-ibmi:term5250Halted`, state);
  }

  const BACKSPACE = 127;
  const RESET = 18;
  const ATTENTION = 1;
  const TAB = 9;

  export function registerTerminalCommands(context: vscode.ExtensionContext) {
    return [
      vscode.commands.registerCommand(`code-for-ibmi.launchTerminalPicker`, () => {
        return selectAndOpen(context);
      }),

      vscode.commands.registerCommand(`code-for-ibmi.openTerminalHere`, async (ifsNode) => {
        const content = instance.getConnection()?.getContent();
        if (content) {
          const ifsPath = (await content.isDirectory(ifsNode.path)) ? ifsNode.path : path.dirname(ifsNode.path);
          await selectAndOpen(context, { openType: TerminalType.PASE, currentDirectory: ifsPath });
        }
      }),

      vscode.commands.registerCommand(`code-for-ibmi.term5250.resetPosition`, () => {
        const term = vscode.window.activeTerminal;
        if (term) {
          term.sendText(Buffer.from([RESET, TAB]).toString(), false);
          setHalted(false);
        }
      })
    ];
  }

  async function selectAndOpen(context: vscode.ExtensionContext, options?: { openType?: TerminalType, currentDirectory?: string }) {
    const connection = instance.getConnection();
    if (connection) {
      const configuration = connection.getConfig();
      const type = options?.openType || (await vscode.window.showQuickPick(typeItems, {
        placeHolder: `Select a terminal type`
      }))?.type;

      if (type) {
        const terminalSettings: TerminalSettings = {
          type,
          location: IBMi.connectionManager.get<boolean>(`terminals.${type.toLowerCase()}.openInEditorArea`) ? vscode.TerminalLocation.Editor : vscode.TerminalLocation.Panel,
          connectionString: configuration.connectringStringFor5250,
          currentDirectory: options?.currentDirectory
        };

        if (terminalSettings.type === TerminalType._5250) {
          if (!connection.remoteFeatures.tn5250) {
            vscode.window.showErrorMessage(`5250 terminal is not supported. Please install tn5250 via yum on the remote system.`);
            return;
          }

          terminalSettings.encoding = getOrDefaultToUndefined(configuration.encodingFor5250);
          terminalSettings.terminal = getOrDefaultToUndefined(configuration.terminalFor5250);

          if (configuration.setDeviceNameFor5250) {
            terminalSettings.name = await vscode.window.showInputBox({
              prompt: `Enter a device name for the terminal.`,
              value: ``,
              placeHolder: `Blank for default.`
            }) || undefined;
          }

          // This makes it so the function keys continue to work in the terminal instead of sending them as VS Code commands
          vscode.workspace.getConfiguration().update(`terminal.integrated.sendKeybindingsToShell`, true, true);
        }

        return createTerminal(context, connection, terminalSettings);
      }
    }
  }

  const HALTED = ` II`;

  async function createTerminal(context: vscode.ExtensionContext, connection: IBMi, terminalSettings: TerminalSettings) {
    let ready = terminalSettings.type === TerminalType._5250;
    const writeEmitter = new vscode.EventEmitter<string>();
    const channel = await connection.client!.requestShell({ term: "xterm" });
    channel.on(`data`, (data: Buffer) => {
      const dataString = data.toString();
      if (ready) {
        if (dataString.includes(HALTED)) {
          setHalted(true);
        }
        writeEmitter.fire(String(data));
      }

      if (!ready) {
        ready = PASE_INIT_FLAG_REGEX.test(dataString.trim());
      }
    });

    let emulatorTerminal: vscode.Terminal | undefined;
    await new Promise((resolve) => {
      emulatorTerminal = vscode.window.createTerminal({
        name: `IBM i ${terminalSettings.type}: ${connection.getConfig().name}`,
        location: terminalSettings.location,
        pty: {
          onDidWrite: writeEmitter.event,
          open: resolve,
          close: () => {
            channel.close();
          },
          handleInput: (data: string) => {
            if (terminalSettings.type === TerminalType._5250) {
              const buffer = Buffer.from(data);

              switch (buffer[0]) {
                case BACKSPACE: //Backspace
                  //Move back one, space, move back again - deletes a character
                  channel.stdin.write(Buffer.from([
                    27, 79, 68, //Move back one
                    27, 91, 51, 126 //Delete character
                  ]));
                  break;

                default:
                  if (buffer[0] === RESET || buffer[0] === ATTENTION) {
                    setHalted(false);
                  }

                  channel.stdin.write(data);
                  break;
              }
            } else {
              channel.stdin.write(data);
            }
          },
          setDimensions: (dim: vscode.TerminalDimensions) => {
            channel.setWindow(String(dim.rows), String(dim.columns), `500`, `500`);
          }
        },
      });
      emulatorTerminal.show();
    })

    if (emulatorTerminal) {
      channel.on(`close`, () => {
        channel.destroy();
        writeEmitter.dispose();
      });
      channel.on(`exit`, (code: number, signal: any, coreDump: boolean, desc: string) => {
        writeEmitter.fire(`----------\r\n`);
        if (code === 0) {
          writeEmitter.fire(`Completed successfully.\r\n`);
        }
        else if (code) {
          writeEmitter.fire(`Exited with error code ${code}.\r\n`);
        }
        else {
          writeEmitter.fire(`Exited with signal ${signal}.\r\n`);
        }
      });
      channel.on(`error`, (err: Error) => {
        vscode.window.showErrorMessage(`Connection error: ${err.message}`);
        emulatorTerminal!.dispose();
        channel.destroy();
      });

      if (terminalSettings.type === TerminalType._5250) {
        channel.write([
          `/QOpenSys/pkgs/bin/tn5250`,
          terminalSettings.encoding ? `map=${terminalSettings.encoding}` : ``,
          terminalSettings.terminal ? `env.TERM=${terminalSettings.terminal}` : ``,
          terminalSettings.name ? `env.DEVNAME=${terminalSettings.name}` : ``,
          terminalSettings.connectionString || `localhost`,
          `\n`
        ].join(` `));
      } else {
        const initialCommands = [];
        if (terminalSettings.currentDirectory) {
          initialCommands.push(`cd ${Tools.escapePath(terminalSettings.currentDirectory)}`);
        }
        initialCommands.push(`echo -e "\\0033[0;32mTerminal started, thanks for using \\0033[0;34mCode for IBM i. \\0033[0;32mCurrent directory is \\0033[0;34m"$(pwd)"\\0033[0m."`);
        initialCommands.push([PASE_INIT_FLAG].join(" "));
        channel.write(`${initialCommands.join('; ')}\n`);
      }

      instance.subscribe(
        context,
        'disconnected',
        `Dispose Terminal ${terminalCount++}`,
        () => emulatorTerminal!.dispose(),
        true);

      return emulatorTerminal;
    }
  }
}