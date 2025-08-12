import type { TestProject } from "vitest/node";
import { disposeConnection, newConnection } from "./connection";

export async function setup(project: TestProject) {
  // Pre-connects to create/refresh the configuration files.
  // When the config files exist, it makes future connections just slightly faster.
  // Mostly useful during the CI stage.
    console.log(``);
    console.log(`Connecting before tests run to create/refresh settings.`);

    const conn = await newConnection(true);
    await disposeConnection(conn);

    console.log(`Testing connection complete. Settings written/refreshed.`);
    console.log(``);
}