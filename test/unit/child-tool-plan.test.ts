import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it } from "node:test";
import { applyThinkingSuffix, supervisorChannelDir, getHostBuiltinToolNames, resolvePiLaunchToolPlan } from "../../src/runs/shared/child-tool-plan.ts";
import { buildInProcessChildLaunch } from "../../src/runs/shared/child-launch.ts";
import { MCP_RUNTIME_SNAPSHOT_EVENT, MCP_RUNTIME_SNAPSHOT_VERSION, type McpRuntimeSnapshotHost } from "../../src/runs/shared/mcp-direct-tool-allowlist.ts";

/** A parent whose pi-mcp-adapter answers snapshot requests for one runtime-only server. */
function runtimeSnapshotHost(serverName: string): McpRuntimeSnapshotHost {
	return {
		events: {
			emit(event, request) {
				if (event !== MCP_RUNTIME_SNAPSHOT_EVENT || request.version !== MCP_RUNTIME_SNAPSHOT_VERSION || request.name !== serverName) return;
				request.result = { ok: true, snapshot: { name: serverName, runtime: true, persisted: false, definition: { command: "node", args: ["server.js"] } } };
			},
		},
	};
}

describe("child tool plan", () => {
	it("fails a launch that selects MCP tools from the adapter's runtime snapshot", () => {
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagents-runtime-mcp-"));
		try {
			assert.throws(
				() => resolvePiLaunchToolPlan({ tools: ["read"], mcpDirectTools: ["runtime-only/search"], cwd, agentName: "browser", runtimeSnapshotHost: runtimeSnapshotHost("runtime-only") }),
				/cannot be provided to in-process children; MCP tools must come from an ambient adapter extension in a background child/,
			);
		} finally {
			fs.rmSync(cwd, { recursive: true, force: true });
		}
	});
});

describe("child tool plan host builtin intersection", () => {
	it("intersects declared tools with host-available builtins", () => {
		const plan = resolvePiLaunchToolPlan({
			tools: ["read", "grep", "find", "ls", "bash"],
			hostAvailableBuiltins: ["ipython", "bash"],
		});
		assert.deepEqual(plan.declaredBuiltinTools, ["bash"]);
		assert.deepEqual(plan.unavailableHostBuiltins, ["read", "grep", "find", "ls"]);
		assert.deepEqual(plan.effectiveToolAllowlist, ["bash"]);
	});

	it("keeps requested native coordination tools through host builtin filtering, but not ceilings or exclusions", () => {
		const tools = ["read", "subagent", "contact_supervisor", "subagent_supervisor"];
		const input = { tools, hostAvailableBuiltins: ["read"] };
		const plan = resolvePiLaunchToolPlan(input);
		assert.deepEqual(plan.effectiveToolAllowlist, tools);
		assert.deepEqual(plan.requiredChildTools, ["read", "subagent", "subagent_supervisor"]);
		assert.equal(plan.fanoutAuthorized, true);
		assert.deepEqual(plan.unavailableHostBuiltins, []);
		for (const restriction of [
			{ excludeTools: ["subagent_supervisor"] },
			{ capabilityCeiling: { version: 1 as const, allowedTools: ["read", "subagent", "contact_supervisor"], denyExtensions: true, sources: ["test"] } },
		]) {
			const restricted = resolvePiLaunchToolPlan({ ...input, ...restriction });
			assert.equal(restricted.fanoutAuthorized, true);
			assert.equal(restricted.effectiveToolAllowlist.includes("subagent_supervisor"), false);
		}
		const leaf = resolvePiLaunchToolPlan({ ...input, tools: ["read", "contact_supervisor"] });
		assert.equal(leaf.fanoutAuthorized, false);
		assert.equal(leaf.effectiveToolAllowlist.includes("subagent_supervisor"), false);
	});

	it("rejects an explicitly requested reply tool when fanout authorization is absent or removed", () => {
		for (const input of [
			{ tools: ["read", "subagent_supervisor"] },
			{ tools: ["read", "subagent", "subagent_supervisor"], excludeTools: ["subagent"] },
			{ tools: ["read", "subagent", "subagent_supervisor"], capabilityCeiling: { version: 1 as const, allowedTools: ["read", "subagent_supervisor"], sources: ["test"] } },
		]) {
			assert.throws(() => resolvePiLaunchToolPlan({ ...input, hostAvailableBuiltins: ["read"] }), /subagent_supervisor.*requires fanout authorization/);
		}
	});

	it("keeps all tools when host provides them", () => {
		const plan = resolvePiLaunchToolPlan({
			tools: ["read", "grep", "bash"],
			hostAvailableBuiltins: ["read", "grep", "bash", "write", "find"],
		});
		assert.deepEqual(plan.declaredBuiltinTools, ["read", "grep", "bash"]);
		assert.deepEqual(plan.unavailableHostBuiltins, []);
	});

	it("works without hostAvailableBuiltins (standard Pi hosts)", () => {
		const plan = resolvePiLaunchToolPlan({
			tools: ["read", "grep", "find", "ls"],
		});
		assert.deepEqual(plan.declaredBuiltinTools, ["read", "grep", "find", "ls"]);
		assert.deepEqual(plan.unavailableHostBuiltins, []);
	});

	it("fails when requireReadTool is true but host does not provide read", () => {
		assert.throws(
			() => resolvePiLaunchToolPlan({
				tools: ["bash"],
				requireReadTool: true,
				hostAvailableBuiltins: ["ipython", "bash"],
				agentName: "oracle",
			}),
			/Host runtime does not provide required tool 'read' for agent 'oracle'/,
		);
		assert.throws(
			() => resolvePiLaunchToolPlan({
				tools: ["bash"],
				requireReadTool: true,
				hostAvailableBuiltins: ["bash"],
			}),
			/Host runtime does not provide required tool 'read'/,
		);
	});

	it("includes unavailableHostBuiltins in capability audit", () => {
		const plan = resolvePiLaunchToolPlan({
			tools: ["read", "bash"],
			hostAvailableBuiltins: ["bash"],
			capabilityCeiling: {
				version: 1,
				allowedTools: ["read", "bash"],
				denyExtensions: false,
				sources: ["test"],
			},
		});
		assert.deepEqual(plan.capabilityAudit?.unavailableHostBuiltins, ["read"]);
	});

	it("respects both capability ceiling and host availability", () => {
		const plan = resolvePiLaunchToolPlan({
			tools: ["read", "grep", "bash", "write"],
			hostAvailableBuiltins: ["read", "grep", "bash"],
			capabilityCeiling: {
				version: 1,
				allowedTools: ["read", "bash"],
				denyExtensions: false,
				sources: ["test"],
			},
		});
		assert.deepEqual(plan.declaredBuiltinTools, ["read", "bash"]);
		assert.deepEqual(plan.unavailableHostBuiltins, []);
	});

	it("tracks tools removed by host even when ceiling allows them", () => {
		const plan = resolvePiLaunchToolPlan({
			tools: ["read", "grep", "bash"],
			hostAvailableBuiltins: ["bash"],
			capabilityCeiling: {
				version: 1,
				allowedTools: ["read", "grep", "bash"],
				denyExtensions: false,
				sources: ["test"],
			},
		});
		assert.deepEqual(plan.declaredBuiltinTools, ["bash"]);
		assert.deepEqual(plan.unavailableHostBuiltins, ["read", "grep"]);
	});
});

describe("mixed builtin and extension availability regression", () => {
	const reportTool = "governance_write_report";
	const auditTool = "governance_write_audit_result";
	const childExtension = "/fixture/governance-child.ts";
	// Exercise the actual builtin-only extractor, not an inventory widened to extension tools.
	const hostAvailableBuiltins = getHostBuiltinToolNames({
		getAllTools: () => [
			{ name: "read", sourceInfo: { source: "builtin" } },
			{ name: "bash", sourceInfo: { source: "builtin" } },
			{ name: reportTool, sourceInfo: { source: "extension" } },
			{ name: auditTool, sourceInfo: { source: "extension" } },
		],
	});

	it("preserves declared extension requirements beside real builtin availability without granting undeclared tools", () => {
		assert.deepEqual(hostAvailableBuiltins, ["read", "bash"]);
		const plan = resolvePiLaunchToolPlan({
			tools: ["read", "grep", reportTool, auditTool],
			hostAvailableBuiltins,
			subagentOnlyExtensions: [childExtension],
			capabilityCeiling: { version: 1, allowedTools: ["read", "grep", reportTool, auditTool, "undeclared_tool"], denyExtensions: false, sources: ["mixed-host"] },
		});
		assert.deepEqual(plan.effectiveToolAllowlist, ["read", reportTool, auditTool],
			"MIXED_HOST_EXTENSION_PRUNED: builtin-only availability must not erase declared extension requirements");
		assert.deepEqual(plan.requiredChildTools, ["read", reportTool, auditTool]);
		assert.deepEqual(plan.unavailableHostBuiltins, ["grep"]);
		assert.deepEqual(plan.capabilityAudit?.unavailableHostBuiltins, ["grep"]);
		assert.deepEqual(plan.configuredExtensions, [childExtension]);
		assert.equal(plan.effectiveToolAllowlist.includes("undeclared_tool"), false);
	});

	it("still denies extension names removed by either ceiling or explicit exclusions", () => {
		for (const restriction of [
			{ capabilityCeiling: { version: 1 as const, allowedTools: ["read"], sources: ["local-denial"] } },
			{ inheritedCapabilityCeiling: { version: 1 as const, allowedTools: ["read"], sources: ["inherited-denial"] } },
			{ excludeTools: [reportTool] },
		]) {
			const plan = resolvePiLaunchToolPlan({ tools: ["read", reportTool], hostAvailableBuiltins, ...restriction });
			assert.deepEqual(plan.effectiveToolAllowlist, ["read"]);
			assert.deepEqual(plan.requiredChildTools, ["read"]);
		}
	});

	it("denyExtensions still removes configured providers and disables ambient extension loading", () => {
		const plan = resolvePiLaunchToolPlan({
			tools: ["read", reportTool, "/fixture/tool.ts"], hostAvailableBuiltins,
			extensions: ["/fixture/ambient.ts"], subagentOnlyExtensions: [childExtension],
			capabilityCeiling: { version: 1, allowedTools: ["read", reportTool], denyExtensions: true, sources: ["extension-denial"] },
		});
		assert.equal(plan.disableAmbientExtensions, true);
		assert.deepEqual(plan.configuredExtensions, []);
		assert.deepEqual(plan.toolExtensionPaths, []);
		assert.equal(plan.extensionArgs.includes(childExtension), false);
		assert.equal(plan.capabilityAudit?.extensionsDenied, true);
		assert.equal(plan.capabilityAudit?.removedExtensionCount, 3);
	});

	it("does not relax mandatory read or native fanout restrictions in mixed plans", () => {
		assert.throws(() => resolvePiLaunchToolPlan({ tools: [reportTool], requireReadTool: true, hostAvailableBuiltins: ["bash"] }), /Host runtime does not provide required tool 'read'/);
		assert.throws(() => resolvePiLaunchToolPlan({ tools: [reportTool], requireReadTool: true, hostAvailableBuiltins,
			capabilityCeiling: { version: 1, allowedTools: [reportTool], sources: ["no-read"] } }), /excludes required tool 'read'/);
		assert.throws(() => resolvePiLaunchToolPlan({ tools: ["subagent_supervisor", reportTool], hostAvailableBuiltins }), /requires fanout authorization/);
	});

	it("retains unknown declared names as child requirements, not evidence that a provider exists", () => {
		const plan = resolvePiLaunchToolPlan({ tools: ["read", "fixture_unregistered_tool"], hostAvailableBuiltins });
		assert.deepEqual(plan.requiredChildTools, ["read", "fixture_unregistered_tool"],
			"Unknown declared names must reach genuine child required-tool validation instead of disappearing");
		assert.deepEqual(plan.configuredExtensions, []);
	});

	it("distinguishes absent from explicitly empty builtin inventory without erasing extension requirements", () => {
		const absent = resolvePiLaunchToolPlan({ tools: ["read", reportTool] });
		assert.deepEqual(absent.effectiveToolAllowlist, ["read", reportTool]);
		const empty = resolvePiLaunchToolPlan({ tools: ["read", reportTool], hostAvailableBuiltins: [] });
		assert.deepEqual(empty.effectiveToolAllowlist, [reportTool]);
		assert.deepEqual(empty.unavailableHostBuiltins, ["read"]);
	});
});

describe("planner helper coverage for the changed file", () => {
	it("normalizes supervisor channel segments without accepting separators", () => {
		assert.match(path.basename(supervisorChannelDir(" /run/ ", "---", 2)), /^run-unknown-2$/);
		assert.match(path.basename(supervisorChannelDir("root", "agent.name", 0)), /^root-agent.name-0$/);
	});
	it("preserves or replaces explicit thinking suffixes deliberately", () => {
		assert.equal(applyThinkingSuffix(undefined, "high"), undefined);
		assert.equal(applyThinkingSuffix("provider/model", false), "provider/model");
		assert.equal(applyThinkingSuffix("provider/model", "high"), "provider/model:high");
		assert.equal(applyThinkingSuffix("provider/model:low", "high"), "provider/model:low");
		assert.equal(applyThinkingSuffix("provider/model:low", "high", true), "provider/model:high");
	});
	it("requires explicit compatible fast-mode models and retains empty-extension warnings", () => {
		assert.throws(() => resolvePiLaunchToolPlan({ fast: true }), /explicit supported/);
		assert.throws(() => resolvePiLaunchToolPlan({ fast: true, agentName: "fixture" }), /fixture/);
		assert.throws(() => resolvePiLaunchToolPlan({ fast: true, model: "unsupported" }), /unsupported model/);
		assert.throws(() => resolvePiLaunchToolPlan({ fast: true, modelCandidates: ["a", "b"] }), /unsupported models/);
		assert.ok(resolvePiLaunchToolPlan({ fast: true, model: "openai-codex/gpt-5.6-sol:high" }).runtimeExtensions.some(p => p.endsWith("fast-mode-extension.ts")));
		assert.ok(resolvePiLaunchToolPlan({ extensions: [], agentName: "fixture" }).warnings.some(message => message.includes("disables ALL ambient")));
	});
});

describe("production launch path supplies hostAvailableBuiltins", () => {
	it("buildInProcessChildLaunch passes hostAvailableBuiltins to tool plan resolution", () => {
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagents-launch-builtins-"));
		const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
		process.env.PI_CODING_AGENT_DIR = cwd;
		try {
			const launch = buildInProcessChildLaunch({
				host: "runner",
				cwd,
				childAgentName: "test-agent",
				childIndex: 0,
				sessionEnabled: false,
				inheritProjectContext: false,
				inheritGlobalContext: false,
				inheritSkills: false,
				tools: ["read", "grep", "bash"],
				hostAvailableBuiltins: ["ipython", "bash"],
			});
			assert.deepEqual(launch.toolPlan.declaredBuiltinTools, ["bash"]);
			assert.deepEqual(launch.toolPlan.unavailableHostBuiltins, ["read", "grep"]);
			assert.deepEqual(launch.toolPlan.effectiveToolAllowlist, ["bash"]);
			assert.deepEqual(launch.warnings, [
				"Agent 'test-agent': host runtime tool availability omitted [read, grep]. Requested tool names: [read, grep, bash]; effective tool allowlist: [bash]. This is a non-fatal tool-plan diagnostic, not verification of the child's runtime tool menu.",
			]);
		} finally {
			if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
			else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
			fs.rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("getHostBuiltinToolNames extracts builtin tools from ExtensionAPI", () => {
		const mockPi = {
			getAllTools: () => [
				{ name: "read", sourceInfo: { source: "builtin" } },
				{ name: "bash", sourceInfo: { source: "auto" } },
				{ name: "custom-auto-tool", sourceInfo: { source: "auto" } },
				{ name: "custom-tool", sourceInfo: { source: "extension", path: "/ext/tool.ts" } },
				{ name: "mcp-tool", sourceInfo: { source: "mcp" } },
			],
		};
		const builtins = getHostBuiltinToolNames(mockPi);
		assert.deepEqual(builtins, ["read", "bash"]);
	});

	it("getHostBuiltinToolNames returns undefined on failure or empty results", () => {
		const throwingPi = {
			getAllTools: () => { throw new Error("Not available"); },
		};
		assert.equal(getHostBuiltinToolNames(throwingPi), undefined);

		const emptyPi = {
			getAllTools: () => [],
		};
		assert.equal(getHostBuiltinToolNames(emptyPi), undefined);

		const noBuiltinsPi = {
			getAllTools: () => [
				{ name: "custom-tool", sourceInfo: { source: "extension" } },
			],
		};
		assert.equal(getHostBuiltinToolNames(noBuiltinsPi), undefined);
	});
});
