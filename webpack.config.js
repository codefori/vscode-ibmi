//@ts-check

'use strict';

const webpack = require(`webpack`);

const path = require(`path`);

const npm_runner = process.env[`npm_lifecycle_script`];
const isProduction = (npm_runner && npm_runner.includes(`production`));

console.log(`Is production build: ${isProduction}`);
console.log();

let exclude = undefined;

if (isProduction) {
  exclude = path.resolve(__dirname, `src`, `testing`)
}

console.log(`Checking for missing keys in locales...`);
const baseLocale = require(`./src/locale/ids/en.json`);
const locales = {
  da: require(`./src/locale/ids/da.json`),
  de: require(`./src/locale/ids/de.json`),
  fr: require(`./src/locale/ids/fr.json`),
  no: require(`./src/locale/ids/no.json`),
  pl: require(`./src/locale/ids/pl.json`),
};

let localeIsBad = false;

for (const locale in locales) {
  for (const key in baseLocale) {
    if (!locales[locale][key]) {
      localeIsBad = true;
      console.error(`\tmissing key '${key}' in locale ${locale}`);
    }
  }
}

if (localeIsBad && isProduction) {
  console.error(`\n\nMissing keys in locales. Aborting build.`);
  process.exit(1);
}

console.log();

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
        include: path.resolve(__dirname, `node_modules/@bendera/vscode-webview-elements/dist`),
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