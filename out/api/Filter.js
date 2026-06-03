"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.singleGenericName = exports.parseFilter = void 0;
const escape_string_regexp_1 = __importDefault(require("escape-string-regexp"));
const toRegexp = (regex) => new RegExp(regex, "i");
function parseFilter(filterString, type) {
    const predicates = [];
    if (filterString) {
        switch (type) {
            case 'regex':
                if (!/^\^?\.?\*\$?$/.test(filterString) && (0, escape_string_regexp_1.default)(filterString).indexOf("\\") > -1) { //regexp must not be relevant: not '.*' and an actual regexp (nothing escaped when escaping -> not a regexp)
                    predicates.push(toRegexp(filterString));
                }
                break;
            default:
                const filters = filterString.split(',').map(f => f.trim());
                if (!filters.some(filter => /^\*(?:ALL)?$/.test(filter)) && (filters.length > 1 || filters[0].includes('*'))) { //*, *ALL or a single value with no '*' is not a filter
                    predicates.push(...filters
                        .map(filter => (0, escape_string_regexp_1.default)(filter))
                        .map(filter => toRegexp(`^${filter.replaceAll('\\*', '.*')}$`))); //* has been escaped, hence the '\\*'
                }
        }
    }
    if (predicates.length) {
        return {
            test: (text) => predicates.some(regExp => regExp.test(text)),
            noFilter: false
        };
    }
    else {
        return {
            test: () => true,
            noFilter: true
        };
    }
}
exports.parseFilter = parseFilter;
/**
 * Return filterString if it is a single, generic name filter (e.g. QSYS*)
 * @param filterString
 * @returns filterString if it is a single generic name or undefined otherwise
 */
function singleGenericName(filterString) {
    return filterString && !filterString.includes(',') && filterString.indexOf('*') === filterString.length - 1 ? filterString : undefined;
}
exports.singleGenericName = singleGenericName;
//# sourceMappingURL=Filter.js.map