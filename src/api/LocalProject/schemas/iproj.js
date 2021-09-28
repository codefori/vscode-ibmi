const qsys = require(`./actions/qsys`);
const ifs = require(`./actions/ifs`);

const defaultConfig = {
  version: `0.0.1`,
  description: `IBM i Project`,
  repository: ``,
  objlib: `&DEVLIB`,
  actions: [
    {
      name: `Compile: CRTCMD`,
      command: `CRTCMD CMD(&OBJLIB/&NAME) PGM(&OBJLIB/&NAME) SRCFILE(&OBJLIB/&FOLDER) ALLOW(*ALL) CURLIB(*NOCHG) PRDLIB(*NOCHG)`,
      fileSystem: `qsys`,
      commandEnvironment: `qsys`,
      extensions: [`cmd`]
    },
    {
      name: `CRTDSPF`,
      command: `CRTDSPF FILE(&OBJLIB/&NAME) SRCFILE(&OBJLIB/&FOLDER) SRCMBR(&NAME) OPTION(*EVENTF)`,
      fileSystem: `qsys`,
      commandEnvironment: `qsys`,
      extensions: [`dspf`]
    },
    {
      name: `Compile: CRTPGM`,
      command: `CRTPGM PGM(&OBJLIB/&NAME) MODULE(*PGM) ENTMOD(*FIRST) BNDSRVPGM(*NONE) BNDDIR(*NONE) ACTGRP(*ENTMOD) TGTRLS(*CURRENT)`,
      fileSystem: `none`,
      commandEnvironment: `qsys`
    },
  ]
};

/**
 * 
 * @param {"qsys"|"ifs"} type 
 * @returns {object} default config
 */
module.exports = (type) => {
  switch (type) {
  case `qsys`:
    return {
      ...defaultConfig,
      actions: [
        ...qsys,
        ...defaultConfig.actions,
      ]
    };
    
  case `ifs`:
    return {
      ...defaultConfig,
      actions: [
        ...ifs,
        ...defaultConfig.actions,
      ]
    };
  }
};