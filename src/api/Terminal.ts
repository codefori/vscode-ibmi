
import vscode, { Pseudoterminal } from 'vscode';
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

  function createTerminal(connection: IBMi, terminalSettings: TerminalSettings) {
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
      } else {
        channel.stdin.write(`echo "Terminal started. Thanks for using Code for IBM i"\n`);
      }
    });
  }

  export async function backgroundPaseTask(connection: IBMi, command: string) {
    const channel = await connection.client.requestShell();

    const customExecutor = new vscode.CustomExecution(async resolvedDef => {
      const writeEmitter = new vscode.EventEmitter<string>();
      const endEmitter = new vscode.EventEmitter<number>();

      channel.stdout.on(`data`, (data: any) => {
        const content = data.toString().replace(new RegExp(`\n`, `g`), `\n\r`);
        writeEmitter.fire(content);
      });
      channel.stderr.on(`data`, (data: any) => {
        const content = data.toString().replace(new RegExp(`\n`, `g`), `\n\r`);
        writeEmitter.fire(content);
      });
      channel.on(`close`, () => {
        channel.destroy();
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
        endEmitter.fire(code);
      });
      channel.on(`error`, (err: Error) => {
        vscode.window.showErrorMessage(`Connection error: ${err.message}`);
        endEmitter.fire(1);
        channel.destroy();
      });

      const pty: Pseudoterminal = {
        onDidWrite: writeEmitter.event,
        open: () => {
          //writeEmitter.fire(headerContent);
          channel.stdin.write(`${command} && exit\n`);
        },
        close: () => {
          channel.stdin.write(Buffer.from([3]));
          channel.close();
          writeEmitter.dispose();
          endEmitter.dispose();
        },
        onDidClose: endEmitter.event,
        handleInput: (data: string) => {
          const buffer = Buffer.from(data);

          if (buffer[0] === 3) {
            channel.stdin.write(data);
            writeEmitter.fire(`Ending terminal\r\n`);
            endEmitter.fire(0);
          }
        }
      };

      return pty;
    });

    const task = new vscode.Task(
      {type: `action`}, 
      vscode.TaskScope.Global, 
      `pase`, 
      `IBM i`,
      customExecutor
    );

    task.isBackground = true;
    task.detail = command;

    return await vscode.tasks.executeTask(task);
  }
}