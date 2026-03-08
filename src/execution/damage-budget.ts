export class DamageBudget {
  private used = 0;
  private readonly limit: number;

  constructor(limit: number) {
    this.limit = limit;
  }

  costFor(risk: 'read' | 'write' | 'destructive'): number {
    switch (risk) {
      case 'read': return 0;
      case 'write': return 1;
      case 'destructive': return 2;
    }
  }

  canAfford(cost: number): boolean {
    return this.used + cost <= this.limit;
  }

  deduct(cost: number): void {
    this.used += cost;
  }

  deductFailedRetry(risk: 'read' | 'write' | 'destructive'): void {
    // Failed retries consume double (SAFE-06)
    this.used += this.costFor(risk) * 2;
  }

  get remaining(): number { return this.limit - this.used; }
  get total(): number { return this.limit; }
  get spent(): number { return this.used; }
}
