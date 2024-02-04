import { ConnectionConfiguration } from "../../api/Configuration";
import { CustomUI } from "../../api/CustomUI";
import { Tools } from "../../api/Tools";
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
          filterType: 'simple',
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
        filterType: 'simple',
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
      .addSelect(`filterType`, `Filtering type`, [
        { value: 'simple', description: 'Simple', text: `A comma-separated list of multi-generic values. Examples: *, Q* or *CL*SRC*. A single *, *ALL or blank will return everything.`, selected: filter.filterType === "simple" },
        { value: 'regex', description: 'Regex', text: `Use a single RegEx for filtering.`, selected: filter.filterType === "regex" }
      ], `Select the filtering strategy to apply for filtering names (not object types).<br/>Checkout <a href="https://regex101.com">https://regex101.com</a> to get started with RegExs.`)
      .addInput(`library`, `Libraries`, `Library names filter.`, { default: filter.library })
      .addInput(`object`, `Objects`, `Object names filter.`, { default: filter.object })
      .addInput(`types`, `Object types`, `A comma delimited list of object types. For example <code>*ALL</code>, or <code>*PGM</code>, <code>*SRVPGM</code>. <code>*SRCPF</code> is a special type which will return only source files.`, { default: filter.types.join(`, `) })
      .addInput(`member`, `Members`, `Member names filter.`, { default: filter.member })
      .addInput(`memberType`, `Member type`, `Member types filter.`, { default: filter.memberType })
      .addCheckbox(`protected`, `Protected`, `Make this filter protected, preventing modifications and source members from being saved.`, filter.protected)
      .addButtons({ id: `save`, label: `Save settings` })
      .loadPage<any>(`Filter: ${newFilter ? `New` : filter.name}`);

    if (page && page.data) {
      page.panel.dispose();
      const data = page.data;

      for (const key in data) {
        const useRegexFilters = data.filterType === "regex";
        
        //In case we need to play with the data
        switch (key) {
          case `name`:
          case `filterType`:
          case `library`:
            data[key] = String(data[key]).trim();
            break;
          case `types`:
            data[key] = String(data[key]).split(`,`).map(item => item.trim().toUpperCase()).filter(item => item !== ``);
            break;
          case `object`:
            data[key] = (String(data[key].trim()) || `*`)
              .split(',')
              .map(o => useRegexFilters ? o : o.toLocaleUpperCase())
              .filter(Tools.distinct)
              .join(",");
            break;
          case `member`:
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