export class CancelableTimer {
  private handle: NodeJS.Timeout | undefined = undefined;

  constructor(
    private callback: VoidFunction,
    private min: number,
    private max: number,
  ) {}

  public start() {
    const waitTime = this.min + (this.max - this.min) * Math.random();
    clearTimeout(this.handle);
    this.handle = setTimeout(() => {
      this.callback();
    }, waitTime);
  }

  public cancel() {
    clearTimeout(this.handle);
  }
}
