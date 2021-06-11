const vscode = require(`vscode`);

const specs = {
  C: [
    {
      id: `factor1`,
      name: `Factor 1`,
      start: 11,
      end: 24
    },
    {
      id: `operation`,
      name: `Operation and Extender`,
      start: 25,
      end: 34
    },
    {
      id: `factor2`,
      name: `Factor 2`,
      start: 35,
      end: 48
    },
    {
      id: `result`,
      name: `Result Field`,
      start: 49,
      end: 62
    },
    {
      id: `fieldLength`,
      name: `Field Length`,
      start: 63,
      end: 67
    },
    {
      id: `decimalPositions`,
      name: `Decimal Positions`,
      start: 68,
      end: 79
    },
    {
      id: `resultingIndicators`,
      name: `Resulting Indicators`,
      start: 70,
      end: 75
    }
  ]
}

/**
 * 
 * @param {string} line 
 * @param {number} index 
 * @returns {{id, name, start, end}|undefined}
 */
const getInfoFromLine = (line, index) => {
  if (line[6] === `*`) {
    return undefined;
  }

  const specLetter = line[5].toUpperCase();
  if (specs[specLetter]) {
    const specification = specs[specLetter];

    const item = specification.find(box => index >= box.start && index <= box.end);
    if (item) {
      return item;
    }
  }
  
  return undefined;
}

module.exports = {
  getInfoFromLine
};