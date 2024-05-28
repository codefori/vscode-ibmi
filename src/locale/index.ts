import { env } from "vscode";
import { GlobalConfiguration } from "../api/Configuration";
import da from "./ids/da.json";
import en from "./ids/en.json";
import fr from "./ids/fr.json";

export type Locale = {[id: string]: string};

const locales: {[locale: string]: Locale} = {
  en,
  da,
  fr
}

let currentLocale = String(env.language);
updateLocale();

export function updateLocale() {
  const localeSetting = GlobalConfiguration.get(`locale`) as string;
  const vscLocale = env.language;

  currentLocale = (localeSetting === `inherit` ? vscLocale : localeSetting);
}

export function t(id: string, ...values: any[]) {
  // Check for the id in their local locale first, then default to en, then just show the id.
  let text = locales[currentLocale] && locales[currentLocale][id] ? locales[currentLocale][id] : (locales.en[id] || `!${id}!`);

  if (values.length > 0) {
    values.forEach((value, i) => {
      text = text.replaceAll(`{${i}}`, typeof value === 'string' ? value : String(value));
    });
  }

  return text;
}