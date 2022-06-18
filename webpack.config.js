//@ts-check

'use strict';

const path = require(`path`);
const webpack = require(`webpack`);

// @ts-ignore
const extensionInfo = require(`./package.json`);

const AZURE_COLLECT_KEY = `1b15d94b-bace-4a07-aab6-f33792c6e8fe`;

/**@type {webpack.Configuration}*/
const config = {
  target: `node`, // vscode extensions run in a Node.js-context 📖 -> https://webpack.js.org/configuration/node/

  entry: `./src/extension.js`, // the entry point of this extension, 📖 -> https://webpack.js.org/configuration/entry-context/
  output: {
    // the bundle is stored in the 'dist' folder (check package.json), 📖 -> https://webpack.js.org/configuration/output/
    path: path.resolve(__dirname, `dist`),
    filename: `extension.js`,
    libraryTarget: `commonjs2`,
    devtoolModuleFilenameTemplate: `../[resource-path]`,
  },
  devtool: `source-map`,
  externals: {
    vscode: `commonjs vscode`, // the vscode-module is created on-the-fly and must be excluded. Add other modules that cannot be webpack'ed, 📖 -> https://webpack.js.org/configuration/externals/
    'applicationinsights-native-metrics': `commonjs applicationinsights-native-metrics` // ignored because we don't ship native module -> https://github.com/microsoft/vscode-extension-telemetry/issues/41#issuecomment-598852991
  },
  resolve: {
    // support reading TypeScript and JavaScript files, 📖 -> https://github.com/TypeStrong/ts-loader
    extensions: [`.ts`, `.js`, `.svg`],
  },
  plugins: [
    new webpack.DefinePlugin({
      'process.env.AZURE_COLLECT_KEY': JSON.stringify(AZURE_COLLECT_KEY),
      'process.env.EXT_VERSION': JSON.stringify(extensionInfo.version),
      'process.env.EXT_NAME': JSON.stringify(extensionInfo.name),
    })
  ],
  module: {
    rules: [
      {
        test: /\.js$/,
        include: path.resolve(__dirname, `node_modules/@bendera/vscode-webview-elements/dist`),
        type: `asset/source`
      }
    ]
  }
};
module.exports = config;