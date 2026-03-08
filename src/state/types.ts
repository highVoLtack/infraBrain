export interface ResumeMetadata {
  lastCompletedStep: number;
  stoppedAt: string;
  error?: string;
  target?: string;
}

export interface SessionState {
  sessionId: string;
  createdAt: string;
  updatedAt: string;
  status: 'active' | 'completed' | 'failed';
  target?: string;
  currentPlan?: FixPlanState;
  resumeMetadata?: ResumeMetadata;
}

export interface FixPlanState {
  id: string;
  description: string;
  steps: FixStep[];
  currentStep: number;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  stoppedAtStep?: number;
  failureReason?: string;
}

export interface FixStep {
  id: number;
  command: string;
  description: string;
  status: 'pending' | 'approved' | 'rejected' | 'executed' | 'failed';
  riskLevel?: string;
}
