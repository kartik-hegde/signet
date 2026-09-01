export interface AgentOperation {
  id: string;
  operationId: string;
  userId: string;
  fingerprint: string;
  transactionId: string;
  createdAt: Date;
}
