import { commands, env, Uri, window } from "vscode";
import IBMi, { ConnectionErrorCode, ConnectionMessageType } from "../api/IBMi";

export function messageCallback(type: ConnectionMessageType, message: string) {
  switch (type) {
    case `info`:
      window.showInformationMessage(message);
      break;
    case `warning`:
      window.showWarningMessage(message);
      break;
    case `error`:
      window.showErrorMessage(message);
      break;
  }
}

export async function handleConnectionResults(connection: IBMi, error: ConnectionErrorCode, data: any) {
  switch (error as ConnectionErrorCode) {
    case `shell_config`:
      const chosen = await window.showInformationMessage(`Error in shell configuration!`, {
        detail: [
          `This extension can not work with the shell configured on ${connection.currentConnectionName},`,
          `since the output from shell commands have additional content.`,
          `This can be caused by running commands like "echo" or other`,
          `commands creating output in your shell start script.`, ``,
          `The connection to ${connection.currentConnectionName} will be aborted.`
        ].join(`\n`),
        modal: true
      }, `Read more`);

      if (chosen === `Read more`) {
        commands.executeCommand(`open`, `https://codefori.github.io/docs/tips/setup/#error-in-shell-configuration`);
      }
      break;

    case `home_directory_creation`:
      if (await window.showWarningMessage(`Home directory does not exist`, {
        modal: true,
        detail: `Your home directory (${data}) does not exist, so Code for IBM i may not function correctly. Would you like to create this directory now?`,
      }, `Yes`)) {
        let mkHomeCmd = `mkdir -p ${data} && chown ${connection.currentUser.toLowerCase()} ${data} && chmod 0755 ${data}`;
        let mkHomeResult = await connection.sendCommand({ command: mkHomeCmd, directory: `.` });
        if (0 === mkHomeResult.code) {
          return true;
        } else {
          let mkHomeErrs = mkHomeResult.stderr;
          // We still get 'Could not chdir to home directory' in stderr so we need to hackily gut that out, as well as the bashisms that are a side effect of our API
          mkHomeErrs = mkHomeErrs.substring(1 + mkHomeErrs.indexOf(`\n`)).replace(`bash: line 1: `, ``);
          await window.showWarningMessage(`Error creating home directory (${data}):\n${mkHomeErrs}.\n\n Code for IBM i may not function correctly. Please contact your system administrator.`, { modal: true });
          return false;
        }
      }
      break;

    case `QCPTOIMPF_exists`:
      window.showWarningMessage(`The data area QSYS/QCPTOIMPF exists on this system and may impact Code for IBM i functionality.`, {
        detail: `For V5R3, the code for the command CPYTOIMPF had a major design change to increase functionality and performance. The QSYS/QCPTOIMPF data area lets developers keep the pre-V5R2 version of CPYTOIMPF. Code for IBM i cannot function correctly while this data area exists.`,
        modal: true,
      }, `Delete`, `Read more`).then(choice => {
        switch (choice) {
          case `Delete`:
            connection.runCommand({
              command: `DLTOBJ OBJ(QSYS/QCPTOIMPF) OBJTYPE(*DTAARA)`,
              noLibList: true
            })
              .then((result) => {
                if (result?.code === 0) {
                  window.showInformationMessage(`The data area QSYS/QCPTOIMPF has been deleted.`);
                } else {
                  window.showInformationMessage(`Failed to delete the data area QSYS/QCPTOIMPF. Code for IBM i may not work as intended.`);
                }
              })
            break;
          case `Read more`:
            env.openExternal(Uri.parse(`https://github.com/codefori/vscode-ibmi/issues/476#issuecomment-1018908018`));
            break;
        }
      });
      break;

    case `QCPFRMIMPF_exists`:
      window.showWarningMessage(`The data area QSYS/QCPFRMIMPF exists on this system and may impact Code for IBM i functionality.`, {
        modal: false,
      }, `Delete`, `Read more`).then(choice => {
        switch (choice) {
          case `Delete`:
            connection.runCommand({
              command: `DLTOBJ OBJ(QSYS/QCPFRMIMPF) OBJTYPE(*DTAARA)`,
              noLibList: true
            })
              .then((result) => {
                if (result?.code === 0) {
                  window.showInformationMessage(`The data area QSYS/QCPFRMIMPF has been deleted.`);
                } else {
                  window.showInformationMessage(`Failed to delete the data area QSYS/QCPFRMIMPF. Code for IBM i may not work as intended.`);
                }
              })
            break;
          case `Read more`:
            env.openExternal(Uri.parse(`https://github.com/codefori/vscode-ibmi/issues/476#issuecomment-1018908018`));
            break;
        }
      });
      break;

    case `default_not_bash`:
      window.showInformationMessage(`IBM recommends using bash as your default shell.`, `Set shell to bash`, `Read More`,).then(async choice => {
        switch (choice) {
          case `Set shell to bash`:
            const commandSetBashResult = await connection.sendCommand({
              command: `/QOpenSys/pkgs/bin/chsh -s /QOpenSys/pkgs/bin/bash`
            });

            if (!commandSetBashResult.stderr) {
              window.showInformationMessage(`Shell is now bash! Reconnect for change to take effect.`);
            } else {
              window.showInformationMessage(`Default shell WAS NOT changed to bash.`);
            }
            break;

          case `Read More`:
            env.openExternal(Uri.parse(`https://ibmi-oss-docs.readthedocs.io/en/latest/user_setup/README.html#step-4-change-your-default-shell-to-bash`));
            break;
        }
      });
      break;

    case `invalid_bashrc`:
      const { bashrcFile, bashrcExists, missingPath, reason } = data;
      if (await window.showWarningMessage(`${missingPath} not found in $PATH`, {
        modal: true,
        detail: `${reason}, so Code for IBM i may not function correctly. Would you like to ${bashrcExists ? "update" : "create"} ${bashrcFile} to fix this now?`,
      }, `Yes`)) {
        if (!bashrcExists) {
          // Add "/usr/bin" and "/QOpenSys/usr/bin" to the end of the path. This way we know that the user has 
          // all the required paths, but we don't overwrite the priority of other items on their path.
          const createBashrc = await connection.sendCommand({ command: `echo "# Generated by Code for IBM i\nexport PATH=/QOpenSys/pkgs/bin:\\$PATH:/QOpenSys/usr/bin:/usr/bin" >> ${bashrcFile} && chown ${connection.currentUser.toLowerCase()} ${bashrcFile} && chmod 755 ${bashrcFile}` });
          if (createBashrc.code !== 0) {
            window.showWarningMessage(`Error creating ${bashrcFile}):\n${createBashrc.stderr}.\n\n Code for IBM i may not function correctly. Please contact your system administrator.`, { modal: true });
          }
        }
        else {
          try {
            const content = connection.content;
            if (content) {
              const bashrcContent = (await content.downloadStreamfile(bashrcFile)).split("\n");
              let replaced = false;
              bashrcContent.forEach((line, index) => {
                if (!replaced) {
                  const pathRegex = /^((?:export )?PATH=)(.*)(?:)$/.exec(line);
                  if (pathRegex) {
                    bashrcContent[index] = `${pathRegex[1]}/QOpenSys/pkgs/bin:${pathRegex[2]
                      .replace("/QOpenSys/pkgs/bin", "") //Removes /QOpenSys/pkgs/bin wherever it is
                      .replace("::", ":")}:/QOpenSys/usr/bin:/usr/bin`; //Removes double : in case /QOpenSys/pkgs/bin wasn't at the end
                    replaced = true;
                  }
                }
              });

              if (!replaced) {
                bashrcContent.push(
                  "",
                  "# Generated by Code for IBM i",
                  "export PATH=/QOpenSys/pkgs/bin:$PATH:/QOpenSys/usr/bin:/usr/bin"
                );
              }

              await content.writeStreamfile(bashrcFile, bashrcContent.join("\n"));
            }
          }
          catch (error) {
            window.showWarningMessage(`Error modifying PATH in ${bashrcFile}):\n${error}.\n\n Code for IBM i may not function correctly. Please contact your system administrator.`, { modal: true });
          }
        }
      }
      break;

    case `invalid_temp_lib`:
      window.showWarningMessage(`Code for IBM i will not function correctly until the temporary library has been corrected in the settings.`, `Open Settings`)
      .then(result => {
        switch (result) {
          case `Open Settings`:
            commands.executeCommand(`code-for-ibmi.showAdditionalSettings`);
            break;
        }
      });
      break;

    case `ccsid_warning`:
      window.showWarningMessage(data, `Show documentation`).then(choice => {
        if (choice === `Show documentation`) {
          commands.executeCommand(`open`, `https://codefori.github.io/docs/tips/ccsid/`);
        }
      });
      break;
  }

  return false;
}