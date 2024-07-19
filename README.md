# Raft Leader Election Library

Raft implementation with zero dependency, it's become handy when you need the leader to replicate data across multiple nodes.

# Install

```bash
# with npm
npm i raftq
# with yarn
yarn add raftq
```

### Getting Started

Raftq is a bare raft implementation, you need to connect its internal callback to an external networking enabled application,

### Using ExpressJS

Youtube Demo:\
[![Raftq Demo Video](https://img.youtube.com/vi/ogNlRnSwhbk/0.jpg)](https://www.youtube.com/watch?v=ogNlRnSwhbk)\
A new server will run and join the cluster every time you run this piece of code, make sure you run it at most 4 times, (or change the cluster configuration...)

```typescript
import axios from 'axios';
import express, { type Express } from 'express';
import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { Raftq } from 'raftq';
import type { RaftEventType, RaftNode } from './types';

const cluster = ['5050', '5051', '5052', '5053'];

function bootstrap() {
  const app = express();
  app.use(express.json());
  const raft = new Raftq({
    heartbeat: 100,
    minimumElectionTime: 200,
    maximumElectionTime: 800,
    persistAgent: {
      async persist(node, data) {
        // Persist raft data
        try {
          const dir = '/tmp/raftq';
          await mkdir(dir, { recursive: true });
          const p = path.resolve(dir, `${node.id}.json`);
          await writeFile(p, JSON.stringify(data));
        } catch (err) {
          console.error(err);
          console.log(`[${new Date().toISOString()}] failed to persist data :)`);
        }
      },
      async restore(node) {
        // Read raft data from storage
        try {
          const p = `/tmp/raftq/${node.id}.json`;
          const file = await readFile(p);
          return JSON.parse(file.toString('utf8'));
        } catch {
          return undefined;
        }
      },
    },
  });

  // I'm just creating a pipe so data can pass through
  // you can use RPC calls, RMQ events, decide this your own
  // check TestCluster in the source code which relies only on Dictionaries
  app.post('/raft/action/:action', function (req, res) {
    const action = req.params.action as RaftEventType;
    raft.dispatch(action, req.body);
    res.end('');
  });
  const mapping: { [key in RaftEventType]?: RaftEventType } = {
    voteRequest: 'voteRequestReceived',
    voteResponse: 'voteResponseReceived',
    syncData: 'dataReceived',
    dataResponse: 'dataResponseReceived',
  };
  for (const action in mapping) {
    const eventName = action as RaftEventType;
    raft.subscribe(eventName, async (message) => {
      const url = `http://localhost:${message.destination.id}/raft/action/${mapping[eventName]}`;
      axios.post(url, message, { timeout: message.timeout }).catch(() => {});
    });
  }
  raft.subscribe('log', ({ message }) => {
    console.log(`[${new Date().toISOString()}] ${message}`);
  });

  // node endpoints must be known before starting the server
  // or you can use your favorite service mesh plugin such as consul
  async function startServer(port: number) {
    const clusterWithoutMe = cluster
      .filter((a) => a !== String(port))
      .map<RaftNode>((port) => ({
        id: String(port),
        time: Date.now(),
      }));
    const justMe: RaftNode = {
      id: String(port),
      time: Date.now(),
    };

    await Promise.all(
      clusterWithoutMe.map((node) =>
        axios
          .post(`http://localhost:${node.id}/raft/action/ackNode`, justMe, {
            timeout: 100,
          })
          .then((result) => {
            if (!result) return;
            raft.dispatch('ackNode', node);
          })
          .catch(() => {}),
      ),
    );

    await raft.dispatch('serviceStarted', {
      node: justMe,
    });
  }
  // listen from 5050 and forward
  listen(app, 5050, startServer);
  function listen(app: Express, port: number, done: (port: number) => void) {
    app
      .listen(port, () => {
        console.log(`[${new Date().toISOString()}] running express on ${port}`);
        done(port);
      })
      .on('error', () => {
        listen(app, port + 1, done);
      });
  }

  // crash handling
  process.on('exit', handleCrash);
  process.on('SIGINT', handleCrash);
  process.on('beforeExit', handleCrash);
  process.on('disconnect', handleCrash);
  process.on('uncaughtException', handleCrash);
  process.on('unhandledRejection', handleCrash);

  let isHandlingCrashAlready = false;
  async function handleCrash(e: any) {
    // just for safety!
    if (isHandlingCrashAlready) return;
    isHandlingCrashAlready = true;
    //
    raft.getNode().time = 0;
    await Promise.all(
      raft.getFollowers().map((node) =>
        axios
          .post(`http://localhost:${node.id}/raft/action/ackNode`, raft.getNode(), {
            timeout: 200,
          })
          .catch(() => {}),
      ),
    );
    await raft.dispatch('serviceCrashed', { reason: String(e) });
    await raft.destroy();
    process.exit(1);
  }
}

bootstrap();
```

## Raftq Constructor

```typescript
const raft = new Raftq({
  /* within the Raft lifspan, elected leader
     replicates its data every X(ms)
     which is the heartbeat of the service */
  heartbeat: 100,
  /* minimum wait time to start a new election
     in case no data received from the leader */
  minimumElectionTime: 200,
  /* the new ttl for election will
     be a number between min and max */
  maximumElectionTime: 800,
  /* raft need its data to be persisted
     in case of a crash or reboot */
  persistAgent: {
    async persist(node, data) {
      /* store and serialize the data
         in a persistent storage */
    },
    async restore(node) {
      /* load the persisted data
         or return undefined (fresh start) */
      return undefined;
    },
  },
});
```

## RaftRole

There are three states every node can take

```typescript
RaftRole.CANDIDATE; //  1,
RaftRole.FOLLOWER; //  2,
RaftRole.LEADER; //  3,
```

## Methods

```typescript
type Raftq = {
  /* get the current leader within the cluster */
  getLeader: () => RaftNodeId | null;
  /* get the current role of the current node */
  getRole: () => RaftRole;
  /* get the current node */
  getNode: () => RaftNode;
  /* get followers (other nodes within the cluster) */
  getFollowers: () => RaftNode[];
  /* destroy the node and clear timers */
  destroy: () => Promise<void>;
};
```

## Event Bus

```typescript
type Raftq = {
  /* Simply dispatch an event to the raft system */
  dispatch: (type: RaftEventType, message: MessageType) => Promise<void>;
  /* Listen to upcomming events from the raft system */
  subscribe: (type: RaftEventType, listener: CallbackFunc) => UnsubscribeFunc;
};
```

## Available Events

```typescript
/* dispatch this event to start the raft */
raft.dispatch('serviceStarted', ...)
/* dispatch this event to inform the
raft about an interruption */
raft.dispatch('serviceCrashed', ...)
/* dispatch this event on the leader
to replicate the data to its follower */
raft.dispatch('replicateData', ...)
/* listen to this event for any upcomming
log message */
'log';
/* listen to this event for any upcomming
   role changes */
'roleChanged';
/* dispatch this event to acknowledge
   the raft about a new node */
raft.dispatch('ackNode', {
id: 'any',
time: Date.now()
/* or time: 0,  in case it is removed
   or left from the cluster */
})
```

## Internal Events

Raft uses this events to comunicate with other nodes

```typescript
/* this event is called when a candidate
   request a vote from other nodes in the cluster
   listen to this event and send its message
   to its destination */
raft.subscribe('voteRequest', ...)
/* when you received the 'voteRequest' on other node
   dispatch this to the system */
raft.dispatch('voteRequestReceived', ...)

/* this event is called on other nodes
   when they vote on a candidate
   listen to this event and send its message
   to its destination */
raft.subscribe('voteResponse', ...)
/* when you received the 'voteResponse' on other node
   dispatch this to the system */
raft.dispatch('voteResponseReceived', ...)

/* this event is called on leaders heartbeat
   listen to this event and send its message
   to its destination */
raft.subscribe('syncData', ...)
/* when you received the 'syncData' on other node
   dispatch this to the system */
raft.dispatch('dataReceived', ...)

/* this event is called when a follower
   respond to its leader
   listen to this event and send its message
   to its destination */
raft.subscribe('dataResponse', ...)
/* when you received the 'dataResponse' on other node
   dispatch this to the system */
raft.dispatch('dataResponseReceived', ...)
```

## Dispatch Example

Broadcast data to followers

```typescript
raft.dispatch('replicateData', {
  something: 'shared, and available',
});
```
