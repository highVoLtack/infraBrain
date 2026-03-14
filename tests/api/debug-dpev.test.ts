import { describe, it, expect } from 'vitest';
import { enforceDPEVSequence } from '../../src/api/routes/debug.js';

describe('enforceDPEVSequence', () => {
  it('throws when starting diagnosis before discovery completes', () => {
    expect(() => enforceDPEVSequence('diagnosis', [])).toThrow(
      'DPEV VIOLATION: Cannot start "diagnosis" before "discovery" completes'
    );
  });

  it('throws when starting plan before diagnosis completes', () => {
    expect(() => enforceDPEVSequence('plan', ['discovery'])).toThrow(
      'DPEV VIOLATION: Cannot start "plan" before "diagnosis" completes'
    );
  });

  it('allows diagnosis after discovery is completed', () => {
    expect(() => enforceDPEVSequence('diagnosis', ['discovery'])).not.toThrow();
  });

  it('allows the full sequence in order', () => {
    expect(() => enforceDPEVSequence('discovery', [])).not.toThrow();
    expect(() => enforceDPEVSequence('diagnosis', ['discovery'])).not.toThrow();
    expect(() => enforceDPEVSequence('plan', ['discovery', 'diagnosis'])).not.toThrow();
    expect(() => enforceDPEVSequence('execution', ['discovery', 'diagnosis', 'plan'])).not.toThrow();
    expect(() => enforceDPEVSequence('verification', ['discovery', 'diagnosis', 'plan', 'execution'])).not.toThrow();
  });

  it('throws when skipping multiple phases', () => {
    expect(() => enforceDPEVSequence('plan', [])).toThrow(
      'DPEV VIOLATION: Cannot start "plan" before "discovery" completes'
    );
  });
});
