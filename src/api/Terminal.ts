
import vscode from 'vscode';
import { instance } from '../instantiate';
import IBMi from './IBMi';
import Instance from './Instance';

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

  interface TerminalSettings {
    type: TerminalType
    encoding?: string
    terminal?: string
    name?: string
    connectionString?: string
  }

  export async function selectAndOpen(instance: Instance, openType?: TerminalType) {
    const connection = instance.getConnection();
    const configuration = instance.getConfig();
    if (connection && configuration) {
      const type = openType || (await vscode.window.showQuickPick(typeItems, {
        placeHolder: `Select a terminal type`
      }))?.type;

      if (type) {
        const terminalSettings: TerminalSettings = {
          type,
          connectionString: configuration.connectringStringFor5250
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

        return createTerminal(connection, terminalSettings);
      }
    }
  }

  async function createTerminal(connection: IBMi, terminalSettings: TerminalSettings) {
    const writeEmitter = new vscode.EventEmitter<string>();

    const channel = await connection.client.requestShell();
    channel.stdout.on(`data`, (data: any) => {
      writeEmitter.fire(String(data))
    });

    const emulatorTerminal = vscode.window.createTerminal({
      name: `IBM i ${terminalSettings.type}`,
      
      pty: {
        onDidWrite: writeEmitter.event,
        open: () => { },
        close: () => {
          channel.close();
        },
        handleInput: (data: string) => {
          if (terminalSettings.type === TerminalType._5250) {
            const buffer = Buffer.from(data);

            switch (buffer[0]) {
              case 127: //Backspace
                //Move back one, space, move back again - deletes a character
                channel.stdin.write(Buffer.from([
                  27, 79, 68, //Move back one
                  27, 91, 51, 126 //Delete character
                ]));
                break;
              default:
                channel.stdin.write(data);
                break;
            }
          } else {
            channel.stdin.write(data);
          }
        },
        setDimensions: (dim: vscode.TerminalDimensions) => {
          channel.setWindow(String(dim.rows), String(dim.columns), `500`, `500`);
        },
      },
    });
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
      emulatorTerminal.dispose();
      channel.destroy();
    });

    emulatorTerminal.show();
    if (terminalSettings.type === TerminalType._5250) {
      channel.stdin.write([
        `TERM=xterm /QOpenSys/pkgs/bin/tn5250`,
        terminalSettings.encoding ? `map=${terminalSettings.encoding}` : ``,
        terminalSettings.terminal ? `env.TERM=${terminalSettings.terminal}` : ``,
        terminalSettings.name ? `env.DEVNAME=${terminalSettings.name}` : ``,
        terminalSettings.connectionString || `localhost`,
        `\n`
      ].join(` `));
    } else {
      channel.stdin.write(`echo "Terminal started. Thanks for using Code for IBM i"\n`);
    }

    instance.onEvent('disconnected', () => emulatorTerminal.dispose());

    return emulatorTerminal;
  }
}