
const {CustomUI, Field} = require(`../../api/CustomUI`);

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
      end: 69
    },
    {
      id: `resultingIndicators`,
      name: `Resulting Indicators`,
      start: 70,
      end: 75
    }
  ],

  D: [
    {start: 6, end: 20, name: `Name`, id: `name`},
    {start: 21, end: 21, name: `External Description`, id: `externalDescription`},
    {start: 22, end: 22, name: `Type of Data Structure`, id: `typeOfDs`},
    {start: 23, end: 24, name: `Definition Type`, id: `definitionType`, values: [
      { value: ``,
        text: `The specification defines either a data structure subfield or a parameter within a prototype or procedure interface definition.`},
      { value: `C`,
        text: `The specification defines a constant. Position 25 must be blank.`},
      { value: `DS`,
        text: `The specification defines a data structure.`},
      { value: `PR`,
        text: `The specification defines a prototype and the return value, if any.`},
      { value: `PI`,
        text: `The specification defines a procedure interface, and the return value if any.`},
      { value: `S`,
        text: `The specification defines a standalone field, array or table. Position 25 must be blank.`},
    ]},
    {start: 25, end: 31, name: `From Position`, id: `fromPosition`, padStart: true},
    {start: 32, end: 38, name: `To Position / Length`, id: `toPosition`, padStart: true},
    {start: 39, end: 39, name: `Internal Data Type`, id: `internalDataType`, values: [
      { value: `A`,
        text: `Character (Fixed or Variable-length format)`},
      { value: `B`,
        text: `Numeric (Binary format)`},
      { value: `C`,
        text: `UCS-2 (Fixed or Variable-length format)`},
      { value: `D`,
        text: `Date`},
      { value: `F`,
        text: `Numeric (Float format)`},
      { value: `G`,
        text: `Graphic (Fixed or Variable-length format)`},
      { value: `I`,
        text: `Numeric (Integer format)`},
      { value: `N`,
        text: `Character (Indicator format)`},
      { value: `O`,
        text: `Object`},
      { value: `P`,
        text: `Numeric (Packed decimal format)`},
      { value: `S`,
        text: `Numeric (Zoned format)`},
      { value: `T`,
        text: `Time`},
      { value: `U`,
        text: `Numeric (Unsigned format)`},
      { value: `Z`,
        text: `Timestamp`},
      { value: `*`,
        text: `Basing pointer or procedure pointer`},
      { value: ``, text: `Blank (Character, Packed or Zoned)`}
    ]},
    {start: 40, end: 41, name: `Decimal Positions`, id: `decimalPositions`, padStart: true},
    {start: 43, end: 79, name: `Keywords`, id: `keywords`}
  ],
  F: [
    {start: 6, end: 15, name: `File Name`, id: `fileName`},
    {start: 16, end: 16, name: `File Type`, id: `fileType`},
    {start: 17, end: 17, name: `File Designation`, id: `fileDesignation`},
    {start: 18, end: 18, name: `End of File`, id: `endOfFile`},
    {start: 19, end: 19, name: `File Addition`, id: `fileAddition`},
    {start: 20, end: 20, name: `Sequence`, id: `sequence`},
    {start: 21, end: 21, name: `File Format`, id: `fileFormat`},
    {start: 22, end: 26, name: `Record Length`, id: `recordLength`},
    {start: 27, end: 27, name: `Limits Processing`, id: `limitsProcessing`},
    {start: 28, end: 32, name: `Length of Key or Record Address`, id: `keyLength`},
    {start: 33, end: 33, name: `Record Address Type`, id: `addressType`},
    {start: 34, end: 34, name: `File Organization`, id: `fileOrg`},
    {start: 35, end: 41, name: `Device`, id: `device`},
    {start: 43, end: 79, name: `Keywords`, id: `keywords`}
  ],
  P: [
    {start: 6, end: 20, name: `Name`, id: `name`},
    {start: 23, end: 23, name: `Begin/End Procedure`, id: `proc`},
    {start: 43, end: 79, name: `Keywords`, id: `keywords`}
  ]
}

/**
 * @param {string} line 
 * @param {number} index 
 * @returns {{id, name, start, end}|undefined}
 */
const getInfoFromLine = (line, index) => {
  if (line.length < 6) return undefined;
  if (line[6] === `*`) return undefined;

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

/**
 * @param {string} line 
 * @param {number} index The current piece the cursor is over
 * @returns {{specification: {id, name, start, end}[], active?: number}}|undefined}
 */
const getAreasForLine = (line, index) => {
  if (line.length < 6) return undefined;
  if (line[6] === `*`) return undefined;
  
  const specLetter = line[5].toUpperCase();
  if (specs[specLetter]) {
    const specification = specs[specLetter];

    const active = specification.findIndex(box => index >= box.start && index <= box.end);

    return {
      specification,
      active
    };
  }
}

/**
 * @param {string} line 
 * @param {number} index The current piece the cursor is over
 * @returns {Promise<string|undefined>} New line
 */
const promptLine = async (line, index) => {
  if (line.length < 6) return undefined;
  if (line[6] === `*`) return undefined;
  line = line.padEnd(80);
  
  const specLetter = line[5].toUpperCase();
  if (specs[specLetter]) {
    const specification = specs[specLetter];

    let parts = [];

    specification.forEach(box => {
      parts.push({
        id: box.id,
        text: box.name,
        content: line.substring(box.start, box.end+1).trim(),
        values: box.values
      });
    });

    let ui = new CustomUI();

    parts.forEach((box, index) => {
      if (box.values) {
        //Select box
        ui.addField(new Field(`select`, box.id, box.text));
        ui.fields[index].items = box.values.map(item => ({
          selected: item.value.toUpperCase() === box.content.toUpperCase(),
          value: item.value,
          description: item.value,
          text: item.text
        }));

      } else {
        //Input field
        ui.addField(new Field(`input`, box.id, box.text));
        ui.fields[index].default = box.content;
      }
    });

    ui.addField(new Field(`submit`, `submitButton`, `Update`));

    const {panel, data} = await ui.loadPage(`Column Assistant`);

    if (data) {
      panel.dispose();

      let spot, length;
      for (const key in data) {
        spot = specification.find(box => box.id === key);
        length = (spot.end+1)-spot.start;

        if (data[key].length > length) data[key] = data[key].substr(0, length);

        line = line.substring(0, spot.start) + (spot.padStart ? data[key].padStart(length) : data[key].padEnd(length)) + line.substring(spot.end+1);
      }

      return line.trimEnd();
    }

    return undefined;
  } else {
    return undefined;
  }
}

module.exports = {
  getInfoFromLine,
  getAreasForLine,
  promptLine
};