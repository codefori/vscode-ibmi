import { env } from "vscode";
import {en} from "./ids/en";
import {da} from "./ids/da";

const locales: {[locale: string]: Locale} = {
  en,
  da
}

export type Locale = {[id: string]: string};

export function t(id: string, values: string[] = []) {
  const currentLocale = env.language;

  // Check for the id in their local local first, then default to en, then just show the id.
  let text = locales[currentLocale] ? locales[currentLocale][id] : (locales.en[id] || `!${id}!`);

  if (values.length > 0) {
    values.forEach((value, i) => {
      text = text.replaceAll(`{${i}}`, value);
    });
  }

  return text;
}