//Webpack is returning these as strings
const codiconCss = require(`@vscode/codicons/dist/codicon.css`);
const codiconFont = require(`@vscode/codicons/dist/codicon.ttf`);

function assetString(asset: any): string {
  return typeof asset === `string` ? asset : asset.default;
}

/** Codicon stylesheet with the font embedded, since webviews cannot load it from disk. */
export const codiconStyles = assetString(codiconCss).replace(
  /url\(["']?[^)"']*codicon\.ttf[^)"']*["']?\)/,
  `url("${assetString(codiconFont)}")`
);
