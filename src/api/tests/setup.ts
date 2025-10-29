import type { TestProject } from "vitest/node";
import { disposeConnection, newConnection } from "./connection";
import { existsSync } from "fs";
import path from "path";
import { JSONConfig, JsonStorage } from "./testConfigSetup";

export async function setup(project: TestProject) {
  // Pre-connects to create/refresh the configuration files.
  // When the config files exist, it makes future connections just slightly faster.
  // Mostly useful during the CI stage.

    const configsExist = exists(JSONConfig.NAME) && exists(JsonStorage.NAME);

    if (configsExist) {
      console.log(`Connection settings already exists. Skipped connection setup.`);
    } else {
      console.log(``);
      console.log(`Connecting before tests run to create/refresh settings.`);
      const conn = await newConnection(true);
      await disposeConnection(conn);

      console.log(`Testing connection complete. Settings written/refreshed.`);
      console.log(``);
    }
}

function exists(fileName: string) {
  const fullPath = path.join(__dirname, fileName);
  return existsSync(fullPath);
}