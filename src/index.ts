#!/usr/bin/env bun
import { parseArgs } from "util";
import { resolve } from "path";
import { AptProxy, PROXY_PORT } from "./apt-proxy";
import type { SetupDeviceConfig } from "./types";
import { colors, promptForInput, promptForPassword, checkSshClientInstalled } from "./utils";
import packageJson from "../package.json";

function printHelp(): never {
	console.log(`Execute commands on remote Beckhoff devices via SSH with APT proxy support

Usage:
  Interactive mode (default):
    bck-linux-setup <host> [--username <user>] [--use-proxy] [--config <path>]

  Command execution mode:
    bck-linux-setup --run-commands --config <path>

Arguments:
  <host>            Target device IP address or hostname

Options:
  --username <user> SSH username (default: Administrator)
  --use-proxy       Enable APT proxy for authenticated Beckhoff repositories
  --run-commands    Execute commands from config file (requires --config)
  --config <path>   Configuration file path (required with --run-commands)
  --bck-username    myBeckhoff account email for proxy auth (env: BCK_USERNAME)
  --version         Show version number
  --help            Show this help message

Modes:
  Interactive (default):  SSH into device with optional proxy setup
  Command execution:      Execute commands from config file and exit

Environment:
  BCK_USERNAME      myBeckhoff account email (for proxy auth)
  BCK_PASSWORD      myBeckhoff account password (for proxy auth)

Examples:
  # Interactive SSH session (uses default username: Administrator)
  bck-linux-setup 192.168.1.10

  # Execute commands from config
  bck-linux-setup --run-commands --config my-config.json`);
	process.exit(1);
}

const { values, positionals } = parseArgs({
	args: Bun.argv,
	options: {
		config: { type: "string" },
		username: { type: "string" },
		"use-proxy": { type: "boolean" },
		"run-commands": { type: "boolean" },
		"bck-username": { type: "string" },
		version: { type: "boolean" },
		help: { type: "boolean" }
	},
	strict: true,
	allowPositionals: true
});

// Get host from positional argument (first positional after script name)
const host = positionals[2]; // [0]=bun, [1]=script.ts, [2]=host

if (values.help) printHelp();

if (values.version) {
	console.log(packageJson.version);
	process.exit(0);
}

// Check SSH client is installed
if (!(await checkSshClientInstalled())) {
	console.error("SSH client is not installed or not in PATH");
	console.log(`${colors.yellow}Install instructions:${colors.reset}`);
	console.log(`${colors.yellow}  - Windows: Install OpenSSH Client (Settings > Apps > Optional Features)${colors.reset}`);
	console.log(`${colors.yellow}  - macOS: SSH is pre-installed${colors.reset}`);
	console.log(`${colors.yellow}  - Linux: sudo apt install openssh-client (Debian/Ubuntu) or sudo yum install openssh-clients (RHEL/CentOS)${colors.reset}`);
	process.exit(1);
}

// Validate and load config file
let config: Partial<SetupDeviceConfig> = {};

if (values["run-commands"] && !values.config) {
	console.error("--run-commands requires --config parameter");
	console.log(`${colors.yellow}Example: bck-linux-setup --run-commands --config my-config.json${colors.reset}`);
	process.exit(1);
}

if (values.config) {
	const configPath = resolve(values.config);
	const configFile = Bun.file(configPath);

	if (!(await configFile.exists())) {
		console.error(`Config file not found: ${configPath}`);
		process.exit(1);
	}

	config = await configFile.json();
}

// Detect conflicts between CLI args and config file
const conflicts: string[] = [];
if (values.username && config.username) conflicts.push("username");
if (values["use-proxy"] !== undefined && config.useProxy !== undefined) conflicts.push("useProxy/use-proxy");

if (conflicts.length > 0) {
	console.error("Parameter conflict: The following parameters are specified in both CLI arguments and config file:");
	conflicts.forEach(c => console.error(`  - ${c}`));
	console.log(`${colors.yellow}Remove from either CLI arguments or config file${colors.reset}`);
	process.exit(1);
}

// Merge CLI args with config (CLI args take priority when no conflict)
const finalUsername = values.username || config.username || "Administrator";
const finalUseProxy = values["use-proxy"] ?? config.useProxy ?? false;
const finalCommands = config.commands || [];

// Validate required parameters
if (!host) {
	console.error("Missing required parameter: <host>");
	console.log(`${colors.yellow}Example: bck-linux-setup 192.168.1.10${colors.reset}`);
	process.exit(1);
}

// Validate commands if --run-commands is set
if (values["run-commands"] && finalCommands.length === 0) {
	console.error("--run-commands requires a config file with at least one command");
	process.exit(1);
}

// Get proxy credentials if needed
let aptProxy: AptProxy | null = null;

// Cleanup handler for graceful shutdown
const cleanup = () => {
	if (aptProxy) {
		aptProxy.stop();
	}
};

if (finalUseProxy) {
	console.log(`${colors.cyan}APT proxy enabled - myBeckhoff account credentials required${colors.reset}`);

	const username = values["bck-username"] || Bun.env.BCK_USERNAME ||
		await promptForInput(`${colors.cyan}myBeckhoff account email: ${colors.reset}`);

	const password = Bun.env.BCK_PASSWORD ||
		await promptForPassword(`${colors.cyan}myBeckhoff account password: ${colors.reset}`);

	if (!username || !password) {
		console.error("Repository proxy requires both username and password");
		process.exit(1);
	}

	process.stdout.write(`${colors.cyan}Starting APT proxy server on localhost:${PROXY_PORT}...${colors.reset} `);
	aptProxy = new AptProxy(username, password);
	aptProxy.start();
	console.log(`${colors.green}✓${colors.reset}`);

	// Check authenticated connection to Beckhoff repository
	process.stdout.write(`${colors.cyan}Checking connection to deb.beckhoff.com...${colors.reset} `);
	try {
		await aptProxy.checkConnection();
		console.log(`${colors.green}✓${colors.reset}`);
	} catch (error) {
		console.log(`${colors.red}✗${colors.reset}`);
		console.error(error instanceof Error ? error.message : String(error));
		cleanup();
		process.exit(1);
	}
}

// Register signal handlers for graceful shutdown
process.on('SIGINT', () => {
	console.log(''); // New line after ^C
	if (aptProxy) {
		process.stdout.write(`${colors.cyan}Stopping APT proxy server...${colors.reset} `);
		aptProxy.stop();
		console.log(`${colors.green}✓${colors.reset}`);
	}
	process.exit(130);
});

process.on('SIGTERM', () => {
	cleanup();
	process.exit(143);
});

// Build SSH command based on mode
let script: string | undefined;

if (values["run-commands"]) {
	// Command execution mode
	console.log(`${colors.cyan}Connecting to ${colors.bold}${finalUsername}@${host}${colors.reset}${colors.cyan}, executing ${colors.bold}${finalCommands.length}${colors.reset}${colors.cyan} command(s):${colors.reset}`);
	finalCommands.forEach((cmd, i) =>
		console.log(`${colors.yellow}[${i + 1}/${finalCommands.length}]${colors.reset} ${cmd}`)
	);
	console.log("");

	const userCommands = finalCommands.join(" && ");
	script = aptProxy
		? `bash -c '${`${AptProxy.getSetupScript()}\n\n${userCommands}`.replace(/'/g, "'\\''")}'`
		: userCommands;
} else {
	// Interactive mode
	const proxyMsg = aptProxy ? " with local APT proxy" : "";
	console.log(`${colors.cyan}Connecting to ${colors.bold}${finalUsername}@${host}${colors.reset}${colors.cyan} in interactive mode${proxyMsg}${colors.reset}`);

	if (aptProxy) {
		// Interactive with proxy - setup proxy, then drop to shell
		const setupScript = AptProxy.getSetupScript();
		script = `bash -c '${setupScript.replace(/'/g, "'\\''")}; bash'`;
	}
}

// Build SSH arguments
const sshArgs = [
	"ssh", "-t",
	...(aptProxy ? ["-R", `${PROXY_PORT}:localhost:${PROXY_PORT}`] : []),
	`${finalUsername}@${host}`,
	...(script ? [script] : [])
];

const sshProcess = Bun.spawn(sshArgs, {
	stdin: "inherit",
	stdout: "inherit",
	stderr: "inherit"
});

await sshProcess.exited;

if (aptProxy) {
	process.stdout.write(`\n${colors.cyan}Stopping APT proxy server...${colors.reset} `);
	aptProxy.stop();
	console.log(`${colors.green}✓${colors.reset}`);
}

if (values["run-commands"]) {
	if (sshProcess.exitCode !== 0) {
		console.error(`\nSetup failed with exit code ${sshProcess.exitCode}`);
		process.exit(1);
	}
	console.log(`${colors.green}${colors.bold}✓ Setup completed successfully${colors.reset}`);
}
