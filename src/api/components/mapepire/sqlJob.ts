import type { ConnectionResult, JDBCOptions, ServerRequest, ServerResponse } from "@ibm/mapepire-js";
import { SQLJob } from "@ibm/mapepire-js";
import { ClientChannel } from "ssh2";
import { Mapepire } from ".";
import IBMi from "../../IBMi";
import { JobStatus } from "./types";

export class sshSqlJob extends SQLJob {
  static application = "<unknown>";
  private channel: ClientChannel | undefined;
  private onClose?: () => void;

  async getSshChannel(mapepire: Mapepire, connection: IBMi, javaPath: string): Promise<ClientChannel> {
    const useExec = await Mapepire.useExec(connection);

    return new Promise((resolve, reject) => {
      // Setting QIBM_JAVA_STDIO_CONVERT and QIBM_PASE_DESCRIPTOR_STDIO to make sure all PASE and Java converters are off
      const startingCommand = `QIBM_JAVA_STDIO_CONVERT=N QIBM_PASE_DESCRIPTOR_STDIO=B QIBM_USE_DESCRIPTOR_STDIO=Y QIBM_MULTI_THREADED=Y ${useExec ? `exec ` : ``}` + mapepire.getInitCommand(javaPath);

      // ServerComponent.writeOutput(startingCommand);

      connection.client?.connection?.exec(startingCommand, {}, (err, stream) => {
        if (err) {
          reject(err);
          // ServerComponent.writeOutput(err);
        }
        mapepire.jobs.set(this.getUniqueId(), this);
        this.onClose = () => mapepire.jobs.delete(this.uniqueId);

        let outString = ``;

        // TODO: on is undefined?
        stream.stderr.on(`data`, (data: Buffer) => {
          console.log(data.toString("utf-8"));
        })

        stream.stdout.on(`data`, (data: Buffer) => {
          outString += data.toString("utf-8");
          if (outString.endsWith(`\n`)) {
            for (const thisMsg of outString.split(`\n`)) {
              if (thisMsg === ``) continue;

              outString = ``;
              // if (this.isTracingChannelData) ServerComponent.writeOutput(thisMsg);
              try {
                const response: ServerResponse = JSON.parse(thisMsg);
                this.responseEmitter.emit(response.id, response);
              } catch (e: any) {
                console.log(`Error: ` + e);
                console.log(`Data: ` + thisMsg);
                outString = ``;
              }
            }
          }
        });

        resolve(stream);
      });
    })
  }

  override async send<T>(content: ServerRequest): Promise<T> {
    if (!this.channel) {
      throw new Error("SQL client is not yet setup.");
    }
    if (this.isTracingChannelData) console.log(JSON.stringify(content));

    this.channel.stdin.write(JSON.stringify(content) + `\n`);
    return new Promise((resolve, reject) => {
      this.responseEmitter.on(content.id, (x: ServerResponse) => {
        this.responseEmitter.removeAllListeners(x.id);
        resolve(x as T);
      });
    });
  }

  getStatus(): JobStatus {
    const currentListenerCount = this.responseEmitter.eventNames().length;

    return this.channel && currentListenerCount > 0 ? JobStatus.BUSY : this.status as JobStatus;
  }

  /**
   * The same as mapepire-js#connect, but with SSH
   */
  async connectSsh(channel: ClientChannel): Promise<ConnectionResult> {
    // this.isTracingChannelData = true;

    this.channel = channel;

    this.channel.on(`error`, (err: any) => {
      console.warn(err);
      this.end();
    })

    this.channel.on(`close`, (code: number) => {
      console.warn(`Exited with code ${code}.`)
      this.end();
    })

    const props = (Object
      .keys(this.options) as { [key: string]: any })
      .filter((prop: keyof JDBCOptions) => this.options[prop] !== `` && this.options[prop] !== null && this.options[prop] !== undefined) // 0 is valid
      .map((prop: keyof JDBCOptions) => {
        if (Array.isArray(this.options[prop])) {
          return `${prop}=${(this.options[prop] as string[]).join(`,`)}`;
        } else {
          return `${prop}=${this.options[prop]}`;
        }
      })
      .join(`;`)

    const connectionObject = {
      id: sshSqlJob.getNewUniqueId(),
      type: `connect`,
      //technique: (getInstance().getConnection().qccsid === 65535 || this.options["database name"]) ? `tcp` : `cli`, //TODO: investigate why QCCSID 65535 breaks CLI and if there is any workaround
      technique: `tcp`, // TODO: DOVE does not work in cli mode
      application: sshSqlJob.application,
      props: props.length > 0 ? props : undefined
    }

    const connectResult = await this.send<ConnectionResult>(connectionObject);

    if (connectResult.success === true) {
      this.status = JobStatus.READY;
    } else {
      this.end();
      this.status = JobStatus.NOT_STARTED;
      throw new Error(connectResult.error || `Failed to connect to server.`);
    }

    this.id = connectResult.job;
    this.isTracingChannelData = false;

    return connectResult;
  }

  async close() {
    const exitObject: ServerRequest = {
      id: sshSqlJob.getNewUniqueId(),
      type: `exit`
    };

    this.send(exitObject);

    this.responseEmitter.eventNames().forEach(event => {
      this.responseEmitter.emit(event, JSON.stringify({
        id: event,
        success: false,
        error: `Job ended before response returned.`
      }));
    });

    this.end();
  }

  private end() {
    this.channel?.close();
    this.channel = undefined;
    this.status = JobStatus.ENDED;
    this.responseEmitter.removeAllListeners();
    this.onClose?.();
  }
}