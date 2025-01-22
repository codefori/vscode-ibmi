import type { TestProject } from "vitest/node";
import { disposeConnection, newConnection, testStorage } from "./connection";

export async function setup(project: TestProject) {
  // You might pre-connect to simply create the configuration files.
  // When the config files exist, it makes future connections just slightly faster.
  // Mostly useful during the CI stage.
  if (!testStorage.exists()) {
    console.log(``);
    console.log(`Testing connection before tests run since configs do not exist.`);

    const conn = await newConnection();
    disposeConnection(conn);

    console.log(`Testing connection complete. Configs written.`);
    console.log(``);
  }
}