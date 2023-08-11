import * as xml2js from "xml2js";

import { window } from "vscode";
import { instance } from "../../instantiate";

import * as gencmdxml from "./gencmdxml";
import { ComplexTab, CustomUI, Section, SelectItem, Tab } from "../../api/CustomUI";
import { clChoicePgmValues, clDef, clElem, clParm, clQual, clSngVal, clSpcVal, clType, clValue, clValues } from "./clDef";

export async function init() {
  const connection = instance.getConnection()!;
  const clComponentsInstalled = checkRequirements();

  if (!clComponentsInstalled) {
    //We need to install the CL components
    window.showInformationMessage(`Would you like to install the CL prompting tools onto your system?`, `Yes`, `No`)
      .then(async result => {
        switch (result) {
        case `Yes`:
          try {
            await install();
            window.showInformationMessage(`CL components installed.`);
            connection.remoteFeatures[`GENCMDXML.PGM`] = `INSTALLED`;
          } catch (e) {
            window.showInformationMessage(`Failed to install CL components.`);
          }
          break;
        }
      });
  }
}

export function checkRequirements() {
  const connection = instance.getConnection();

  return (connection !== undefined && connection.remoteFeatures[`GENCMDXML.PGM`] !== undefined);
}

async function install() {
  const connection = instance.getConnection()!;
  const content = instance.getContent()!;
  const config = instance.getConfig()!;

  const tempLib = config.tempLibrary;

  try {
    await connection.remoteCommand(`CRTSRCPF ${tempLib}/QTOOLS`, undefined)
  } catch (e) {
    //It may exist already so we just ignore the error
  }

  await content.uploadMemberContent(undefined, tempLib, `QTOOLS`, `GENCMDXML`, gencmdxml.content.join(`\n`));
  await connection.remoteCommand(
    `CRTBNDCL PGM(${tempLib}/GENCMDXML) SRCFILE(${tempLib}/QTOOLS) DBGVIEW(*SOURCE) TEXT('vscode-ibmi xml generator for commands')`
  );
}

export async function getDefinition(command: string, library = `*LIBL`): Promise<clDef | undefined> {
  if (checkRequirements()) { 
    const validLibrary = library || `*LIBL`;
    
    /** @type {IBMi} */
    const connection = instance.getConnection();

    const content = instance.getContent();

    /** @type {Configuration} */
    const config = instance.getConfig();

    const tempLib = config!.tempLibrary;

    const targetCommand = command.padEnd(10).toUpperCase() + validLibrary.padEnd(10).toUpperCase();
    const targetName = command.toUpperCase().padEnd(10);

    const result = await connection?.runCommand({
      command: `CALL PGM(${tempLib}/GENCMDXML) PARM('${targetName}' '${targetCommand}')`,
      environment: `ile`
    });

    if (result?.code === 0) {
      const xml = await content!.downloadStreamfile(`/tmp/${targetName}`);

      const commandData = await xml2js.parseStringPromise(xml);

      return commandData.QcdCLCmd;
    } else {
      throw new Error(result?.stderr);
    }
  }
}

export function generatePromptUI(def: clDef): CustomUI {
  const mainOps = new Section();
  const additionalOps = new Section();
  
  def.Cmd[0].Parm.sort((a, b) => parseInt(a.$.PosNbr!) - parseInt(b.$.PosNbr!));
  
  def.Cmd[0].Parm.forEach((parm: clParm) => { 
    if (parm.$.PmtCtl !== "PMTRQS") {
      addAllFields(parm, mainOps);
    } else {
      addAllFields(parm, additionalOps);
    }
  });

  const ui = new CustomUI();
  let tabs: ComplexTab[] = [
    {label: 'Main Parameters', fields: mainOps.fields}
  ];

  //Only add the tab if we actually have additional options
  if(additionalOps.fields.length > 0) {
    tabs.push({label: 'Additional Parameters', fields: additionalOps.fields});
  }

  ui.addComplexTabs(tabs);

  ui.addButtons(
    {id: 'run', label:'Run', requiresValidation: true},
    {id: 'cancel', label:'Cancel'}
  )

  return ui;
}

function addAllFields(parm: clParm, section: Section) {
  if (parm.Qual) {
    if(parseInt(parm.$.Max!) > 1) {
      const tempSection = new Section(); //To hold all the newly created fields for the elem list
      layoutQuals(parm.Qual, tempSection, parm, parm.$.Kwd, 1, parseInt(parm.$.Min!) > 0);

      section.addComplexMultiselect(parm.$.Kwd, tempSection.fields, {
        indent: 1
      });
    } else {
      layoutQuals(parm.Qual, section, parm, parm.$.Kwd, 1, parseInt(parm.$.Min!) > 0);
    }
  } else if (parm.Elem) {
    // There is no input for the main param when it has elems, so just display the prompt
    section.addHeading(`${parm.$.Prompt!}:`, 4); //looks bad
    if(!parm.Elem[0].$.Dft) parm.Elem[0].$.Dft = parm.$.Dft;

    //In this case, we need to create one big multiselect that takes all fields
    if(parseInt(parm.$.Max!) > 1) {
      const tempSection = new Section(); //To hold all the newly created fields for the elem list
      layoutElems(parm.Elem, tempSection, parm.$.Kwd, 1, parseInt(parm.$.Min!) > 0);

      section.addComplexMultiselect(parm.$.Kwd, tempSection.fields, {
        indent: 1
      });
    } else {
      layoutElems(parm.Elem, section, parm.$.Kwd, 1, parseInt(parm.$.Min!) > 0);
    }
  } else {
    if (parm.$.Type === "ELEM") {
      //If the type is ELEM but there were no elems, this param shouldn't be prompted on
      return;
    }

    layoutField(parm, section, {
      required: parseInt(parm.$.Min!) > 0
    });
  }
}

function layoutQuals(quals: clQual[], section: Section, parent: clParm | clElem, kwd: string, indents = 1, required = false): void {
  if(!quals[0].$.Dft) {
    //Use the default of the parent if the first qual doesn't have one
    quals[0].$.Dft = parent.$.Dft;
  }

  quals.forEach((qual: clQual) => {
    //Cast this qual to a clElem so we can lay it out like the rest
    let node = qual as clElem;
    let indent = indents;
    if (!node.$.Prompt) { //This is the main qual, so don't indent
      indent--; 
      node.$.Prompt = parent.$.Prompt!;
    }
    node.$.Max = "1";

    layoutField(node, section, {
      parentKwd: kwd,
      indents: indent,
      required: required
    });
  });
}

function layoutElems(elems: clElem[], section: Section, kwd: string, indents = 1, required = false): void {
  elems.forEach((elem) => {
    if(elem.Qual) {
      layoutQuals(elem.Qual, section, elem, kwd, indents + 1, required && (parseInt(elem.$.Min!) > 0));
    } else if(elem.Elem) {
      if(elem.$.Prompt) {
        section.addHeading(`${elem.$.Prompt}:`, 4, {
          indent: indents
        });
        //Need to propogate down dft value to first in elem list if nested
        if(!elem.Elem[0].$.Dft) elem.Elem[0].$.Dft = elem.$.Dft;
      } else {
        // Sometimes nested elems won't have a header, but we still want a bit of a gap to separate them (e.g ANZPFRDTA "Time period for report" section)
        section.addParagraph(`\n`);
      }

      if(parseInt(elem.$.Max!) > 1) {
        const tempSection = new Section(); //To hold all the newly created fields for the elem list
        layoutElems(elem.Elem, tempSection, kwd, indents + 1, required && (parseInt(elem.$.Min!) > 0));
  
        section.addComplexMultiselect(`${kwd}-${elem.$.Prompt}`, tempSection.fields, {
          indent: indents + 1
        });
      } else {
        layoutElems(elem.Elem, section, kwd, indents + 1, required && (parseInt(elem.$.Min!) > 0));
      }
    } else {
      layoutField(elem, section, {
        parentKwd: kwd,
        indents: indents,
        required: required
      });
    }
  });
}

function layoutField(node: clParm | clElem, section: Section, options?: { parentKwd?: string, indents?: number, required?: boolean }) {
  let values: string[] = []
  let kwd = '';
  const minlength = options?.required && (parseInt(node.$.Min!) > 0) ? 1 : 0; 
  const maxLength = Math.max(getMaxLength(node), node.$.Dft ? node.$.Dft.length : 0); //In case the default value has a longer value than a normal input

  if(isParm(node)) {
    kwd = node.$.Kwd
  } else {
    kwd = `${options?.parentKwd!}-${node.$.Prompt}`; // Elems use parent Kwd, adding the prompt for disambiguation
  }

  const children = getChildValues(node);

  if(children.length > 0) {
    children.forEach((child: clType) => {
      if(isValue(child)) {
        child.Value?.forEach((val) => {
          if(values.indexOf(val.$.Val) === -1)
            values.push(val.$.Val);
        })
      }
    });

    if(node.$.Rstd === "YES") { //Restricted values
      let items: SelectItem[] = [];
      
      values.forEach(val => {
        items.push({
          description: val,
          text: val,
          value: val,
          selected: val === node.$.Dft
        });
      });

      if(parseInt(node.$.Max!) <= 1) {
        if(items.length < 4) {
          section.addRadioGroup(kwd, node.$.Prompt!, items, '', {
            indent: options?.indents
          })
        } else {
          section.addSelect(kwd, node.$.Prompt!, items, '', {
            indent: options?.indents,
            comboBox: true,
            minlength: minlength
          });
        }
      } else {
        section.addSelect(kwd, node.$.Prompt!, items, '', {
          multiSelect: true,
          indent: options?.indents,
          minlength: minlength
        });
      }
    } else {
      if(parseInt(node.$.Max!) <= 1) {
        section.addInput(kwd, node.$.Prompt!, node.$.Choice, {
          default: node.$.Dft,
          rows: Math.min(parseInt(node.$.Max!), 5),
          indent: options?.indents,
          maxlength: maxLength,
          minlength: minlength
        });
      } else {
        section.addComplexMultiselect(kwd, [
          ...new Section().addInput(`${kwd}-input`, node.$.Prompt!, node.$.Choice, {
              default: node.$.Dft,
              indent: options?.indents,
              maxlength: maxLength,
              minlength: minlength
            }).fields
        ], {
          indent: options?.indents
        });
      }
    } 
  } else {
    section.addInput(kwd, node.$.Prompt!, node.$.Choice, {
      default: node.$.Dft,
      rows: Math.min(parseInt(node.$.Max!), 5),
      indent: options?.indents,
      maxlength: maxLength,
      minlength: minlength
    });
  }
}

function getMaxLength(node: clParm | clElem): number {
  if(node.$.Len) {
    return parseInt(node.$.Len)
  }

  //If there is no length specified, use the default values
  switch (node.$.Type) {
    case '*DEC':
    case '*X':
      return 15;

    case '*HEX':
      return 2;

    case '*LGL':
      return 1;

    case '*CHAR':
    case '*PNAME':
      return 32;

    case '*NAME':
    case '*GENERIC':
    case '*SNAME':
    case '*CNAME':
      return 10;

    case '*VARNAME':
      return 11;

    case '*CMDSTR':
      return 256;

    default:
      // Len is not allowed if not any of the above types, so return max length
      return 20000;
  }
}

function getChildValues(node: clParm | clElem): clType[] {
  return [
    ...(node.ChoicePgmValues ?? []),
    ...(node.SngVal ?? []),
    ...(node.SpcVal ?? []),
    ...(node.Values ?? [])
  ];
}

function isValue(node: any): node is clSngVal | clSpcVal | clValues | clChoicePgmValues {
  return node.Value !== undefined && node.$ === undefined;
}

function isParm(node: any): node is clParm {
  return node.$.Kwd !== undefined && node.$.Type !== undefined;
}

export function generateClFromUI(def: clDef, data: any): string {
  // `data` should be the data returned from a page that was generated by generatePromptUI
  let result = def.Cmd[0].$.CmdName;

  def.Cmd[0].Parm.forEach(parm => {
    if(parm.Elem) {
      const eString = getElemString(parm.Elem, parm.$.Kwd, data);
      if(eString != '()') {
        result += ` ${parm.$.Kwd}${eString}`
      }
    } else if(parm.Qual) {
      const qString = getQualString(parm.Qual, parm.$.Kwd, data);
      if(qString !== '') {
        result += ` ${parm.$.Kwd}(${qString})`;
      }
    } else {
      const input = data[parm.$.Kwd];
      if(input instanceof Array<any>) {
        if(input[0] !== parm.$.Dft) {
          result += ` ${parm.$.Kwd}(`;
          input.forEach(s => { result += `${s} `});
          result = result.trim() + ')';
        }
      } else if(includeString(input, parm.$.Dft!)) {
        result += ` ${parm.$.Kwd}(${input.trim().split(`\n`).join(' ')})`;
      }
    }
  });

  return result;
}

function getQualString(quals: clQual[], kwd: string, data: any): string {
  let result = '';

  // This is the case for multiselect quals, so format each entry
  if(data[kwd]) {
    const input: string = data[kwd];
    const entries = input.trim().split(`\n`);
    entries.forEach(entry => {
      const split = entry.split(' ');
      for(let i = quals.length-1; i >= 0; i--) {
        if(includeString(split[i], quals[i].$.Dft!)) {
          result += split[i].toUpperCase();
          if(i !== 0) {
            result += '/';
          }
        }
      }
      result += ' ';
    })
    return result.trim();
  }
  
  // Should take form qual3/qual2/qual1
  for(let i = quals.length-1; i >= 0; i--) {
    const input: string = data[`${kwd}-${quals[i].$.Prompt?.replaceAll(`'`, '`')}`];
    if(includeString(input, quals[i].$.Dft!)) {
      result += input.toUpperCase();
      if(i !== 0) {
        result += '/';
      }
    }
  }
  return result;
}

function getElemString(elems: clElem[], kwd: string, data: any): string {
  let result = `(`;
  // Multiselect elems will have many parts already aggregated into a single output, so just use that as the result
  if(data[kwd]) {
    return parseElemMulti(elems, data[kwd]);
  }

  //Otherwise get all the individual inputs
  for(const elem of elems) {
    if(elem.Elem) {
      if((parseInt(elem.$.Max!) > 1) && data[`${kwd}-${elem.$.Prompt}`]) {
        //This elem has a sub-elem multiselect, so gather that data
        result += parseElemMulti(elem.Elem, data[`${kwd}-${elem.$.Prompt}`]) + ` `;
      } else {
        const eString = getElemString(elem.Elem, kwd, data);
        if(eString != '()') {
          result += eString + ` `;
        }
      }
    } else if(elem.Qual) {
      result += getQualString(elem.Qual, kwd, data) + ` `;
    } else {
      const input: string | Array<string> = data[`${kwd}-${elem.$.Prompt?.replaceAll(`'`, '`')}`];
  
      if(input instanceof Array<string>) {
        if(includeString(input[0], elem.$.Dft!)) {
          result += input.join(' ');
        }
      } else if(includeString(input, elem.$.Dft!)) {
        if(input.indexOf(`\n`) > 0) {
          result += `(${input.split(`\n`).join(` `)}) `;
        } else {
          result += `${input} `;
        }
      }
    }
  }

  return result.trim() + `)`;
}

function parseElemMulti(elems: clElem[], input: string): string {
  let result = '('
  const rows = input.trim().split(`\n`);
  rows.forEach(row => {
    // Split the string into each input (or multiline input that is wrapped in parentheses)
    const split = row.trim().match(new RegExp('([^\\s\\(\\)]+)|\\([^)]*\\)', 'g'));
    if(!split) return;
    let temp = '';
    let splitIndex = 0;
    for(const elem of elems) {
      if(elem.Qual) {
        //Move backwards through the qual list to get correct order
        splitIndex += elem.Qual.length-1;
        for(let i = elem.Qual.length-1; i >= 0; i--) {
          if(includeString(split[splitIndex], elem.Qual[i].$.Dft!)) {
            temp += split[splitIndex].toUpperCase();
            if(i !== 0) {
              temp += '/';
            }
          }
          splitIndex--;
        }
        temp += ' ';
        splitIndex += elem.Qual.length;
      } else if(includeString(split[splitIndex], elem.$.Dft!)) {
        temp += `${split[splitIndex]} `;
      }
      splitIndex++;
    }
    result += `(${temp.trim()}) `
  });

  return result.trim() + `)`;
}

function includeString(input: string, dft: string): boolean {
  return input !== undefined && input !== dft && input !== '';
}
