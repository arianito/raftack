import { Raftq } from '../Raftq';
import type {
  RaftqOptions,
  RaftNode,
  RaftNodeId,
  RaftPersistAgent,
  RaftPersistentData,
} from '../types';

export class TestCluster {
  private storage = new Map<RaftNodeId, RaftPersistentData>();
  private persistAgent: RaftPersistAgent;
  private nodeDefs: RaftNode[] = [];
  private nodes = new Map<RaftNodeId, Raftq>();

  constructor(private options: { nodeCount: number } & Omit<RaftqOptions, 'persistAgent'>) {
    this.persistAgent = {
      persist: async (node, data) => {
        this.storage.set(node.id, data);
      },
      restore: async (node) => {
        return this.storage.get(node.id);
      },
    };
    this.nodeDefs = Array.from(Array(this.options.nodeCount)).map<RaftNode>((_, i) => ({
      id: i,
      address: String(i),
      time: 1,
    }));
  }

  getNode(id: RaftNodeId) {
    const node = this.nodes.get(id);
    if (!node) throw new Error('invalid node');
  }

  getNodes() {
    return this.nodes.values();
  }
  getStorage() {
    return this.storage;
  }

  destroyItself = async () => {
    this.nodeDefs = [];
    for (const node of this.nodes.values()) {
      await node.destroy();
    }
  };

  addNode = async (nodeDef: RaftNode) => {
    const exist = this.nodes.get(nodeDef.id);
    if (exist) throw new Error('already exists');
    this.nodeDefs.push(nodeDef);

    const node = new Raftq({
      ...this.options,
      persistAgent: this.persistAgent,
    });

    const others = this.nodeDefs.filter((a) => a.id !== nodeDef.id);
    for (const follower of others) {
      await node.dispatch('ackNode', follower);
    }
    await node.dispatch('serviceStarted', {
      node: nodeDef,
    });
  };

  destroyNode = async (nodeDef: RaftNode) => {
    const node = this.nodes.get(nodeDef.id);
    if (!node) return;

    await node.dispatch('serviceCrashed', { reason: 'removed!' });
    this.nodes.delete(nodeDef.id);
    await node.destroy();

    const index = this.nodeDefs.findIndex((a) => a.id === nodeDef.id);
    if (index === -1) return;
    this.nodeDefs.splice(index, 1);
    for (const follower of this.nodeDefs) {
      await node.dispatch('ackNode', {
        ...follower,
        time: 0,
      });
    }
  };

  crashNode = async (nodeDef: RaftNode) => {
    const node = this.nodes.get(nodeDef.id);
    if (!node) return;
    await node.dispatch('serviceCrashed', { reason: 'manual crash!' });
  };

  createNode = (nodeDef: RaftNode) => {
    const node = new Raftq({
      ...this.options,
      persistAgent: this.persistAgent,
    });
    this.nodes.set(nodeDef.id, node);
    node.subscribe('syncData', async (message) => {
      const node = this.nodes.get(message.destination.id);
      if (!node) return;
      node.dispatch('dataReceived', message);
    });
    node.subscribe('dataResponse', async (message) => {
      const node = this.nodes.get(message.destination.id);
      if (!node) return;
      node.dispatch('dataResponseReceived', message);
    });
    node.subscribe('voteResponse', async (message) => {
      const node = this.nodes.get(message.destination.id);
      if (!node) return;
      node.dispatch('voteResponseReceived', message);
    });
    node.subscribe('voteRequest', async (message) => {
      const node = this.nodes.get(message.destination.id);
      if (!node) return;
      node.dispatch('voteRequestReceived', message);
    });
    return node;
  };

  createAndStart = async () => {
    await Promise.all(
      this.nodeDefs.map((nodeDef) =>
        (async () => {
          const node = this.createNode(nodeDef);
          const others = this.nodeDefs.filter((a) => a.id !== nodeDef.id);
          for (const follower of others) {
            await node.dispatch('ackNode', follower);
          }
          await node.dispatch('serviceStarted', {
            node: nodeDef,
          });
        })(),
      ),
    );
  };
}
