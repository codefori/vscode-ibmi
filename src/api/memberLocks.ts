import IBMi, { MemberParts } from "./IBMi";

export enum LockState {
  SHARED_READ = `*SHRRD`, 
  SHARED_UPDATE = `*SHRUPD`,
  SHARED_NO_UPDATE = `*SHRNUP`,
  EXCLUSIVE_ALLOW_READ = `*EXCLRD`,
  EXCLUSIVE_NO_READ = `*EXCL`
}

export class MemberLocks {
  private readonly lockedMembers: Map<string, MemberParts> = new Map();

  private memberKey(memberParts: MemberParts): string {
    return `${memberParts.library}/${memberParts.file}/${memberParts.name}`;
  }

  isLocked(memberParts: MemberParts): boolean {
    return this.lockedMembers.has(this.memberKey(memberParts));
  }

  /**
   * Allocates an exclusive lock on a member using ALCOBJ.
   * @returns `true` if the lock was successfully acquired, `false` otherwise.
   */
  async allocate(connection: IBMi, memberParts: MemberParts): Promise<boolean> {
    const result = await connection.runCommand({
      command: `QSYS/ALCOBJ OBJ((${memberParts.library}/${memberParts.file} *FILE ${LockState.SHARED_UPDATE} ${memberParts.name})) SCOPE(*JOB)`,
      noLibList: true
    });

    if (result.code === 0) {
      this.lockedMembers.set(this.memberKey(memberParts), memberParts);
      return true;
    }

    return false;
  }

  /**
   * Deallocates an exclusive lock on a member using DLCOBJ.
   * @returns `true` if the lock was successfully released, `false` otherwise.
   */
  async deallocate(connection: IBMi, memberParts: MemberParts): Promise<boolean> {
    const result = await connection.runCommand({
      command: `QSYS/DLCOBJ OBJ((${memberParts.library}/${memberParts.file} *FILE ${LockState.SHARED_UPDATE} ${memberParts.name})) SCOPE(*JOB)`,
      noLibList: true
    });

    if (result.code === 0) {
      this.lockedMembers.delete(this.memberKey(memberParts));
      return true;
    }

    return false;
  }

  /**
   * Deallocates all currently held locks.
   */
  async deallocateAll(connection: IBMi | undefined): Promise<void> {
    const members = [...this.lockedMembers.values()];
    this.lockedMembers.clear();
    if (connection) {
      await Promise.all(members.map(memberParts =>
        connection.runCommand({
          command: `QSYS/DLCOBJ OBJ((${memberParts.library}/${memberParts.file} *FILE ${LockState.SHARED_UPDATE} ${memberParts.name})) SCOPE(*JOB)`,
          noLibList: true
        }).catch(() => { })
      ));
    }
  }
}
