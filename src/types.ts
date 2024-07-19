export type RaftNodeId = string | number;

export type RaftNode = {
  id: RaftNodeId;
  time?: number;
};

export enum RaftRole {
  CANDIDATE = 1,
  FOLLOWER = 2,
  LEADER = 3,
}
export type RaftqOptions = {
  persistAgent: RaftPersistAgent;
  heartbeat: number;
  minimumElectionTime: number;
  maximumElectionTime: number;
};
export type RaftVoteRequestBody = {
  destination: RaftNode;
  timeout: number;
  //
  candidate: RaftNode;
  term: number;
};
export type RaftVoteResponseBody = {
  destination: RaftNode;
  timeout: number;
  //
  voter: RaftNode;
  term: number;
  granted: boolean;
};

export type RaftServiceStartedBody = {
  node: RaftNode;
};

export type RaftServerCrashedBody = {
  reason: any;
};

export type RaftUpdateDataBody = {
  node: RaftNode;
  time: number;
};

export type RaftDataBody = {
  destination: RaftNode;
  timeout: number;
  //
  node: RaftNode;
  term: number;
  data: any;
};

export type RaftDataResponseBody = {
  destination: RaftNode;
  timeout: number;
  //
  node: RaftNode;
  term: number;
  success: boolean;
};

export type RaftLogBody = {
  message: string;
};

export type RaftEventType =
  | 'serviceStarted'
  | 'serviceCrashed'
  | 'replicateData'
  //
  | 'syncData'
  | 'dataReceived'
  | 'log'

  //
  | 'dataResponse'
  | 'dataResponseReceived'

  //
  | 'voteRequest'
  | 'voteRequestReceived'
  //
  | 'voteResponse'
  | 'voteResponseReceived'
  //
  | 'roleChanged'
  | 'ackNode';

export type RaftMessageType = {
  syncData: RaftDataBody;
  dataReceived: RaftDataBody;
  replicateData: any;
  dataResponse: RaftDataResponseBody;
  dataResponseReceived: RaftDataResponseBody;
  voteRequest: RaftVoteRequestBody;
  voteRequestReceived: RaftVoteRequestBody;
  voteResponse: RaftVoteResponseBody;
  voteResponseReceived: RaftVoteResponseBody;
  serviceCrashed: RaftServerCrashedBody;
  serviceStarted: RaftServiceStartedBody;
  roleChanged: RaftRole;
  ackNode: RaftNode;
  log: RaftLogBody;
};

export type RaftPersistentData = {
  term: number;
  votedFor: RaftNodeId | null;
  data: any;
};

export interface RaftPersistAgent {
  persist(node: RaftNode, data: RaftPersistentData): Promise<void>;
  restore(node: RaftNode): Promise<RaftPersistentData | null | undefined>;
}
