
const vscode = require(`vscode`);
const Configuration = require(`./Configuration`);
const IBMi = require(`./IBMi`);

module.exports = class Terminal {
  static select(instance) {
    /** @type {IBMi} */
    const connection = instance.getConnection();

    /** @type {Configuration} */
    const configuration = instance.getConfig();

    const types = [`PASE`, `5250`];
    vscode.window.showQuickPick(types, {
      placeHolder: `Select a terminal type`
    }).then(async type => {
      if (type) {
        let encoding, terminal, name;

        if (type === `5250`) {
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

        // @ts-ignore because type is a string
        Terminal.createTerminal(instance, type, {
          encoding,
          terminal,
          name,
          connectionString: configuration.connectringStringFor5250
        });
      }
    });
  }

  /**
   * 
   * @param {*} instance 
   * @param {"PASE"|"5250"} type 
   * @param {{encoding?: string, terminal?: string, name?: string, connectionString?: string}} [greenScreenSettings]
   */
  static createTerminal(instance, type, greenScreenSettings = {}) {
    const writeEmitter = new vscode.EventEmitter();

    /** @type {IBMi} */
    const connection = instance.getConnection();

    connection.client.requestShell().then(channel => {
      channel.stdout.on(`data`, (data) => {
        writeEmitter.fire(String(data))
      });
      channel.stderr.on(`data`, (data) => {
        writeEmitter.fire(String(data))
      });
      let emulatorTerminal = vscode.window.createTerminal({
        name: `IBM i ${type}`,
        pty: {
          onDidWrite: writeEmitter.event,
          open: (dim) => {},
          close: () => {
            channel.close();
          },
          handleInput: (data) => {
            if (type === `5250`) {
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
          setDimensions: (dim) => {
            channel.setWindow(dim.rows, dim.columns, `500`, `500`);
          },
        },
      });
      channel.on(`close`, () => {
        channel.destroy();
        writeEmitter.dispose()
      });
      channel.on(`exit`, (code, signal, coreDump, desc) => {
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
      channel.on(`error`, (err) => {
        vscode.window.showErrorMessage(`Connection error: ${err || err.message}`);
        emulatorTerminal.dispose();
        channel.destroy();
      });

      emulatorTerminal.show();

      if (type === `5250`) {
        channel.stdin.write([
          `TERM=xterm /QOpenSys/pkgs/bin/tn5250`,
          greenScreenSettings.encoding ? `map=${greenScreenSettings.encoding}` : ``,
          greenScreenSettings.terminal ? `env.TERM=${greenScreenSettings.terminal}` : ``,
          greenScreenSettings.name ? `env.DEVNAME=${greenScreenSettings.name}` : ``,
          greenScreenSettings.connectionString || `localhost`,
          `\n`
        ].join(` `));
      } else {
        channel.stdin.write(`echo "Terminal started. Thanks for using Code for IBM i"\n`);
      }
    });
  }
}