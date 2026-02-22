export class SimpleQueue {
	private delay = 0; // milliseconds
	private readonly queue: (() => Promise<void>)[] = [];
	private queueRunning = false;

	setDelay(delay: number) {
		this.delay = delay;
	}

	clear(){
		this.queue.splice(0, this.queue.length);
	}

	next<T>(run: () => Promise<T>, cancelCheck?: () => boolean): Promise<T> {
		return new Promise<T>((resolve, reject) => {
			this.queue.push(async () => {
				if (this.delay) {
					// We intentionally do the cancel check twice.
					if (cancelCheck?.()) {
						return undefined;
					}

					await new Promise(r => setTimeout(r, this.delay)); // delay before running
				}
				
				try {
					if (cancelCheck?.()) {
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
