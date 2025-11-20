import setupScriptContent from "./scripts/setup-apt-proxy.sh" with { type: "text" };

export const PROXY_PORT = 3142; // Standard APT proxy port (apt-cacher-ng)

/** APT proxy server for auto-injecting authentication to Beckhoff repositories */
export class AptProxy {
	private server: ReturnType<typeof Bun.serve> | null = null;
		private readonly base64Auth: string;

	constructor(
		auth_username: string,
		auth_password: string,
		private readonly port: number = PROXY_PORT,
	) {
		this.base64Auth = btoa(`${auth_username}:${auth_password}`);
	}

	start(): void {
		if (this.server) throw new Error("Proxy server is already running");

		const base64Auth = this.base64Auth;

		this.server = Bun.serve({
			port: this.port,
			hostname: "localhost",
			development: false,

			async fetch(req) {
				try {
					const url = new URL(req.url);
					// Extract target from Host header if proxying localhost
					const targetHost = url.hostname === "localhost" || url.hostname === "127.0.0.1"
						? req.headers.get("host")?.split(":")[0] || "localhost"
						: url.hostname;

					// APT sends HTTP, repos require HTTPS
					const targetUrl = `https://${targetHost}${url.pathname}${url.search}`;
					const headers = new Headers();

					// Copy headers, filter out proxy-specific ones
					for (const [key, value] of req.headers.entries()) {
						const lowerKey = key.toLowerCase();
						if (!lowerKey.startsWith("proxy-") && lowerKey !== "host" && lowerKey !== "connection") {
							headers.set(key, value);
						}
					}

					headers.set("Host", targetHost);
					// Auto-inject auth for Beckhoff repositories
					if (targetHost.endsWith("beckhoff.com")) {
						headers.set("Authorization", `Basic ${base64Auth}`);
					}

					const response = await fetch(targetUrl, {
						method: req.method,
						headers,
						body: req.body
					});

					const responseHeaders = new Headers();
					for (const [key, value] of response.headers.entries()) {
						if (key.toLowerCase() !== "connection") {
							responseHeaders.set(key, value);
						}
					}
					// Prevent APT connection reuse (avoids 11s timeout delays)
					responseHeaders.set("Connection", "close");

					return new Response(response.body, {
						status: response.status,
						statusText: response.statusText,
						headers: responseHeaders
					});
				} catch (error) {
					console.error("Proxy error:", error);
					return new Response("Proxy Error", { status: 502 });
				}
			}
		});
	}

	/** Check connectivity to Beckhoff APT repository */
	async checkConnection(): Promise<void> {
		const response = await fetch("https://deb.beckhoff.com", {
			method: "HEAD",
			headers: {
				"Authorization": `Basic ${this.base64Auth}`
			}
		});

		if (response.status === 401) {
			throw new Error("Authentication failed - invalid username or password");
		}

		if (response.status >= 400) {
			throw new Error(`Server returned status ${response.status}`);
		}
	}
	
	stop(): void {
		if (this.server) {
			this.server.stop();
			this.server = null;
		}
	}

	static getSetupScript(): string {
		// Fix Windows-style line endings and trim trailing whitespace
		return setupScriptContent.replace(/\r/g, '').trim();
	}
}
