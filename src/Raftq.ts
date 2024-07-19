import { CancelableTimer } from './CancelableTimer';
import { RaftEventBus } from './RaftEventBus';
import type {
  RaftqOptions,
  RaftEventType,
  RaftDataBody,
  RaftDataResponseBody,
  RaftMessageType,
  RaftNode,
  RaftNodeId,
  RaftPersistentData,
  RaftVoteRequestBody,
  RaftVoteResponseBody,
} from './types';
import { RaftRole } from './types';

export class Raftq extends RaftEventBus<RaftEventType, RaftMessageType> {
  private currentNode!: RaftNode;
  private readonly followers: RaftNode[] = [];
  private electionTimer!: CancelableTimer;

  private persistentData!: RaftPersistentData;
  private prevRole: RaftRole = RaftRole.FOLLOWER;
  private role: RaftRole = RaftRole.FOLLOWER;
  private leader: RaftNodeId | null = null;
  private receivedVotes: RaftNodeId[] = [];
  private interval: NodeJS.Timeout | undefined = undefined;

  public getData() {
    return this.persistentData.data;
  }
  public getLeader() {
    return this.leader;
  }
  public getRole() {
    return this.role;
  }
  public getNode() {
    return this.currentNode;
  }
  public getFollowers() {
    return this.followers;
  }

  constructor(private options: RaftqOptions) {
    super();
    this.dispatch('log', {
      message: `raft initialized`,
    });
    this.subscribe('serviceStarted', async ({ node }) => {
      this.currentNode = node;
      this.persistentData = (await options.persistAgent.restore(this.currentNode)) ?? {
        term: 0,
        votedFor: null,
        data: {},
      };
      this.leader = null;
      this.role = RaftRole.FOLLOWER;
      this.receivedVotes = [];
      this.clean(
        'voteRequestReceived',
        'voteResponseReceived',
        'dataReceived',
        'dataResponseReceived',
        'replicateData',
      );
      this.subscribe('voteRequestReceived', this.voteRequestReceived);
      this.subscribe('voteResponseReceived', this.voteResponseReceived);
      this.subscribe('dataReceived', this.dataReceived);
      this.subscribe('dataResponseReceived', this.dataResponseReceived);
      this.subscribe('replicateData', (data) => {
        if (this.role === RaftRole.LEADER) {
          this.persistentData.data = data;
        }
      });
      if (this.electionTimer) {
        this.electionTimer.cancel();
      }
      this.electionTimer = new CancelableTimer(
        this.startElection,
        options.minimumElectionTime,
        options.maximumElectionTime,
      );
      this.interval = setInterval(() => {
        if (this.role === RaftRole.LEADER) {
          this.followers.forEach((follower) => {
            this.dispatch('syncData', {
              destination: follower,
              timeout: this.options.minimumElectionTime / 2,
              data: this.persistentData.data,
              node: this.currentNode,
              term: this.persistentData.term,
            });
          });
        }
      }, options.heartbeat);

      this.dispatch('log', {
        message: `raft started`,
      });
      this.electionTimer.start();
    });
    this.subscribe('serviceCrashed', async (message) => {
      this.dispatch('log', {
        message: `raft crashed: ${message.reason}`,
      });
      await options.persistAgent.persist(this.currentNode, this.persistentData);
      this.role = RaftRole.FOLLOWER;
      this.informUpdate();
      this.persistentData.votedFor = null;
      this.leader = null;
      this.electionTimer.start();
    });
    this.subscribe('ackNode', (node: RaftNode) => {
      const index = this.followers.findIndex((a) => a.id === node.id);

      if (index !== -1 && !node.time) {
        this.followers.splice(index, 1);
        this.dispatch('log', {
          message: `raft node destroyed: ${node.id}`,
        });
        return;
      }

      if (index !== -1) {
        this.followers[index] = node;
        return;
      }

      if (!node.time) return;
      this.followers.push(node);
      this.dispatch('log', {
        message: `raft node added: ${node.id}`,
      });
    });
  }

  public destroy = async () => {
    clearInterval(this.interval);
    this.electionTimer.cancel();
    await this.options.persistAgent.persist(this.currentNode, this.persistentData);
    this.dispatch('log', {
      message: `raft is gracefully destroying itself!`,
    });
    this.clear();
  };
  private startElection = () => {
    if (this.followers.length === 0) {
      this.dispatch('log', {
        message: `election has no candidates`,
      });
      this.role = RaftRole.CANDIDATE;
      this.informUpdate();
      setTimeout(() => {
        this.role = RaftRole.LEADER;
        this.informUpdate();
        this.leader = this.currentNode.id;
        this.persistentData.votedFor = this.currentNode.id;
      }, 1000);
      return;
    }
    this.dispatch('log', {
      message: `election started between ${this.followers.length} nodes`,
    });
    this.persistentData.term++;
    this.persistentData.votedFor = this.currentNode.id;
    this.role = RaftRole.CANDIDATE;
    this.informUpdate();
    this.receivedVotes = [this.currentNode.id];
    this.followers.forEach((node) =>
      this.dispatch('voteRequest', {
        destination: node,
        timeout: this.options.minimumElectionTime / 2,
        candidate: this.currentNode,
        term: this.persistentData.term,
      }),
    );
    this.electionTimer.start();
  };

  private informUpdate = () => {
    if (this.prevRole !== this.role) {
      this.dispatch('log', {
        message: `node become ${String(RaftRole[this.role])}`,
      });
      this.dispatch('roleChanged', this.role);
      this.prevRole = this.role;
    }
  };

  private voteRequestReceived = (vote: RaftVoteRequestBody) => {
    // on voter
    if (vote.term > this.persistentData.term) {
      this.persistentData.term = vote.term;
      this.role = RaftRole.FOLLOWER;
      this.informUpdate();
      this.persistentData.votedFor = null;
    }

    const granted =
      vote.term === this.persistentData.term &&
      (!this.persistentData.votedFor || this.persistentData.votedFor === vote.candidate.id);

    if (granted) {
      this.persistentData.votedFor = vote.candidate.id;
    }

    return this.dispatch('voteResponse', {
      destination: vote.candidate,
      timeout: this.options.minimumElectionTime / 2,
      voter: this.currentNode,
      term: this.persistentData.term,
      granted: granted,
    });
  };

  private voteResponseReceived = (vote: RaftVoteResponseBody) => {
    // on candidate
    if (
      vote.term === this.persistentData.term &&
      this.role === RaftRole.CANDIDATE &&
      vote.granted
    ) {
      this.receivedVotes.push(vote.voter.id);
      if (this.receivedVotes.length > (this.followers.length + 1) / 2) {
        this.role = RaftRole.LEADER;
        this.informUpdate();
        this.leader = this.currentNode.id;
        this.electionTimer.cancel();
        return;
      }
    } else if (vote.term > this.persistentData.term) {
      this.dispatch('log', {
        message: `let's step down and be a follower for a while`,
      });
      this.persistentData.term = vote.term;
      this.role = RaftRole.FOLLOWER;
      this.informUpdate();
      this.persistentData.votedFor = null;
    }
    this.electionTimer.start();
  };
  private dataReceived = (log: RaftDataBody) => {
    // on followers
    let canceled = false;
    if (log.term > this.persistentData.term) {
      this.persistentData.term = log.term;
      this.persistentData.votedFor = null;
      this.electionTimer.cancel();
      canceled = true;
    }
    if (log.term === this.persistentData.term) {
      this.role = RaftRole.FOLLOWER;
      this.informUpdate();
      this.leader = log.node.id;
      this.persistentData.data = log.data;
      this.dispatch('dataResponse', {
        destination: log.node,
        node: this.currentNode,
        timeout: this.options.minimumElectionTime / 2,
        term: this.persistentData.term,
        success: true,
      });
      if (!canceled) this.electionTimer.start();
    } else {
      this.dispatch('log', {
        message: `You are not worthy ${log.node.id}, let's start an election`,
      });
      this.dispatch('dataResponse', {
        destination: log.node,
        node: this.currentNode,
        timeout: this.options.minimumElectionTime / 2,
        term: this.persistentData.term,
        success: false,
      });
      this.electionTimer.start();
    }
  };
  private dataResponseReceived = (log: RaftDataResponseBody) => {
    // on leader
    if (log.term > this.persistentData.term) {
      this.persistentData.term = log.term;

      this.role = RaftRole.FOLLOWER;
      this.informUpdate();

      this.persistentData.votedFor = null;
      this.electionTimer.cancel();
    } else if (log.term === this.persistentData.term) {
      this.electionTimer.start();
    }
  };
}
