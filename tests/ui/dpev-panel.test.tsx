/**
 * Tests for useDPEV reducer (pure function) and DPEVPanel component
 *
 * Task 1: Reducer tests (pure function, no React context needed)
 * Task 2: DPEVPanel integration tests (added later)
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { dpevReducer } from '../../src/ui/hooks/useDPEV.js';
import { DPEVPanel, shouldShowCacheHitBanner, getApprovalType } from '../../src/ui/panels/DPEVPanel.js';
import type { DPEVState } from '../../src/ui/types.js';

function makeInitialState(overrides?: Partial<DPEVState>): DPEVState {
  return {
    sessionId: '',
    phases: [],
    activePhaseIndex: -1,
    executionSteps: [],
    status: 'idle',
    ...overrides,
  };
}

describe('dpevReducer', () => {
  describe('PHASE_START', () => {
    it('adds a new phase to phases array and sets activePhaseIndex', () => {
      const state = makeInitialState();
      const next = dpevReducer(state, {
        type: 'PHASE_START',
        phase: 'discovery',
        model: 'qwen3-0.6b',
      });
      expect(next.phases).toHaveLength(1);
      expect(next.phases[0].name).toBe('discovery');
      expect(next.phases[0].model).toBe('qwen3-0.6b');
      expect(next.phases[0].status).toBe('active');
      expect(next.phases[0].tokens).toBe('');
      expect(next.phases[0].startedAt).toBeGreaterThan(0);
      expect(next.activePhaseIndex).toBe(0);
      expect(next.status).toBe('streaming');
    });

    it('adds second phase and updates activePhaseIndex', () => {
      const state = makeInitialState({
        phases: [{
          name: 'discovery',
          model: 'qwen3-0.6b',
          startedAt: 1000,
          status: 'complete',
          completedAt: 2000,
          tokens: 'found 3 containers',
        }],
        activePhaseIndex: 0,
        status: 'streaming',
      });
      const next = dpevReducer(state, {
        type: 'PHASE_START',
        phase: 'diagnosis',
        model: 'qwen3-32b',
      });
      expect(next.phases).toHaveLength(2);
      expect(next.phases[1].name).toBe('diagnosis');
      expect(next.activePhaseIndex).toBe(1);
    });
  });

  describe('TOKEN', () => {
    it('appends text to active phase tokens', () => {
      const state = makeInitialState({
        phases: [{
          name: 'diagnosis',
          model: 'qwen3-32b',
          startedAt: 1000,
          status: 'active',
          tokens: 'Analyzing ',
        }],
        activePhaseIndex: 0,
        status: 'streaming',
      });
      const next = dpevReducer(state, { type: 'TOKEN', text: 'container logs...' });
      expect(next.phases[0].tokens).toBe('Analyzing container logs...');
    });

    it('is a no-op when no active phase exists', () => {
      const state = makeInitialState();
      const next = dpevReducer(state, { type: 'TOKEN', text: 'orphan token' });
      expect(next).toEqual(state);
    });
  });

  describe('PHASE_COMPLETE', () => {
    it('marks phase complete with timestamp', () => {
      const state = makeInitialState({
        phases: [{
          name: 'discovery',
          model: 'qwen3-0.6b',
          startedAt: 1000,
          status: 'active',
          tokens: 'found 3 containers',
        }],
        activePhaseIndex: 0,
        status: 'streaming',
      });
      const next = dpevReducer(state, { type: 'PHASE_COMPLETE', phase: 'discovery' });
      expect(next.phases[0].status).toBe('complete');
      expect(next.phases[0].completedAt).toBeGreaterThan(0);
    });

    it('no-ops when phase name not found', () => {
      const state = makeInitialState({
        phases: [{
          name: 'discovery',
          model: 'qwen3-0.6b',
          startedAt: 1000,
          status: 'active',
          tokens: '',
        }],
        activePhaseIndex: 0,
        status: 'streaming',
      });
      const next = dpevReducer(state, { type: 'PHASE_COMPLETE', phase: 'nonexistent' });
      expect(next.phases[0].status).toBe('active');
    });
  });

  describe('CACHE_HIT', () => {
    it('sets cacheHit provenance and awaiting-approval status', () => {
      const state = makeInitialState({ status: 'streaming' });
      const provenance = {
        similarity: 0.92,
        confidence: 0.88,
        sourceSessionId: 'sess-abc123',
        sourceDate: '2026-04-10',
        skillName: 'docker-compose',
      };
      const next = dpevReducer(state, { type: 'CACHE_HIT', provenance });
      expect(next.cacheHit).toEqual(provenance);
      expect(next.status).toBe('awaiting-approval');
    });
  });

  describe('PLAN_READY', () => {
    it('sets fixPlan', () => {
      const state = makeInitialState({ status: 'streaming' });
      const fixPlan = { steps: [{ command: 'docker restart nginx', risk: 'write' }] };
      const next = dpevReducer(state, { type: 'PLAN_READY', fixPlan });
      expect(next.fixPlan).toEqual(fixPlan);
    });
  });

  describe('STEP_UPDATE', () => {
    it('adds a new step to executionSteps', () => {
      const state = makeInitialState({ status: 'streaming' });
      const next = dpevReducer(state, {
        type: 'STEP_UPDATE',
        stepIndex: 0,
        status: 'running',
      });
      expect(next.executionSteps).toHaveLength(1);
      expect(next.executionSteps[0].stepIndex).toBe(0);
      expect(next.executionSteps[0].status).toBe('running');
      expect(next.status).toBe('executing');
    });

    it('updates existing step at given index', () => {
      const state = makeInitialState({
        status: 'executing',
        executionSteps: [{
          stepIndex: 0,
          total: 2,
          command: 'docker restart nginx',
          risk: 'write',
          status: 'running',
        }],
      });
      const next = dpevReducer(state, {
        type: 'STEP_UPDATE',
        stepIndex: 0,
        status: 'success',
        stdout: 'nginx restarted',
      });
      expect(next.executionSteps[0].status).toBe('success');
      expect(next.executionSteps[0].stdout).toBe('nginx restarted');
    });
  });

  describe('APPROVAL_REQUIRED', () => {
    it('sets pendingApproval and awaiting-approval status', () => {
      const state = makeInitialState({ status: 'executing' });
      const next = dpevReducer(state, {
        type: 'APPROVAL_REQUIRED',
        command: 'docker rm nginx',
        riskLevel: 'destructive',
        target: 'nginx',
        stepIndex: 1,
      });
      expect(next.pendingApproval).toEqual({
        command: 'docker rm nginx',
        riskLevel: 'destructive',
        target: 'nginx',
        stepIndex: 1,
      });
      expect(next.status).toBe('awaiting-approval');
    });
  });

  describe('APPROVAL_RESPONSE', () => {
    it('clears pendingApproval and resumes executing status', () => {
      const state = makeInitialState({
        status: 'awaiting-approval',
        pendingApproval: {
          command: 'docker rm nginx',
          riskLevel: 'destructive',
          target: 'nginx',
          stepIndex: 1,
        },
        executionSteps: [{
          stepIndex: 0,
          total: 2,
          command: 'docker restart nginx',
          risk: 'write',
          status: 'success',
        }],
      });
      const next = dpevReducer(state, { type: 'APPROVAL_RESPONSE', approved: true });
      expect(next.pendingApproval).toBeUndefined();
      expect(next.status).toBe('executing');
    });

    it('resumes to streaming when no execution steps exist', () => {
      const state = makeInitialState({
        status: 'awaiting-approval',
        cacheHit: {
          similarity: 0.92,
          confidence: 0.88,
          sourceSessionId: 'sess-abc',
          sourceDate: '2026-04-10',
          skillName: 'docker-compose',
        },
      });
      const next = dpevReducer(state, { type: 'APPROVAL_RESPONSE', approved: false });
      expect(next.pendingApproval).toBeUndefined();
      expect(next.status).toBe('streaming');
    });
  });

  describe('COMPLETE', () => {
    it('sets status to complete and stores sessionId', () => {
      const state = makeInitialState({ status: 'executing' });
      const next = dpevReducer(state, { type: 'COMPLETE', sessionId: 'sess-final', status: 'fixed' });
      expect(next.status).toBe('complete');
      expect(next.sessionId).toBe('sess-final');
    });
  });

  describe('ERROR', () => {
    it('sets status to error', () => {
      const state = makeInitialState({ status: 'streaming' });
      const next = dpevReducer(state, { type: 'ERROR', message: 'LLM timeout' });
      expect(next.status).toBe('error');
    });
  });
});

// ---- Pure function tests for DPEVPanel helpers ----

describe('shouldShowCacheHitBanner', () => {
  it('returns true when cacheHit is set, status is awaiting-approval, and no pendingApproval', () => {
    const state = makeInitialState({
      status: 'awaiting-approval',
      cacheHit: {
        similarity: 0.92,
        confidence: 0.88,
        sourceSessionId: 'sess-abc',
        sourceDate: '2026-04-10',
        skillName: 'docker-compose',
      },
    });
    expect(shouldShowCacheHitBanner(state)).toBe(true);
  });

  it('returns false when pendingApproval is set (execution approval, not cache)', () => {
    const state = makeInitialState({
      status: 'awaiting-approval',
      cacheHit: {
        similarity: 0.92,
        confidence: 0.88,
        sourceSessionId: 'sess-abc',
        sourceDate: '2026-04-10',
        skillName: 'docker-compose',
      },
      pendingApproval: {
        command: 'docker rm nginx',
        riskLevel: 'destructive',
        target: 'nginx',
        stepIndex: 0,
      },
    });
    expect(shouldShowCacheHitBanner(state)).toBe(false);
  });

  it('returns false when status is not awaiting-approval', () => {
    const state = makeInitialState({
      status: 'streaming',
      cacheHit: {
        similarity: 0.92,
        confidence: 0.88,
        sourceSessionId: 'sess-abc',
        sourceDate: '2026-04-10',
        skillName: 'docker-compose',
      },
    });
    expect(shouldShowCacheHitBanner(state)).toBe(false);
  });
});

describe('getApprovalType', () => {
  it('returns destructive for destructive riskLevel', () => {
    expect(getApprovalType('destructive')).toBe('destructive');
  });

  it('returns write for write riskLevel', () => {
    expect(getApprovalType('write')).toBe('write');
  });

  it('returns write for any non-destructive riskLevel', () => {
    expect(getApprovalType('read')).toBe('write');
  });
});

// ---- DPEVPanel integration tests ----

describe('DPEVPanel', () => {
  it('renders idle state with "No active session" message', () => {
    const { lastFrame } = render(
      React.createElement(DPEVPanel, { apiBaseUrl: 'http://localhost:3000' })
    );
    expect(lastFrame()).toContain('No active session');
  });

  it('renders replay session with completed phases (accordion collapsed)', () => {
    const replaySession: DPEVState = {
      sessionId: 'sess-replay-123',
      phases: [
        {
          name: 'discovery',
          model: 'qwen3-0.6b',
          startedAt: 1000,
          completedAt: 2200,
          status: 'complete',
          tokens: 'Found 3 containers: nginx, postgres, redis',
        },
        {
          name: 'diagnosis',
          model: 'qwen3-32b',
          startedAt: 2200,
          completedAt: 5000,
          status: 'complete',
          tokens: 'Root cause: nginx config has upstream timeout too low',
        },
      ],
      activePhaseIndex: 1,
      executionSteps: [],
      status: 'complete',
    };

    const { lastFrame } = render(
      React.createElement(DPEVPanel, {
        apiBaseUrl: 'http://localhost:3000',
        replaySession,
      })
    );

    const frame = lastFrame();
    // Both phase headers should be visible (collapsed -- header only, no streaming text)
    expect(frame).toContain('DISCOVERY');
    expect(frame).toContain('DIAGNOSIS');
    // Completed phases should NOT show their streaming text (collapsed accordion)
    // The StreamingText component only renders for 'active' phases
    expect(frame).not.toContain('Found 3 containers');
    expect(frame).not.toContain('Root cause: nginx config');
    // Completion footer
    expect(frame).toContain('Session complete');
  });

  it('renders replay session with execution steps', () => {
    const replaySession: DPEVState = {
      sessionId: 'sess-exec-123',
      phases: [
        {
          name: 'discovery',
          model: 'qwen3-0.6b',
          startedAt: 1000,
          completedAt: 2000,
          status: 'complete',
          tokens: 'Found nginx',
        },
      ],
      activePhaseIndex: 0,
      executionSteps: [
        {
          stepIndex: 0,
          total: 2,
          command: 'docker restart nginx',
          risk: 'write',
          status: 'success',
        },
        {
          stepIndex: 1,
          total: 2,
          command: 'docker rm old-container',
          risk: 'destructive',
          status: 'failed',
          stderr: 'container not found',
        },
      ],
      status: 'complete',
    };

    const { lastFrame } = render(
      React.createElement(DPEVPanel, {
        apiBaseUrl: 'http://localhost:3000',
        replaySession,
      })
    );

    const frame = lastFrame();
    expect(frame).toContain('Execution');
    expect(frame).toContain('docker restart nginx');
    expect(frame).toContain('docker rm old-container');
  });

  it('renders replay session with active streaming phase expanded', () => {
    const replaySession: DPEVState = {
      sessionId: 'sess-active-123',
      phases: [
        {
          name: 'discovery',
          model: 'qwen3-0.6b',
          startedAt: 1000,
          completedAt: 2000,
          status: 'complete',
          tokens: 'Found 3 containers',
        },
        {
          name: 'diagnosis',
          model: 'qwen3-32b',
          startedAt: 2000,
          status: 'active',
          tokens: 'Analyzing container logs for root cause...',
        },
      ],
      activePhaseIndex: 1,
      executionSteps: [],
      status: 'streaming',
    };

    const { lastFrame } = render(
      React.createElement(DPEVPanel, {
        apiBaseUrl: 'http://localhost:3000',
        replaySession,
      })
    );

    const frame = lastFrame();
    // Completed phase: header visible, text NOT visible (collapsed)
    expect(frame).toContain('DISCOVERY');
    expect(frame).not.toContain('Found 3 containers');
    // Active phase: header AND streaming text visible (expanded)
    expect(frame).toContain('DIAGNOSIS');
    expect(frame).toContain('Analyzing container logs for root cause...');
  });

  it('renders error footer when status is error', () => {
    const replaySession: DPEVState = {
      sessionId: '',
      phases: [
        {
          name: 'discovery',
          model: 'qwen3-0.6b',
          startedAt: 1000,
          status: 'error',
          tokens: '',
        },
      ],
      activePhaseIndex: 0,
      executionSteps: [],
      status: 'error',
    };

    const { lastFrame } = render(
      React.createElement(DPEVPanel, {
        apiBaseUrl: 'http://localhost:3000',
        replaySession,
      })
    );

    expect(lastFrame()).toContain('Error occurred');
  });
});
