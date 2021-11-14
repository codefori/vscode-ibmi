const path = require(`path`);

const instance = require(`../../Instance`);

module.exports = class Prototypes {
  static async searchPrototypesQSYS(library) {
    const connection = instance.getConnection();
    const content = instance.getContent();

    const sourceFiles = await content.getObjectList({
      library,
      object: `*`,
      types: [`*SRCPF`],
    });

    const search = await connection.qshCommand(
      `/usr/bin/grep -in 'dcl-pr.*ext' ${sourceFiles.map(srcPf => `/QSYS.LIB/${library}.LIB/${srcPf.name}.FILE/*`).join(` `)}`
    );

    /** @type {{memberPath: string, line: number, name: string}[]} */
    let results = [];

    // @ts-ignore
    const lines = search.split(`\n`);

    lines.forEach(line => {
      let [memberPath, lineNumber, name] = line.split(`:`);

      if (memberPath.includes(`SQLTEMP`) || memberPath.includes(`/EVF`)) return;

      const pathDetails = path.posix.parse(memberPath);
      name = name.trim().split(` `)[1].toUpperCase();

      results.push({
        memberPath: library + `/` + path.posix.parse(pathDetails.dir).name + `/` + pathDetails.name,
        line: Number(lineNumber),
        name,
      });
    });

    return results;
  }
}