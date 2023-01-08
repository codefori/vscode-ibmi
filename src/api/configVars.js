const path = require(`path`);
const os = require(`os`);

const configVars = {

  replace: function(string) {

    string = string.replace(/\${pathSeparator}/g, path.sep);
    string = string.replace(/\${userHome}/g, os.homedir());

    return string;
  },

  replaceAll: function(obj) {

    for (let val in obj) {
      if (typeof obj[val] === `string`) {
        obj[val] = configVars.replace(obj[val]);
      }
    }

  }

}

module.exports = configVars;