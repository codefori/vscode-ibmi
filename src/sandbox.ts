import { env } from "process";
import { extensions } from "vscode";
import { GitExtension } from "./api/import/git";

export default function () {
  if (env.VSCODE_IBMI_SANDBOX && env.SANDBOX_SERVER) {
    console.log(`Sandbox mode enabled. Look at branch name as username`);
    const gitAPI = extensions.getExtension<GitExtension>(`vscode.git`)?.exports.getAPI(1);
    if (gitAPI && gitAPI.repositories && gitAPI.repositories.length > 0) {
      const repo = gitAPI.repositories[0];
      const username = repo.state.HEAD?.name;

      console.log(`${env.SANDBOX_SERVER}@${username}:${username}`);
    }
  }
}