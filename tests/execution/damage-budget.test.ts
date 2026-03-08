import { describe, it, expect } from 'vitest';
import { DamageBudget } from '../../src/execution/damage-budget.js';

describe('DamageBudget', () => {
  describe('costFor', () => {
    it('returns 0 for read', () => {
      const budget = new DamageBudget(10);
      expect(budget.costFor('read')).toBe(0);
    });

    it('returns 1 for write', () => {
      const budget = new DamageBudget(10);
      expect(budget.costFor('write')).toBe(1);
    });

    it('returns 2 for destructive', () => {
      const budget = new DamageBudget(10);
      expect(budget.costFor('destructive')).toBe(2);
    });
  });

  describe('canAfford', () => {
    it('returns true when budget has room', () => {
      const budget = new DamageBudget(10);
      expect(budget.canAfford(1)).toBe(true);
      expect(budget.canAfford(10)).toBe(true);
    });

    it('returns false when budget is exhausted', () => {
      const budget = new DamageBudget(2);
      budget.deduct(2);
      expect(budget.canAfford(1)).toBe(false);
    });

    it('returns false when cost would exceed remaining', () => {
      const budget = new DamageBudget(5);
      budget.deduct(4);
      expect(budget.canAfford(2)).toBe(false);
      expect(budget.canAfford(1)).toBe(true);
    });
  });

  describe('deduct', () => {
    it('reduces remaining by the specified amount', () => {
      const budget = new DamageBudget(10);
      budget.deduct(3);
      expect(budget.remaining).toBe(7);
      expect(budget.spent).toBe(3);
    });
  });

  describe('deductFailedRetry', () => {
    it('deducts double for write (2 points)', () => {
      const budget = new DamageBudget(10);
      budget.deductFailedRetry('write');
      expect(budget.spent).toBe(2); // costFor('write')=1, doubled=2
    });

    it('deducts double for destructive (4 points)', () => {
      const budget = new DamageBudget(10);
      budget.deductFailedRetry('destructive');
      expect(budget.spent).toBe(4); // costFor('destructive')=2, doubled=4
    });

    it('deducts 0 for read (even doubled)', () => {
      const budget = new DamageBudget(10);
      budget.deductFailedRetry('read');
      expect(budget.spent).toBe(0); // costFor('read')=0, doubled=0
    });
  });

  describe('getters', () => {
    it('remaining returns limit minus used', () => {
      const budget = new DamageBudget(10);
      expect(budget.remaining).toBe(10);
      budget.deduct(3);
      expect(budget.remaining).toBe(7);
    });

    it('total returns the original limit', () => {
      const budget = new DamageBudget(10);
      budget.deduct(5);
      expect(budget.total).toBe(10);
    });

    it('spent returns total used', () => {
      const budget = new DamageBudget(10);
      expect(budget.spent).toBe(0);
      budget.deduct(4);
      expect(budget.spent).toBe(4);
    });
  });
});
