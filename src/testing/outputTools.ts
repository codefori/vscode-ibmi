import { CommandResult, OutputLog } from "../typings";

export function parseOutput(output: string): OutputLog[] {
  const lines = output.split("\n");
  const entries: OutputLog[] = [];

  for (const line of lines) {
    if (line.startsWith("{")) {
      try {
        entries.push(JSON.parse(line));
      } catch (e) {}
    }
  }

  return entries;
}

export function formatLog(log: OutputLog) {
  const lines: string[] = [];

  let command = ``;
  if (log.setup.env) {
    const keys = Object.keys(log.setup.env);
    command += keys.map(key => `${key}="${log.setup.env![key]}"`).join(` `) + ` `;
  }

  if (log.setup.directory) {
    command += `cd ${log.setup.directory} && `;
  }

  if (log.setup.stdin) {
    command += `echo "${log.setup.stdin}" | `;
  }

  command += log.setup.command;

  lines.push(`> ${command}`);

  if (log.result.stdout) {
    lines.push(...log.result.stdout.split(`\\n`));
  }

  if (log.result.stderr) {
    lines.push(...log.result.stderr.split(`\\n`));
  }

  lines.push(`Exit code: ${log.result.code}`);
  
  return lines.join(`\n`);
}