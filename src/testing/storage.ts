import assert from "assert";
import vscode from "vscode";
import { TestSuite } from ".";
import { instance } from "../instantiate";

export const StorageSuite: TestSuite = {
  name: `Extension storage tests`,
  tests: [
    {
      name: "Authorized extensions", test: async () => {
        const storage = instance.getStorage();
        if(storage){ 
          const extension = vscode.extensions.getExtension("halcyontechltd.code-for-ibmi")!;          
          try{
            let auth = storage.getExtensionAuthorisation(extension);
            assert.strictEqual(undefined, auth, "Extension is already authorized");
            storage.grantExtensionAuthorisation(extension);
            
            auth = storage.getExtensionAuthorisation(extension);
            assert.ok(auth, "Authorisation not found");
            assert.strictEqual(new Date(auth.since).toDateString(), new Date().toDateString(), "Access date must be today");

            const lastAccess = auth.lastAccess;
            await new Promise(r => setTimeout(r, 100)); //Wait a bit
            auth = storage.getExtensionAuthorisation(extension);
            assert.ok(auth, "Authorisation not found");
            assert.notStrictEqual(lastAccess, auth.lastAccess, "Last access did not change")
          }
          finally{
            const auth = storage.getExtensionAuthorisation(extension);
            if(auth){
              storage.revokeExtensionAuthorisation(auth);
            }
          }
        }
        else{
          throw Error("Cannot run test: no storage")
        }
      }
    }
  ]
}