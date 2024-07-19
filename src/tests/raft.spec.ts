import { assert } from 'chai';
import { afterEach, beforeEach, describe, it } from 'node:test';
import type { RaftNode } from '../types';
import { RaftRole } from '../types';
import { TestCluster } from './TestCluster';

describe('raft should persist data on crash', () => {
  let testCluster!: TestCluster;
  beforeEach(async () => {
    testCluster = new TestCluster({
      nodeCount: 4,
      heartbeat: 10,
      minimumElectionTime: 100,
      maximumElectionTime: 200,
    });
    await testCluster.createAndStart();
    await new Promise((acc) => setTimeout(acc, 300));
  });

  afterEach(async () => {
    await testCluster.destroyItself();
  });

  it('should elect a leader on first run', async () => {
    let currentLeader: RaftNode | null = null;
    for (const node of testCluster.getNodes()) {
      if (node.getRole() === RaftRole.LEADER) {
        currentLeader = node.getNode();
        break;
      }
    }
    assert.isNotNull(currentLeader);
  });

  it('should elect after leader failed', async () => {
    await new Promise((acc) => setTimeout(acc, 300));
    let currentLeader: RaftNode | null = null;
    for (const node of testCluster.getNodes()) {
      if (node.getRole() === RaftRole.LEADER) {
        currentLeader = node.getNode();
        break;
      }
    }
    assert.isNotNull(currentLeader);
    testCluster.crashNode(currentLeader);
    await new Promise((acc) => setTimeout(acc, 300));
    let nextLeader: RaftNode | null = null;
    for (const node of testCluster.getNodes()) {
      if (node.getRole() === RaftRole.LEADER) {
        nextLeader = node.getNode();
      }
    }
    assert.isNotNull(nextLeader);
    assert.notEqual(nextLeader.id, currentLeader.id);
  });

  it('should persist data on crash', async () => {
    await new Promise((acc) => setTimeout(acc, 300));
    let currentLeader: RaftNode | null = null;
    for (const node of testCluster.getNodes()) {
      if (node.getRole() === RaftRole.LEADER) {
        currentLeader = node.getNode();
        break;
      }
    }
    assert.isNotNull(currentLeader);
    await testCluster.crashNode(currentLeader);
    await new Promise((acc) => setTimeout(acc, 300));
    assert.isDefined(testCluster.getStorage().get(currentLeader.id));
  });
});
