import { describe, it, expect } from 'vitest';
import { CloudSync } from '../lib/sync';

describe('CloudSync Service', () => {
  it('gracefully exits when cloud sync is disabled or keys are missing', async () => {
    // Should resolve cleanly without throwing when config is unpopulated
    await expect(CloudSync.sync()).resolves.toBeUndefined();
  });
});
