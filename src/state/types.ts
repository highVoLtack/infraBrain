export interface SessionState {
  sessionId: string;
  createdAt: string;
  updatedAt: string;
  status: 'active' | 'completed' | 'failed';
  currentPlan?: FixPlanState;
}

export interface FixPlanState {
  id: string;
  description: string;
  steps: FixStep[];
  currentStep: number;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
}

export interface FixStep {
  id: number;
  command: string;
  description: string;
  status: 'pending' | 'approved' | 'rejected' | 'executed' | 'failed';
  riskLevel?: string;
}
