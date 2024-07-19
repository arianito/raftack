import { RaftRole } from '../types';
import { TestCluster } from './TestCluster';

async function bootstrap() {
  const srv = new TestCluster({
    nodeCount: 4,
    heartbeat: 10,
    minimumElectionTime: 50,
    maximumElectionTime: 500,
  });

  await srv.createAndStart();
  for (const node of srv.getNodes()) {
    node.subscribe('log', (message) => {
      console.log(`[${node.getNode().id}]  ${message.message}`);
    });
  }

  await new Promise((acc) => setTimeout(acc, 1000));

  for (const node of srv.getNodes()) {
    if (node.getRole() === RaftRole.LEADER) {
      srv.crashNode(node.getNode());
    }
  }
}

bootstrap();
