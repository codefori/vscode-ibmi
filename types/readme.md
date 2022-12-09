## vscode-ibmi-types

Type definitions for working with the Code for IBM i API.

Install from this repository with `npm i halcyon-tech/vscode-ibmi-types`.

Use in your extension:

```ts
import {CodeForIBMi} from 'vscode-ibmi-types';

//...

vscode.extensions.getExtension<CodeForIBMi>('halcyontechltd.code-for-ibmi')
```