export interface SetupDeviceConfig {
	/** SSH host - IP address or hostname (e.g. "192.168.1.100" or "cx8290") */
	host: string;

	/** SSH username (e.g. "Administrator") */
	username: string;

	/** Commands to execute on the device via SSH */
	commands: string[];

	/** Enable APT repository proxy with automatic authentication for Beckhoff repositories */
	useProxy?: boolean;
}
