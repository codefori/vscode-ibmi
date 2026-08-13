import { existsSync, readFileSync } from "fs";
import path from "path";

type RoutineType = "PROCEDURE" | "FUNCTION";

const ENV_FILE = path.join(__dirname, `..`, `src`, `api`, `tests`, `.env`);

function usage() {
  console.log([
    ``,
    `Usage: npx tsx tools/sqlSignature <library>/<name> [PROCEDURE|FUNCTION]`,
    ``,
    `  <library>/<name>  the routine to look up; a dot also works (MYLIB.MYPROC).`,
    `                    Names are uppercased unless "quoted".`,
    `  [type]            when omitted, PROCEDURE and FUNCTION are both tried.`,
    ``,
    `Connection settings are read from ${path.relative(process.cwd(), ENV_FILE)}`,
    `(same VITE_* variables as the test suite) or from the environment.`,
    ``,
  ].join(`\n`));
}

/**
 * The connection helper reads its credentials from VITE_* variables when it's
 * imported, so the test .env has to be in the environment before that happens.
 */
function loadEnv() {
  if (!existsSync(ENV_FILE)) {
    return;
  }

  for (const line of readFileSync(ENV_FILE, `utf-8`).split(/\r?\n/)) {
    const variable = /^\s*([\w.-]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (variable) {
      const [, key, value] = variable;
      if (process.env[key] === undefined && value) {
        process.env[key] = value.replace(/^["'](.*)["']$/, `$1`);
      }
    }
  }
}

function parseName(part: string) {
  const delimited = /^"(.+)"$/.exec(part);
  return delimited ? delimited[1] : part.toUpperCase();
}

function parseTarget(target: string) {
  const [library, name, ...rest] = target.split(/[\/.]/);
  if (library && name && !rest.length) {
    return { library: parseName(library), name: parseName(name) };
  }
}

async function work() {
  const [target, type] = process.argv.slice(2);
  if (!target || target === `-h` || target === `--help`) {
    usage();
    process.exitCode = target ? 0 : 1;
    return;
  }

  const routine = parseTarget(target);
  if (!routine) {
    console.log(`Invalid object name: ${target}`);
    usage();
    process.exitCode = 1;
    return;
  }

  const types: RoutineType[] = [`PROCEDURE`, `FUNCTION`];
  if (type) {
    const wanted = type.toUpperCase() as RoutineType;
    if (!types.includes(wanted)) {
      console.log(`Invalid type: ${type}. Expected PROCEDURE or FUNCTION.`);
      process.exitCode = 1;
      return;
    }
    types.splice(0, types.length, wanted);
  }

  loadEnv();

  const { newConnection, disposeConnection } = await import(`../src/api/tests/connection`);

  console.log(`Connecting to ${process.env.VITE_SERVER}...`);
  const connection = await newConnection();
  try {
    const content = connection.getContent();
    let found = false;
    for (const routineType of types) {
      const signature = await content.getSQLRoutineSignature(routine.library, routine.name, routineType);
      if (signature) {
        found = true;
        console.log(`${routineType} ${routine.library}.${routine.name} => ${signature}`);
      }
    }

    if (!found) {
      console.log(`No ${types.join(` or `)} named ${routine.library}.${routine.name} found.`);
      process.exitCode = 1;
    }
  }
  finally {
    await disposeConnection(connection);
  }
}

work();
