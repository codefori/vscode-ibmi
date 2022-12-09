## vscode-ibmi-types

Type definitions for working with the Code for IBM i API.

Install the types with `npm i npm i @halcyontech/vscode-ibmi-types`.

Use in your extension:

```ts
import {CodeForIBMi} from '@halcyontech/vscode-ibmi-types';

//...

vscode.extensions.getExtension<CodeForIBMi>('halcyontechltd.code-for-ibmi')
```