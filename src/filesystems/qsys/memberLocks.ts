import { ExtensionContext, Uri, workspace } from "vscode";
import IBMi, { MemberParts } from "../../api/IBMi";
import { instance } from "../../instantiate";
import { onCodeForIBMiConfigurationChange } from "../../config/Configuration";
import { parseFSOptions } from "./QSysFs";

export enum LockState {
  SHARED_READ = `*SHRRD`,
  SHARED_UPDATE = `*SHRUPD`,
  SHARED_NO_UPDATE = `*SHRNUP`,
  EXCLUSIVE_ALLOW_READ = `*EXCLRD`,
  EXCLUSIVE_NO_READ = `*EXCL`
}

export class MemberLocks {
  private static readonly locks: Map<string, string> = new Map(); // Member -> Deallocate lock command
  private static readonly acquiring: Map<string, Promise<void>> = new Map(); // Member -> Allocate lock promise

  initialize(context: ExtensionContext) {
    instance.subscribe(
      context,
      'connected',
      `Lock open members`,
      () => {
        this.lockOpenMembers();
      });

    instance.subscribe(
      context,
      'disconnected',
      `Release all locks`,
      () => {
        this.deallocateAll(undefined);
      });

    context.subscriptions.push(
      workspace.onDidCloseTextDocument(doc => {
        if (doc.uri.scheme !== `member`) {
          return;
        }

        const connection = instance.getConnection();
        if (!connection) {
          return;
        }

        const config = connection.getConfig();
        if (!config.lockMembers) {
          return;
        }

        try {
          this.deallocate(connection, doc.uri);
        } catch { }
      }),


      onCodeForIBMiConfigurationChange("connectionSettings", () => {
        const connection = instance.getConnection();
        const config = connection?.getConfig();

        if (config?.lockMembers) {
          this.lockOpenMembers();
        } else {
          this.deallocateAll(connection);
        }
      })
    );
  }

  private async lockOpenMembers(): Promise<void> {
    const connection = instance.getConnection();
    if (!connection) {
      return;
    }

    const config = connection.getConfig();
    if (!config.lockMembers) {
      return;
    }

    const openMemberTextDocuments = workspace.textDocuments
      .filter(doc => doc.uri.scheme === `member` && !doc.isClosed);

    for (const doc of openMemberTextDocuments) {
      try {
        await this.allocate(connection, doc.uri);
      } catch { }
    }
  }

  private memberKey(memberParts: MemberParts, lockState: string): string {
    return `${memberParts.library}/${memberParts.file}/${memberParts.name}:${lockState}`;
  }

  /**
   * Allocates an exclusive lock on a member using ALCOBJ.
   * @returns `true` if the lock was successfully acquired, `false` otherwise.
   */
  async allocate(connection: IBMi, uri: Uri): Promise<void> {
    const memberParts = connection.parserMemberPath(uri.path);
    const fsOptions = parseFSOptions(uri);
    const lockState = fsOptions.readonly ? LockState.SHARED_READ : LockState.EXCLUSIVE_ALLOW_READ;

    // Check if there is an existing lock
    const memberKey = this.memberKey(memberParts, lockState);
    if (MemberLocks.locks.get(memberKey)) {
      return;
    }

    // Check if there is a lock still being acquired
    const existingLock = MemberLocks.acquiring.get(memberKey);
    if (existingLock) {
      return existingLock;
    }

    try {
      const allocatePromise = connection.runCommand({
        command: `QSYS/ALCOBJ OBJ((${memberParts.library}/${memberParts.file} *FILE ${lockState} ${memberParts.name})) SCOPE(*JOB) WAIT(0)`,
        noLibList: true
      }).then(result => {
        if (result.code === 0) {
          const deallocateCommand = `QSYS/DLCOBJ OBJ((${memberParts.library}/${memberParts.file} *FILE lockState ${memberParts.name})) SCOPE(*JOB)`;
          MemberLocks.locks.set(memberKey, deallocateCommand);
          return;
        } else {
          throw new Error(result.stderr);
        }
      });

      // try {
      //   await connection.runSQL(`@QSYS/ALCOBJ OBJ((${memberParts.library}/${memberParts.file} *FILE ${lockState} ${memberParts.name})) SCOPE(*JOB)`);
      //   const deallocateCommand = `QSYS/DLCOBJ OBJ((${memberParts.library}/${memberParts.file} *FILE lockState ${memberParts.name})) SCOPE(*JOB)`;
      //   MemberLocks.locks.set(memberKey, deallocateCommand);
      // } catch (e) {
      //   console.log(e);
      // }

      MemberLocks.acquiring.set(memberKey, allocatePromise);

      return await allocatePromise;
    } finally {
      MemberLocks.acquiring.delete(memberKey);
    }
  }

  /**
   * Deallocates an exclusive lock on a member using DLCOBJ.
   * @returns `true` if the lock was successfully released, `false` otherwise.
   */
  async deallocate(connection: IBMi, uri: Uri): Promise<void> {
    const memberParts = connection.parserMemberPath(uri.path);
    const fsOptions = parseFSOptions(uri);
    const lockState = fsOptions.readonly ? LockState.SHARED_READ : LockState.EXCLUSIVE_ALLOW_READ;

    // Check if there is an existing lock
    const memberKey = this.memberKey(memberParts, lockState);
    const deallocateCommand = MemberLocks.locks.get(memberKey);
    if (!deallocateCommand) {
      return;
    }

    const result = await connection.runCommand({
      command: deallocateCommand,
      noLibList: true
    });

    if (result.code === 0) {
      MemberLocks.locks.delete(memberKey);
    }
  }

  /**
   * Deallocates all currently held locks.
   */
  async deallocateAll(connection: IBMi | undefined): Promise<void> {
    const deallocateCommands = [...MemberLocks.locks.values()];
    MemberLocks.locks.clear();
    if (connection) {
      await Promise.all(deallocateCommands.map(deallocateCommand =>
        connection.runCommand({
          command: deallocateCommand,
          noLibList: true
        }).catch(() => { })
      ));
    }
  }
}
