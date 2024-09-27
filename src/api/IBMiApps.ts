import IBMi from "./IBMi";
import { RemoteApp, RemoteApps, RemoteFeatures } from "../typings";

export default class IBMiApps {

    private remoteApps: RemoteApps;
    private remoteFeatures: RemoteFeatures;

    constructor() {
        this.remoteApps = [
            {
                path: `/usr/bin/`,
                names: [`setccsid`, `iconv`, `attr`, `tar`, `ls`]
            },
            {
                path: `/QOpenSys/pkgs/bin/`,
                names: [`git`, `grep`, `tn5250`, `md5sum`, `bash`, `chsh`, `stat`, `sort`, `tar`, `ls`, `find`]
            },
            {
                path: `/QSYS.LIB/`,
                // In the future, we may use a generic specific.
                // Right now we only need one program
                // specific: `*.PGM`,
                specific: `QZDFMDB2.PGM`,
                names: [`QZDFMDB2.PGM`]
            },
            {
                path: `/QIBM/ProdData/IBMiDebugService/bin/`,
                specific: `startDebugService.sh`,
                names: [`startDebugService.sh`]
            }
        ];

        this.remoteFeatures = {};
        this.setRemoteFeatures();

    }

    addRemoteApp(remoteApp: RemoteApp) {

        //Add remote App
        this.remoteApps.push(remoteApp);

        //Add possible features to list
        for(const name of remoteApp.names) {
            this.remoteFeatures[name] = undefined;
        }

    }

    getRemoteApps(): RemoteApps {
        return this.remoteApps;
    }

    setRemoteFeatures() {

        for (const feature of this.remoteApps) {
            for(const name of feature.names) {
                this.remoteFeatures[name] = undefined;
            }
        }
    
    }

    getRemoteFeatures(): RemoteFeatures {
        return this.remoteFeatures;
    }

    async checkRemoteFeatures(remoteApp: RemoteApp, connection: IBMi) {
        
        const call = await connection.sendCommand({ command: `ls -p ${remoteApp.path}${remoteApp.specific || ``}` });
        if (call.stdout) {
            const files = call.stdout.split(`\n`);

            if (remoteApp.specific) {
              for (const name of remoteApp.names)
                this.remoteFeatures[name] = files.find(file => file.includes(name));
            } else {
              for (const name of remoteApp.names)
                if (files.includes(name))
                  this.remoteFeatures[name] = remoteApp.path + name;
            }
          }

    }

}