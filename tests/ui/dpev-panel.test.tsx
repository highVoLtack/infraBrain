/**
 * Tests for useDPEV reducer (pure function) and DPEVPanel component
 *
 * Task 1: Reducer tests (pure function, no React context needed)
 * Task 2: DPEVPanel integration tests (added later)
 */

import { describe, it, expect } from 'vitest';
import { dpevReducer } from '../../src/ui/hooks/useDPEV.js';
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
