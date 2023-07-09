import { env } from "vscode";
import {en} from "./ids/en";
import {da} from "./ids/da";
import { GlobalConfiguration } from "../api/Configuration";

const locales: {[locale: string]: Locale} = {
  en,
  da
}

export type Locale = {[id: string]: string};

const currentLocale = String(GlobalConfiguration.get(`locale`) || env.language);

export function t(id: string, values: string[] = []) {
  // Check for the id in their local locale first, then default to en, then just show the id.
  let text = locales[currentLocale][id] ? locales[currentLocale][id] : (locales.en[id] || `!${id}!`);

  if (values.length > 0) {
    values.forEach((value, i) => {
      text = text.replaceAll(`{${i}}`, value);
    });
  }

  return text;
}