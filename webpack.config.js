//@ts-check

'use strict';

const webpack = require(`webpack`);
const fs = require(`fs`);
const path = require(`path`);

const packageJson = require(`./package.json`);
const npm_runner = process.env[`npm_lifecycle_script`];
const isProduction = (npm_runner && npm_runner.includes(`production`));

console.log(`Is production build: ${isProduction}`);
console.log();

let exclude = undefined;

if (isProduction) {
  exclude = path.resolve(__dirname, `src`, `testing`)
}

/// ====================
// Move required binaries to dist folder
/// ====================

const dist = path.resolve(__dirname, `dist`);

fs.mkdirSync(dist, {recursive: true});

const files = [{relative: `src/components/cqsh/cqsh`, name: `cqsh_1`}];

for (const file of files) {
  const src = path.resolve(__dirname, file.relative);
  const dest = path.resolve(dist, file.name);

  console.log(`Copying ${src} to ${dest}`);
  if (fs.existsSync(src)) {
    // Overwrites by default
    fs.copyFileSync(src, dest);
  }
}

console.log(``);

/// ====================
// Webpack configuration
/// ====================

/**@type {webpack.Configuration}*/
const config = {
  target: `node`, // vscode extensions run in a Node.js-context 📖 -> https://webpack.js.org/configuration/node/

  entry: `./src/extension.ts`, // the entry point of this extension, 📖 -> https://webpack.js.org/configuration/entry-context/
  output: {
    // the bundle is stored in the 'dist' folder (check package.json), 📖 -> https://webpack.js.org/configuration/output/
    path: path.resolve(__dirname, `dist`),
    filename: `extension.js`,
    libraryTarget: `commonjs2`,
    devtoolModuleFilenameTemplate: `../[resource-path]`,
  },
  devtool: `nosources-source-map`,
  externals: {
    vscode: `commonjs vscode` // the vscode-module is created on-the-fly and must be excluded. Add other modules that cannot be webpack'ed, 📖 -> https://webpack.js.org/configuration/externals/
  },
  resolve: {
    // support reading TypeScript and JavaScript files, 📖 -> https://github.com/TypeStrong/ts-loader
    extensions: [`.ts`, `.js`, `.svg`],
  },
  plugins: [
    new webpack.DefinePlugin({
      'process.env.VSCODEIBMI_VERSION': JSON.stringify(packageJson.version),
      'process.env.DEV': JSON.stringify(!isProduction),
    }),

    // We do this so we don't ship the optional binaries provided by ssh2
    new webpack.IgnorePlugin({ resourceRegExp: /(original-fs|cpu-features|sshcrypto\.node)/u })
  ],
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude
      },
      {
        test: /\.js$/,
        include: path.resolve(__dirname, `node_modules/@vscode-elements/elements/dist`),
        type: `asset/source`
      },
      {
        test: /\.(ts|tsx)$/i,
        exclude: /node_modules/,
        use: [
          {
            loader: `esbuild-loader`
          }
        ]
      }
    ]
  }
};

module.exports = config;