import { describe, expect, it } from 'vitest';
import { Tools } from '../../Tools';

describe('Tools.ensureFullPath tests', { concurrent: true }, () => {
  describe('Tilde expansion', () => {
    it('should expand ~ with home directory when provided', () => {
      const result = Tools.ensureFullPath('~/myfile.txt', '/home/user');
      expect(result).toBe('/home/user/myfile.txt');
    });

    it('should expand ~ at start of path with home directory', () => {
      const result = Tools.ensureFullPath('~', '/home/user');
      expect(result).toBe('/home/user');
    });

    it('should expand ~/subdir/file with home directory', () => {
      const result = Tools.ensureFullPath('~/projects/code/file.txt', '/home/developer');
      expect(result).toBe('/home/developer/projects/code/file.txt');
    });

    it('should treat ~ as relative when no home directory provided', () => {
      const result = Tools.ensureFullPath('~/myfile.txt', undefined);
      expect(result).toBe('myfile.txt');
    });

    it('should handle ~/ as relative when no home directory provided', () => {
      const result = Tools.ensureFullPath('~/', undefined);
      expect(result).toBe('');
    });

    it('should handle ~/path as relative when no home directory provided', () => {
      const result = Tools.ensureFullPath('~/some/path', undefined);
      expect(result).toBe('some/path');
    });
  });

  describe('Absolute paths', () => {
    it('should return absolute path unchanged', () => {
      const result = Tools.ensureFullPath('/absolute/path/file.txt', '/home/user');
      expect(result).toBe('/absolute/path/file.txt');
    });

    it('should return absolute path unchanged even without home directory', () => {
      const result = Tools.ensureFullPath('/absolute/path/file.txt', undefined);
      expect(result).toBe('/absolute/path/file.txt');
    });

    it('should handle root path', () => {
      const result = Tools.ensureFullPath('/', '/home/user');
      expect(result).toBe('/');
    });

    it('should handle absolute path with special characters', () => {
      const result = Tools.ensureFullPath('/path/with spaces/and$special#chars', '/home/user');
      expect(result).toBe('/path/with spaces/and$special#chars');
    });
  });

  describe('Relative paths', () => {
    it('should prepend home directory to relative path', () => {
      const result = Tools.ensureFullPath('relative/path/file.txt', '/home/user');
      expect(result).toBe('/home/user/relative/path/file.txt');
    });

    it('should handle single file name as relative', () => {
      const result = Tools.ensureFullPath('file.txt', '/home/user');
      expect(result).toBe('/home/user/file.txt');
    });

    it('should handle relative path with ./', () => {
      const result = Tools.ensureFullPath('./file.txt', '/home/user');
      expect(result).toBe('/home/user/file.txt');
    });

    it('should handle relative path with ../', () => {
      const result = Tools.ensureFullPath('../file.txt', '/home/user');
      expect(result).toBe('/home/file.txt');
    });

    it('should return relative path unchanged when no home directory', () => {
      const result = Tools.ensureFullPath('relative/path/file.txt', undefined);
      expect(result).toBe('relative/path/file.txt');
    });

    it('should handle empty string with home directory', () => {
      const result = Tools.ensureFullPath('', '/home/user');
      expect(result).toBe('/home/user');
    });

    it('should handle empty string without home directory', () => {
      const result = Tools.ensureFullPath('', undefined);
      expect(result).toBe('');
    });
  });

  describe('Edge cases', () => {
    it('should handle home directory with trailing slash', () => {
      const result = Tools.ensureFullPath('myfile.txt', '/home/user/');
      expect(result).toBe('/home/user/myfile.txt');
    });

    it('should handle home directory without trailing slash', () => {
      const result = Tools.ensureFullPath('myfile.txt', '/home/user');
      expect(result).toBe('/home/user/myfile.txt');
    });

    it('should handle multiple slashes in path', () => {
      const result = Tools.ensureFullPath('path//with///multiple////slashes', '/home/user');
      expect(result).toBe('/home/user/path/with/multiple/slashes');
    });

    it('should handle path with only slashes', () => {
      const result = Tools.ensureFullPath('///', '/home/user');
      expect(result).toBe('///');
    });

    it('should handle tilde in middle of path (not expanded)', () => {
      const result = Tools.ensureFullPath('/path/to/~something', '/home/user');
      expect(result).toBe('/path/to/~something');
    });

    it('should handle relative path starting with tilde but not ~/', () => {
      // Filenames can start with ~ - they should be treated as literal filenames
      const result = Tools.ensureFullPath('~file.txt', '/home/user');
      expect(result).toBe('/home/user/~file.txt');
    });

    it('should handle IFS paths with QSYS.LIB', () => {
      const result = Tools.ensureFullPath('/QSYS.LIB/MYLIB.LIB/MYFILE.FILE', '/home/user');
      expect(result).toBe('/QSYS.LIB/MYLIB.LIB/MYFILE.FILE');
    });

    it('should handle paths with variant characters', () => {
      const result = Tools.ensureFullPath('path/with/$dollar/and/#hash', '/home/user');
      expect(result).toBe('/home/user/path/with/$dollar/and/#hash');
    });
  });
});

describe('Tools.parseLsPermissions tests', { concurrent: true }, () => {
  describe('Basic rwx triplets', () => {
    it('should parse the expected home directory mode 750', () => {
      expect(Tools.parseLsPermissions('drwxr-x--- 2 me grp 4096 Jun 8 /home/me')).toBe('750');
    });

    it('should parse the expected .vscode mode 700', () => {
      expect(Tools.parseLsPermissions('drwx------ 2 me grp 4096 Jun 8 /home/me/.vscode')).toBe('700');
    });

    it('should parse a regular file with 644', () => {
      expect(Tools.parseLsPermissions('-rw-r--r-- 1 me grp 12 Jun 8 file.txt')).toBe('644');
    });

    it('should parse all permissions set (777)', () => {
      expect(Tools.parseLsPermissions('drwxrwxrwx 2 me grp 4096 Jun 8 /tmp')).toBe('777');
    });

    it('should parse no permissions set (000)', () => {
      expect(Tools.parseLsPermissions('---------- 1 me grp 0 Jun 8 locked')).toBe('000');
    });
  });

  describe('File type characters (ignored, must still match)', () => {
    it('should accept a symlink listing (l)', () => {
      // ls -ld without -L reports the link itself
      expect(Tools.parseLsPermissions('lrwxrwxrwx 1 me grp 20 Jun 8 home -> /ASP/home/me')).toBe('777');
    });

    it('should accept a block device (b)', () => {
      expect(Tools.parseLsPermissions('brw-rw---- 1 root disk 8, 0 Jun 8 sda')).toBe('660');
    });

    it('should accept a character device (c)', () => {
      expect(Tools.parseLsPermissions('crw-rw-rw- 1 root tty 1, 3 Jun 8 null')).toBe('666');
    });

    it('should accept a named pipe (p)', () => {
      expect(Tools.parseLsPermissions('prw-r--r-- 1 me grp 0 Jun 8 fifo')).toBe('644');
    });

    it('should accept a socket (s)', () => {
      expect(Tools.parseLsPermissions('srwxr-xr-x 1 me grp 0 Jun 8 sock')).toBe('755');
    });
  });

  describe('Special bits (setuid / setgid / sticky)', () => {
    it('should treat lowercase s (setuid + execute) as execute present', () => {
      expect(Tools.parseLsPermissions('-rwsr-xr-x 1 root grp 0 Jun 8 prog')).toBe('755');
    });

    it('should treat uppercase S (setuid without execute) as no execute', () => {
      expect(Tools.parseLsPermissions('-rwSr--r-- 1 root grp 0 Jun 8 prog')).toBe('644');
    });

    it('should treat lowercase s in the group slot (setgid + execute) as execute present', () => {
      expect(Tools.parseLsPermissions('drwxr-sr-x 2 me grp 4096 Jun 8 shared')).toBe('755');
    });

    it('should treat uppercase S in the group slot (setgid without execute) as no execute', () => {
      expect(Tools.parseLsPermissions('drwxr-Sr-x 2 me grp 4096 Jun 8 shared')).toBe('745');
    });

    it('should treat lowercase t (sticky + execute) as execute present', () => {
      expect(Tools.parseLsPermissions('drwxrwxrwt 2 root grp 4096 Jun 8 tmp')).toBe('777');
    });

    it('should treat uppercase T (sticky without execute) as no execute', () => {
      expect(Tools.parseLsPermissions('drwxrwxrwT 2 root grp 4096 Jun 8 tmp')).toBe('776');
    });
  });

  describe('Trailing content and whitespace', () => {
    it('should ignore a trailing ACL marker (+)', () => {
      expect(Tools.parseLsPermissions('drwxr-x---+ 2 me grp 4096 Jun 8 /home/me')).toBe('750');
    });

    it('should ignore a trailing SELinux/alternate-access marker (.)', () => {
      expect(Tools.parseLsPermissions('drwxr-x---. 2 me grp 4096 Jun 8 /home/me')).toBe('750');
    });

    it('should tolerate leading and trailing whitespace', () => {
      expect(Tools.parseLsPermissions('   drwxr-x--- 2 me grp 4096 Jun 8 /home/me  \n')).toBe('750');
    });

    it('should parse a bare mode field with nothing after it', () => {
      expect(Tools.parseLsPermissions('drwxr-x---')).toBe('750');
    });
  });

  describe('Unparseable input returns undefined', () => {
    it('should return undefined for empty output', () => {
      expect(Tools.parseLsPermissions('')).toBeUndefined();
    });

    it('should return undefined for whitespace-only output', () => {
      expect(Tools.parseLsPermissions('   \n  ')).toBeUndefined();
    });

    it('should return undefined for an ls error message', () => {
      expect(Tools.parseLsPermissions('ls: cannot access /home/me: No such file or directory')).toBeUndefined();
    });

    it('should return undefined for banner/noise that is not a mode field', () => {
      expect(Tools.parseLsPermissions('total 8')).toBeUndefined();
    });

    it('should return undefined for an invalid file type character', () => {
      expect(Tools.parseLsPermissions('xrwxr-x--- 2 me grp 4096 Jun 8 weird')).toBeUndefined();
    });

    it('should return undefined for a truncated mode field', () => {
      expect(Tools.parseLsPermissions('drwxr-x-')).toBeUndefined();
    });

    it('should return undefined for an invalid character in a permission slot', () => {
      expect(Tools.parseLsPermissions('drwxr-zr-x 2 me grp 4096 Jun 8 weird')).toBeUndefined();
    });
  });
});