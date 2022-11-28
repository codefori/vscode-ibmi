
import vscode from 'vscode';
import IBMi from './IBMi';
import Instance from './Instance';

function getOrDefaultToUndefined(value: string) {
  if (value && value !== `default`) {
    return value;
  }
}

export namespace Terminal {
  enum TerminalType {
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
    /** Single command  */
    singleCommand?: string
  }

  export function selectAndOpen(instance: Instance) {
    const connection = instance.getConnection();
    const configuration = instance.getConfig();
    if (connection && configuration) {
      vscode.window.showQuickPick(typeItems, {
        placeHolder: `Select a terminal type`
      })
        .then(async typeItem => {
          if (typeItem) {
            const terminalSettings: TerminalSettings = {
              type: typeItem.type,
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

            createTerminal(connection, terminalSettings);
          }
        });
    }
  }

  export function createTerminal(connection: IBMi, terminalSettings: TerminalSettings) {
    const writeEmitter = new vscode.EventEmitter<string>();

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
            const buffer = Buffer.from(data);
            if (terminalSettings.type === TerminalType._5250) {
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

              // When singleCommand is being used
              // Control + C is trigger to kill the terminal
              if (terminalSettings.singleCommand && buffer[0] === 3) {
                writeEmitter.fire(`Ending terminal\r\n`);
                channel.close();

                if (terminalSettings.singleCommand) 
                  emulatorTerminal.dispose();
              }
            }
          },
          setDimensions: (dim: vscode.TerminalDimensions) => {
            channel.setWindow(dim.rows, dim.columns, `500`, `500`);
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
      } else if (terminalSettings.singleCommand) {
        channel.stdin.write(`${terminalSettings.singleCommand} && exit\n`);
      } else {
        channel.stdin.write(`echo "Terminal started. Thanks for using Code for IBM i"\n`);
      }
    });
  }
}