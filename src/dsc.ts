import path from "path";

import { existsSync, mkdirSync } from "fs";
import { writeFile } from "fs/promises";
import { Octokit } from "@octokit/rest";
import { SERVER_VERSION_FILE, SERVER_VERSION_TAG } from "./api/components/mapepire/version";

async function work() {
  const octokit = new Octokit();

  const owner = `Mapepire-IBMi`;
  const repo = `mapepire-server`;

  try {
    const result = await octokit.request(`GET /repos/{owner}/{repo}/releases/tags/${SERVER_VERSION_TAG}`, {
      owner,
      repo,
      headers: {
        'X-GitHub-Api-Version': '2022-11-28'
      }
    });

    const newAsset = result.data.assets.find((asset: any) => asset.name.endsWith(`.jar`));

    if (newAsset) {
      console.log(`Asset found: ${newAsset.name}`);

      const url = newAsset.browser_download_url;
      const distDirectory = path.join(`.`, `dist`);
      if (!existsSync(distDirectory)) {
        mkdirSync(distDirectory);
      }

      const serverFile = path.join(distDirectory, SERVER_VERSION_FILE);
      await downloadFile(url, serverFile);

      console.log(`Asset downloaded: ${serverFile}`);

    } else {
      console.log(`Release found but no asset found.`);
    }


  } catch (e) {
    console.log(e);
  }
}

function downloadFile(url: string, outputPath: string) {
  return fetch(url)
    .then(x => x.arrayBuffer())
    .then(x => writeFile(outputPath, Buffer.from(x)));
}

work();