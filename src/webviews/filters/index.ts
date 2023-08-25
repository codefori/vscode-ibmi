import { ConnectionConfiguration } from "../../api/Configuration";
import { CustomUI } from "../../api/CustomUI";
import { instance } from "../../instantiate";

export async function editFilter(filter?: ConnectionConfiguration.ObjectFilters, copy = false) {
  const config = instance.getConfig();
  if (config) {
    const objectFilters = config.objectFilters;
    const filterIndex = filter ? objectFilters.findIndex(f => f.name === filter!.name) : -1;
    let newFilter = false;

    if (filter) {
      if (copy) {
        filter = {
          name: `${filter.name} - copy`,
          library: filter.library,
          object: filter.object,
          types: [...filter.types],
          member: filter.member,
          memberType: filter.memberType,
          protected: filter.protected
        }

        newFilter = true;
      }
    } else {
      // Otherwise, set the default values
      filter = {
        name: `Filter ${objectFilters.length + 1}`,
        library: `QGPL`,
        object: `*`,
        types: [`*SRCPF`],
        member: `*`,
        memberType: `*`,
        protected: false
      }

      newFilter = true;
    }

    const page = await new CustomUI()
      .addInput(`name`, `Filter name`, `The filter name should be unique.`, { default: filter.name })
      .addInput(`library`, `Library`, `Library name. Cannot be generic name with an asterisk.`, { default: filter.library })
      .addInput(`object`, `Object`, `Object name. Can be generic name with an asterisk. For example: <code>*</code>, or <code>Q*</code>.`, { default: filter.object })
      .addInput(`types`, `Object type filter`, `A comma delimited list of object types. For example <code>*ALL</code>, or <code>*PGM, *SRVPGM</code>. <code>*SRCPF</code> is a special type which will return only source files.`, { default: filter.types.join(`, `) })
      .addInput(`member`, `Member`, `Member name. Can be multi-generic value. Examples: <code>*CL</code> or <code>CL*ABC*</code>. A single <code>*</code> will return all members.`, { default: filter.member })
      .addInput(`memberType`, `Member type`, `Member type. Can be multi-generic value. Examples: <code>RPG*</code> or <code>SQL*LE</code>. A single <code>*</code> will return all member types.`, { default: filter.memberType || `*` })
      .addCheckbox(`protected`, `Protected`, `Make this filter protected, preventing modifications and source members from being saved.`, filter.protected)
      .addButtons({ id: `save`, label: `Save settings` })
      .loadPage<any>(`Filter: ${newFilter ? `New` : filter.name}`);

    if (page && page.data) {
      page.panel.dispose();
      const data = page.data;

      for (const key in data) {

        //In case we need to play with the data
        switch (key) {
          case `name`:
            data[key] = String(data[key]).trim();
            break;
          case `types`:
            data[key] = String(data[key]).split(`,`).map(item => item.trim().toUpperCase()).filter(item => item !== ``);
            break;
          case `object`:
          case `member`:
          case `memberType`:
            data[key] = String(data[key].trim()) || `*`;
            break;
          case `protected`:
            // Do nothing. It's a boolean
            break;
          default:
            data[key] = String(data[key]).toUpperCase();
            break;
        }
      }

      if (newFilter) {
        if (objectFilters.some(f => f.name === data.name)) {
          data.name = `${data.name.trim()} (2)`;
        }
        objectFilters.push(data);
      } else if (filterIndex > -1) {
        objectFilters[filterIndex] = Object.assign(filter, data);
      }

      await ConnectionConfiguration.update(config);
    }
  }
}