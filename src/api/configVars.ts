import * as path from 'path';
import * as os from 'os';
import { ConnectionData } from './types';

function hasOwnProperty<O extends object, K extends PropertyKey>(
  obj: O,
  key: K,
): obj is O & Record<K, unknown> {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

export function replace(data: string) {

  data = data.replace(/\${pathSeparator}/g, path.sep);
  data = data.replace(/\${userHome}/g, os.homedir());

  return data;
}

export function replaceAll(connectionObject: ConnectionData) {

  Object.entries(connectionObject).forEach(([key, value]) => {
    if (typeof value === 'string') {
      if (hasOwnProperty(connectionObject, key)){
        connectionObject[key] = replace(value);
      } 
    }
  });

}
