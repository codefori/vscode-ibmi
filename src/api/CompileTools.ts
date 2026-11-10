
import IBMi from './IBMi';
import { Tools } from './Tools';
import { CommandResult, ILELibrarySettings, RemoteCommand, StandardIO } from './types';
import { Variables } from './variables';

export namespace CompileTools {
  export const NEWLINE = `\r\n`;
  export const DID_NOT_RUN = -123;
  const HIDE_MESSAGE_IDS = [`CPF3485`, `SQL0462`];


  interface RunCommandEvents {
    writeEvent?: (content: string) => void
    commandConfirm?: (command: string) => Promise<string>
    updateProgress?: (message: string) => void
  }

  /**
   * Execute a command
   */
  export async function runCommand(connection: IBMi, options: RemoteCommand, events: RunCommandEvents = {}): Promise<CommandResult> {
    const config = connection.getConfig();
    if (config && connection) {
      const cwd = options.cwd;
      const variables = new Variables(connection, options.env);

      const currentLibrary = variables.get(`&CURLIB`) || config.currentLibrary || "";

      const ileSetup: ILELibrarySettings = {
        currentLibrary: (/\*CURLIB/i.test(currentLibrary) ? "" : currentLibrary),
        libraryList: (variables.get(`&LIBL`)?.split(` `) || config.libraryList).filter(Tools.distinct),
      };

      const libraryList = buildLibraryList(ileSetup);
      variables.set(`&LIBLS`, libraryList.join(` `));

      let commandString = variables.expand(options.command);

      if (events.commandConfirm) {
        events.updateProgress?.(" - Prompting...");
        commandString = await events.commandConfirm(commandString);
        events.updateProgress?.("");
      }

      if (commandString) {
        const commands = commandString.split(`\n`).filter(command => command.trim().length > 0);
        const callbacks: StandardIO = {};

        if (events.writeEvent) {
          if (options.environment === `ile` && !options.noLibList) {
            events.writeEvent(`Current library: ` + (ileSetup.currentLibrary || "no current library") + NEWLINE);
            events.writeEvent(`Library list: ` + ileSetup.libraryList.join(` `) + NEWLINE);
          }
          if (options.cwd) {
            events.writeEvent(`Working directory: ` + options.cwd + NEWLINE);
          }
          events.writeEvent(`Commands:\n${commands.map(command => `\t${command}\n`).join(``)}` + NEWLINE);

          callbacks.onStdout = callbacks.onStderr = (data) => { events.writeEvent!(data.toString().replaceAll(`\n`, NEWLINE) + NEWLINE) };
        }

        let commandResult: CommandResult;
        switch (options.environment) {
          case `pase`:
            commandResult = await connection.sendCommand({
              command: commands.join(` && `),
              directory: cwd,
              env: variables.toPaseVariables(),
              ...callbacks
            });
            break;

          case `qsh`:
            commandResult = await connection.sendQsh({
              command: [
                ...options.noLibList ? [] : buildLiblistCommands(connection, ileSetup),
                ...commands,
              ].join(` && `),
              directory: cwd,
              ...callbacks
            });
            break;

          case `ile`:
          default:
            commandResult = {
              code: 0,
              duration: 0,
              stderr: ``,
              stdout: ``,
              command: commands.join(`, `),
            };

            const startTime = performance.now();
            //Set library list and current directory
            const prepareContext: string[] = [];

            let spooledUserData: string | undefined;
            if (options.getSpooledFiles) {
              spooledUserData = Tools.makeid().toUpperCase();
              prepareContext.push(`QSYS/OVRPRTF FILE(*PRTF) SPOOL(*YES) HOLD(*YES) USRDTA(${spooledUserData}) SPLFOWN(*CURUSRPRF) OVRSCOPE(*JOB)`);
              commands.push('QSYS/DLTOVR FILE(*PRTF) LVL(*JOB)');
            }

            if (!options.noLibList) {
              prepareContext.push(`QSYS/CHGLIBL CURLIB(${ileSetup.currentLibrary || "*CRTDFT"}) LIBL(${ileSetup.libraryList.join(` `)})`);
            }

            if (cwd) {
              prepareContext.push(`QSYS/CHGCURDIR DIR('${cwd}')`);
            }

            await new Promise<void>((done) => {
              connection.asyncLock.acquire('ileCommand', async () => {
                for (const command of prepareContext) {
                  const result = await connection.runCL(command);
                  if (!result.success) {
                    commandResult.code = 1;
                    commandResult.stderr = result.error || result.data.filter(message => !HIDE_MESSAGE_IDS.includes(message.id)).map(message => `${message.id}: ${message.text}`).join("\n");
                    callbacks.onStderr?.(Buffer.from(commandResult.stderr));
                    return commandResult;
                  }
                }

                for (const command of commands) {
                  const result = await connection.runCL(command);
                  commandResult.duration += result.execution_time;
                  if (!result.success) {
                    commandResult.code = 1;
                    commandResult.stdout = result.error ?? "";
                    commandResult.stderr = result.data.filter(message => !HIDE_MESSAGE_IDS.includes(message.id)).map(message => `${message.id}: ${message.text}`).join("\n");
                    callbacks.onStderr?.(Buffer.from(commandResult.stderr));
                    break;
                  }
                }
                done();
              });
            });

            // Fetch the spooled files if requested
            if (spooledUserData) {
              try {
                commandResult.stdout = (await connection.runSQL(/* sql */ `
                  select rtrim(SPOOLED_DATA) LINE
                  from table(QSYS2.SPOOLED_FILE_INFO(
                    USER_DATA => '${spooledUserData}',
                    STATUS => '*HELD'
                  ))
                  cross join table(SYSTOOLS.SPOOLED_FILE_DATA(
                    JOB_NAME => QUALIFIED_JOB_NAME,
                    SPOOLED_FILE_NAME => SPOOLED_FILE_NAME, 
                    SPOOLED_FILE_NUMBER => SPOOLED_FILE_NUMBER
                  ))
                  order by JOB_NAME, SPOOLED_FILE_NAME, SPOOLED_FILE_NUMBER, ORDINAL_POSITION
                `)).map(row => row.LINE as string).join("\n");
                callbacks.onStdout?.(Buffer.from(commandResult.stdout));
              } catch (e) {
                commandResult.code = 2;
                callbacks.onStderr?.(Buffer.from(`Failed to get spool output: ${JSON.stringify(e, undefined, 2)}`));
              }

              if (!connection.getConfig().keepActionSpooledFiles) {
                await connection.runCL(`QSYS/DLTSPLF FILE(*SELECT) SELECT(*CURRENT *ALL *ALL ${spooledUserData})`);
              }
            }

            commandResult.duration = Math.round(performance.now() - startTime);
            break;
        }

        commandResult.command = commandString;
        return commandResult;
      } else {
        return {
          code: DID_NOT_RUN,
          duration: 0,
          command: options.command,
          stdout: ``,
          stderr: `Command execution failed. (No command)`,
        };
      }
    }
    else {
      throw new Error("Please connect to an IBM i");
    }
  }

  function buildLibraryList(config: ILELibrarySettings): string[] {
    //We have to reverse it because `liblist -a` adds the next item to the top always 
    return config.libraryList.slice(0).reverse();
  }

  function buildLiblistCommands(connection: IBMi, config: ILELibrarySettings): string[] {
    return [
      `liblist -d ${Tools.escapeForShell(Tools.sanitizeObjNamesForPase(...connection.defaultUserLibraries).join(` `))}`,
      `liblist -c ${Tools.escapeForShell(Tools.sanitizeObjNamesForPase(config.currentLibrary || "*CRTDFT")[0])}`,
      `liblist -a ${Tools.escapeForShell(Tools.sanitizeObjNamesForPase(...buildLibraryList(config)).join(` `))}`
    ];
  }
}