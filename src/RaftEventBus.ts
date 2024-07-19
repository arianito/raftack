export class RaftEventBus<
  RaftEventType extends string,
  RaftMessageType extends { [K in RaftEventType]: any },
> {
  private listeners = new Map<string, any[]>();
  private getListeners(type: string) {
    let bucket = this.listeners.get(type);
    if (!bucket) {
      bucket = [];
      this.listeners.set(type, bucket);
    }
    return bucket;
  }
  clean<T extends [RaftEventType, ...RaftEventType[]]>(...channels: T) {
    if (!channels.length) {
      return this.listeners.clear();
    }
    channels.forEach((channel) => this.listeners.set(channel, []));
  }
  clear() {
    return this.listeners.clear();
  }
  dispatch<T extends RaftEventType>(type: T, message: RaftMessageType[T]) {
    const listeners = this.getListeners(type);
    if (listeners.length) {
      return Promise.all(
        listeners.map((listener) => Promise.resolve(1).then(() => listener(message))),
      );
    }
    return Promise.resolve();
  }
  subscribe<T extends RaftEventType>(
    type: T,
    listener: (message: RaftMessageType[T]) => void,
  ): VoidFunction {
    const listeners = this.getListeners(type);
    listeners.push(listener);
    return () => {
      Promise.resolve(1).then(() => {
        const idx = listeners.indexOf(listener);
        if (idx === -1) return;
        listeners.splice(idx, 1);
      });
    };
  }
}
