import { describe, it, expect } from 'vitest';
import { getConnection } from '../state';
import { getJavaHome } from '../../configuration/DebugConfiguration';

describe('Debug engine tests', () => {
  it('Check Java versions', async () => {
    const connection = getConnection();

    if (connection.remoteFeatures.jdk80) {
      const jdk8 = getJavaHome(connection, '8');
      expect(jdk8).toBe(connection.remoteFeatures.jdk80);
    }

    if (connection.remoteFeatures.jdk11) {
      const jdk11 = getJavaHome(connection, '11');
      expect(jdk11).toBe(connection.remoteFeatures.jdk11);
    }

    if (connection.remoteFeatures.jdk17) {
      const jdk17 = getJavaHome(connection, '17');
      expect(jdk17).toBe(connection.remoteFeatures.jdk17);
    }

    expect(getJavaHome(connection, '666')).toBeUndefined();
  });
});
