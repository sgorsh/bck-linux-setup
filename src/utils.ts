export const colors = {
	reset: "\x1b[0m",
	cyan: "\x1b[36m",
	green: "\x1b[32m",
	yellow: "\x1b[33m",
	red: "\x1b[31m",
	bold: "\x1b[1m"
} as const;

export async function promptForInput(prompt: string): Promise<string> {
	process.stdout.write(prompt);
	for await (const line of console) {
		return line.trim();
	}
	return "";
}

export async function promptForPassword(prompt: string): Promise<string> {
	return new Promise((resolve, reject) => {
		process.stdout.write(prompt);

		let password = "";
		const stdin = process.stdin;

		// Enable raw mode to capture individual keypresses
		if (stdin.isTTY) {
			stdin.setRawMode(true);
		}
		stdin.resume();
		stdin.setEncoding("utf8");

		const onData = (char: string) => {
			const byte = char.charCodeAt(0);

			// Handle Ctrl+C (cancel)
			if (byte === 3) {
				cleanup();
				process.stdout.write("\n");
				reject(new Error("Password input cancelled"));
				return;
			}

			// Handle Ctrl+D (EOF - submit)
			if (byte === 4) {
				cleanup();
				process.stdout.write("\n");
				resolve(password);
				return;
			}

			// Handle Enter (submit)
			if (byte === 13 || char === "\n" || char === "\r") {
				cleanup();
				process.stdout.write("\n");
				resolve(password);
				return;
			}

			// Handle Backspace/Delete
			if (byte === 127 || byte === 8) {
				if (password.length > 0) {
					password = password.slice(0, -1);
					// Move cursor back, write space to erase asterisk, move back again
					process.stdout.write("\b \b");
				}
				return;
			}

			// Handle printable characters (ASCII and UTF-8, ignore control characters)
			if (byte >= 32) {
				password += char;
				process.stdout.write("*");
			}
		};

		const onError = (error: Error) => {
			cleanup();
			process.stdout.write("\n");
			reject(error);
		};

		const cleanup = () => {
			stdin.removeListener("data", onData);
			stdin.removeListener("error", onError);
			stdin.pause();
			if (stdin.isTTY) {
				stdin.setRawMode(false);
			}
		};

		stdin.on("data", onData);
		stdin.on("error", onError);
	});
}

export async function checkSshClientInstalled(): Promise<boolean> {
	try {
		const proc = Bun.spawn(["ssh", "-V"], {
			stdout: "pipe",
			stderr: "pipe"
		});
		await proc.exited;
		return proc.exitCode === 0;
	} catch {
		return false;
	}
}
