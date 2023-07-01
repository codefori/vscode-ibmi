import { env } from "vscode";
import {en} from "./ids/en";

const locales: {[locale: string]: Locale} = {
  en
}

export type Locale = {[id: string]: string};

export function t(id: string, values: string[] = []) {
  const currentLocal = env.language;

  // Check for the id in their local local first, then default to en, then just show the id.
  let text = locales[currentLocal] ? locales[currentLocal][id] : (locales.en[id] || `!${id}!`);

  if (values.length > 0) {
    values.forEach((value, i) => {
      text = text.replaceAll(`{${i}}`, value);
    });
  }

  return text;
}