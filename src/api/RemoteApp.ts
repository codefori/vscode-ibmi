import { RemoteFeature, RemoteApps } from "../typings";

export default class RemoteApp {
  
    private remoteApps: RemoteApps;
    
    constructor() {
      this.remoteApps = [ // All names MUST also be defined as key in 'remoteFeatures' below!!
      {
        path: `/usr/bin/`,
        names: [`setccsid`, `iconv`, `attr`, `tar`, `ls`]
      },
      {
        path: `/QOpenSys/pkgs/bin/`,
        names: [`git`, `grep`, `tn5250`, `md5sum`, `bash`, `chsh`, `stat`, `sort`, `tar`, `ls`]
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
    }
  
    addFeature(remoteFeature: RemoteFeature) {
      this.remoteApps.push(remoteFeature);
    }
  
    getFeatures(): RemoteApps {
      return this.remoteApps;
    }
  
  }