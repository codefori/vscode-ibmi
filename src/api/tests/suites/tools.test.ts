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