
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
    }).then(type => {
      if (type) {
        let encodingMap;

        if (type === `5250`) {
          if (connection.remoteFeatures.tn5250 === undefined) {
            vscode.window.showErrorMessage(`5250 terminal is not supported. Please install tn5250 via yum on the remote system.`);
            return;
          }

          encodingMap = configuration.encodingFor5250;

          // This makes it so the function keys continue to work in the terminal instead of sending them as VS Code commands
          vscode.workspace.getConfiguration().update(`terminal.integrated.sendKeybindingsToShell`, true, true);
        }

        // @ts-ignore because type is a string
        Terminal.createTerminal(instance, type, encodingMap);
      }
    });
  }

  /**
   * 
   * @param {*} instance 
   * @param {"PASE"|"5250"} type 
   * @param {string} [encodingMap]
   */
  static createTerminal(instance, type, encodingMap) {
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
              let buffer = Buffer.from(data);
              console.log(buffer);

              switch (buffer[0]) {
              case 127: //Backspace
                //Move back one, space, move back again - deletes a character
                buffer = Buffer.from([
                  27, 79, 68, //Move back one
                  27, 91, 51, 126 //Delete character
                ]);
                break;
              }

              channel.stdin.write(buffer.toString());
            } else {
              channel.stdin.write(data);
            }
          },
          setDimensions: (dim) => {
            //channel.setWindow(dim.rows, dim.columns, 0, 0);
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
        channel.stdin.write(`TERM=xterm /QOpenSys/pkgs/bin/tn5250 ${encodingMap ? `map=${encodingMap}` : ``} localhost\n`);
      } else {
        channel.stdin.write(`echo "Terminal started. Thanks for using Code for IBM i"\n`);
      }
    });
  }
}