
import vscode from 'vscode';
import Instance from './Instance';

export namespace Terminal {
  enum TerminalType {
    PASE = "PASE",
    _5250 = "5250"
  }

  interface TerminalSettings {
    type: TerminalType
    encoding?: string
    terminal?: string
    name?: string
    connectionString?: string
  }

  export function select(instance: Instance) {
    const connection = instance.getConnection();
    const configuration = instance.getConfig();
    if (connection && configuration) {
      const typeItems = Object.values(TerminalType)
        .map(entry => {
          return { label: entry, type: entry }
        });

      vscode.window.showQuickPick(typeItems, {
        placeHolder: `Select a terminal type`
      })
        .then(async typeItem => {
          if (typeItem) {
            const type = typeItem.type;
            let encoding: string | undefined;
            let terminal: string | undefined;
            let name: string | undefined;
            if (type === TerminalType._5250) {
              if (connection.remoteFeatures.tn5250 === undefined) {
                vscode.window.showErrorMessage(`5250 terminal is not supported. Please install tn5250 via yum on the remote system.`);
                return;
              }

              encoding = (configuration.encodingFor5250 && configuration.encodingFor5250 !== `default` ? configuration.encodingFor5250 : undefined);
              terminal = (configuration.terminalFor5250 && configuration.terminalFor5250 !== `default` ? configuration.terminalFor5250 : undefined);

              if (configuration.setDeviceNameFor5250) {
                name = await vscode.window.showInputBox({
                  prompt: `Enter a device name for the terminal.`,
                  value: ``,
                  placeHolder: `Blank for default.`
                });

                if (name === ``) name = undefined;
              }

              // This makes it so the function keys continue to work in the terminal instead of sending them as VS Code commands
              vscode.workspace.getConfiguration().update(`terminal.integrated.sendKeybindingsToShell`, true, true);
            }
            
            createTerminal(instance, {
              type,
              encoding,
              terminal,
              name,
              connectionString: configuration.connectringStringFor5250
            });
          }
        });
    }
  }

  function createTerminal(instance: Instance, terminalSettings: TerminalSettings) {
    const writeEmitter = new vscode.EventEmitter<string>();
    const connection = instance.getConnection();
    if (connection) {
      connection.client.requestShell().then(channel => {
        channel.stdout.on(`data`, (data: any) => {
          writeEmitter.fire(String(data))
        });
        channel.stderr.on(`data`, (data: any) => {
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
              channel.setWindow(dim.rows, dim.columns, `500`, `500`);
            },
          },
        });
        channel.on(`close`, () => {
          channel.destroy();
          writeEmitter.dispose()
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
      });
    }
  }
}