import escapeStringRegexp from 'escape-string-regexp';

type Filter = {
  test: (text: string) => boolean
  noFilter: boolean
}

const toRegexp = (regex: string) => new RegExp(regex, "i");

export type FilterType = 'simple' | 'regex';

export function parseFilter(filterString?: string, type?: FilterType): Filter {
  const predicates: RegExp[] = [];
  if (filterString) {
    switch (type) {
      case 'regex':
        if (!/^\^?\.?\*\$?$/.test(filterString) && escapeStringRegexp(filterString).indexOf("\\") > -1) { //regexp must not be relevant: not '.*' and an actual regexp (nothing escaped when escaping -> not a regexp)
          predicates.push(toRegexp(filterString));
        }
        break;
      default:
        const filters = filterString.split(',').map(f => f.trim());
        if (!filters.some(filter => /^\*(?:ALL)?$/.test(filter)) && (filters.length > 1 || filters[0].includes('*'))) { //*, *ALL or a single value with no '*' is not a filter
          predicates.push(...filters
            .map(filter => escapeStringRegexp(filter))
            .map(filter => toRegexp(`^${filter.replaceAll('\\*', '.*')}$`))); //* has been escaped, hence the '\\*'
        }
    }
  }

  if (predicates.length) {
    return {
      test: (text) => predicates.some(regExp => regExp.test(text)),
      noFilter: false
    }
  }
  else {
    return {
      test: () => true,
      noFilter: true
    }
  }
}

/**
 * Return filterString if it is a single, generic name filter (e.g. QSYS*)
 * @param filterString 
 * @returns filterString if it is a single generic name or undefined otherwise
 */
export function singleGenericName(filterString?: string) {
  return filterString && !filterString.includes(',') && filterString.indexOf('*') === filterString.length - 1 ? filterString : undefined;
}