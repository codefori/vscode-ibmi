export class SimpleQueue {
	private static _instance: SimpleQueue | null = null;

	static get instance() {
		if (!this._instance) {
			this._instance = new SimpleQueue();
		}
		return this._instance;
	}

	private delay = 0; // milliseconds
	private queue: (() => Promise<void>)[] = [];
	private queueRunning = false;

	setDelay(delay: number) {
		this.delay = delay;
	}

	next<T>(run: () => Promise<T>, cancelCheck?: () => boolean): Promise<T> {
		return new Promise<T>((resolve, reject) => {
			this.queue.push(async () => {
				if (this.delay) {
					// We intentially do the cancel check twice.
					if (cancelCheck && cancelCheck()) {
						return undefined;
					}

					await new Promise(r => setTimeout(r, this.delay)); // delay before running
				}
				
				try {
					if (cancelCheck && cancelCheck()) {
						return undefined;
					}

					const result = await run();
					resolve(result);
				} catch (err) {
					reject(err);
				}
			});
			this.runNext();
		});
	}

	private async runNext() {
		if (this.queueRunning) {return;}
		const task = this.queue.shift();
		if (!task) {return;}

		this.queueRunning = true;
		try {
			await task();
		} finally {
			this.queueRunning = false;
			this.runNext(); // run next item in queue
		}
	}
}
