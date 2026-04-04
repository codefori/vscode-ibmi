import { BindingValue } from "@ibm/mapepire-js";
import type IBMi from "./IBMi";
import { Mapepire } from "./components/mapepire";
import { sshSqlJob } from "./components/mapepire/sqlJob";
import { Tools } from "./Tools";
import { CommandResult } from "./types";

/**
 * Public interface for companion extensions to interact with a dedicated SQL job.
 * Created via `connection.createDedicatedJob()`, this provides an isolated SQL job
 * that preserves job-scoped IBM i state (locks, library list, temporary tables, etc.)
 * across multiple calls.
 *
 * The job is automatically cleaned up on disconnect, but should be explicitly closed
 * when no longer needed to free IBM i resources.
 *
 * Companion extensions can also register a DedicatedJob as the "save job" via
 * `connection.setDedicatedSaveJob(job)`, so that member saves go through the same
 * job that holds locks or context.
 */
export interface DedicatedJob {
  /** Execute one or more SQL statements on this dedicated job. */
  runSQL(statements: string | string[], options?: { bindings?: BindingValue[] }): Promise<Tools.DB2Row[]>;
  /** Run a CL command on this dedicated job and return a CommandResult. */
  runCommand(command: string): Promise<CommandResult>;
  /** Close the dedicated job and release its IBM i resources. */
  close(): Promise<void>;
  /** The IBM i job identifier (e.g. "123456/USER/JOBNAME"), if available. */
  readonly jobId?: string;
}

/**
 * Creates a new dedicated SQL job for use by companion extensions.
 * Wraps a Mapepire sshSqlJob with a simple public interface.
 */
export async function createDedicatedJob(connection: IBMi): Promise<DedicatedJob> {
  const mapepire = connection.getComponent<Mapepire>(Mapepire.ID);
  if (!mapepire) {
    throw new Error(`Mapepire component not available. Cannot create dedicated job.`);
  }

  const sqlJob = await mapepire.newJob(connection);

  return {
    get jobId() {
      return sqlJob.id;
    },

    async runSQL(statements: string | string[], options: { bindings?: BindingValue[] } = {}) {
      return runSQLOnJob(connection, sqlJob, statements, options);
    },

    async runCommand(command: string): Promise<CommandResult> {
      try {
        await runSQLOnJob(connection, sqlJob, [`@${command}`]);
        return { code: 0, stdout: '', stderr: '' };
      } catch (error: any) {
        return { code: 1, stdout: '', stderr: error.message || String(error) };
      }
    },

    async close() {
      await sqlJob.close();
    }
  };
}

/**
 * Executes SQL statements and CL commands (prefixed with @) on a given SQL job.
 * Shared execution logic between the main connection runSQL and DedicatedJob.runSQL.
 */
async function runSQLOnJob(connection: IBMi, sqlJob: sshSqlJob, statements: string | string[], options: { bindings?: BindingValue[] } = {}): Promise<Tools.DB2Row[]> {
  const list = Array.isArray(statements) ? statements : statements.split(`;`).filter(x => x.trim().length > 0);
  const lastResultSet: Tools.DB2Row[] = [];

  for (const statement of list) {
    if (statement.startsWith(`@`)) {
      const command = statement.substring(1);
      const log = `Running CL through SQL: ${command}\n\t`;
      try {
        const result = await sqlJob.execute<{ MESSAGE_ID: string, MESSAGE_TEXT: string }>(command, { isClCommand: true });
        connection.appendOutput(`${log}-> OK${result.data.length ? "\n" + result.data.map(message => `\t[${message.MESSAGE_ID}] ${message.MESSAGE_TEXT}`).join("\n") : ''}`);
      } catch (e: any) {
        const error = new Tools.SqlError(e.message);
        connection.appendOutput(`${log}-> Failed: ${error.message}`);

        const jobLog = await runSQLOnJob(connection, sqlJob, `select ORDINAL_POSITION, message_id, message_text from table(qsys2.joblog_info('*')) order by ORDINAL_POSITION desc limit 5`);
        let logs = `${log}Job log:\n`;
        for (const row of jobLog) {
          logs += `\t\t${row.MESSAGE_ID}: ${row.MESSAGE_TEXT}\n`;
        }
        connection.appendOutput(logs);

        error.cause = { command, jobLog };
        throw error;
      }
    } else {
      let query;
      let error: Tools.SqlError | undefined;
      const log = `Running SQL query: ${statement}\n`;
      try {
        query = sqlJob.query<Tools.DB2Row>(statement, { parameters: options.bindings });
        const rs = await query.execute(99999);
        if (rs.has_results) {
          lastResultSet.push(...rs.data);
          connection.appendOutput(`${log}-> ${lastResultSet.length ? `${lastResultSet.length} row(s) returned` : 'no rows returned'}`);
        } else {
          connection.appendOutput(`${log}-> ${rs.update_count} row(s) impacted`);
        }
      } catch (e: any) {
        error = new Tools.SqlError(e.message);
        error.cause = statement;

        const parts: string[] = e.message.split(`,`);
        if (parts.length > 3) {
          error.sqlstate = parts[parts.length - 2].trim();
        }
        connection.appendOutput(`${log}-> Failed: ${error.sqlstate ? `[${error.sqlstate}] ` : ''}${error.message}`);
      } finally {
        query?.close();
      }

      if (error) {
        throw error;
      }
    }
  }

  connection.appendOutput("\n\n");
  return lastResultSet;
}
