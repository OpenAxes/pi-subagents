import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { resolveNativeChildLaunchIdentity } from "../../src/api/launch-identity.ts";
import { buildInProcessChildLaunch, createReportedChildSessionInput, inheritedChildRuntime } from "../../src/runs/shared/child-launch.ts";
import { createDefaultChildSessionFactory, type ChildSession, type ChildSessionLaunch, type PiCodingAgentModule } from "../../src/runs/shared/child-session.ts";
import { bindNativeChildLaunchIdentity, consumeNativeChildLaunchCertificate, createNativeChildLaunchCertificate, finalizeNativeChildLaunchIdentity, reserveNativeChildLaunchCertificate } from "../../src/runs/shared/launch-identity.ts";
import { runSync } from "../../src/runs/foreground/execution.ts";
import { runSingleStepInner } from "../../src/runs/background/subagent-runner.ts";
import { requestReadonlySessionEvidence } from "../../src/runs/shared/readonly-session-evidence.ts";
import { agentDefinitionDigest } from "../../src/shared/launch-contract.ts";
import type { AgentConfig } from "../../src/agents/agents.ts";

function launch(parentSessionId = "parent-session", inherited?: ReturnType<typeof inheritedChildRuntime>) {
	return buildInProcessChildLaunch({
		host: "parent",
		cwd: process.cwd(),
		sessionEnabled: false,
		model: "openai-codex/gpt-5.6-sol:high",
		tools: ["read", "grep"],
		excludeTools: ["bash"],
		extensions: ["./fixture-extension.ts"],
		inheritProjectContext: true,
		inheritGlobalContext: false,
		inheritSkills: true,
		fast: false,
		parentSessionId,
		runId: "run-identity",
		childAgentName: "canonical-worker",
		childIndex: 2,
		inherited,
	});
}

interface FakeSdkManagerReference {
	getSessionId(): string;
}

interface FakeSdkSessionReference {
	readonly sessionId: string;
	readonly sessionManager: FakeSdkManagerReference;
}

interface FakeLoaderOptions {
	readonly cwd?: string;
}

function fakePi(onBind: (session: FakeSdkSessionReference, manager: FakeSdkManagerReference) => void = () => {}, mismatchManager = false): PiCodingAgentModule {
	let childNumber = 0;
	class Loader {
		loaded = false;
		constructor(_options: FakeLoaderOptions) {}
		async reload() {}
	}
	class Manager {
		private readonly id: string;
		private readonly file: string | undefined;
		constructor(id: string, file?: string) { this.id = id; this.file = file; }
		getSessionId() { return this.id; }
		getSessionFile() { return this.file; }
		getEntries() { return []; }
		getLeafId() { return null; }
		getHeader() { return { type: "session", version: 3, id: this.id, cwd: process.cwd(), timestamp: new Date().toISOString() }; }
		static inMemory() { return new Manager(`child-session-${++childNumber}`); }
		static open(file: string) { return new Manager(`child-session-${++childNumber}`, file); }
	}
	class Session {
		readonly sessionId: string;
		readonly sessionManager: Manager;
		readonly extensionRunner = { hasHandlers: () => false };
		readonly messages: never[] = [];
		readonly model = undefined;
		private readonly launchManager: Manager;
		constructor(launchManager: Manager) {
			this.launchManager = launchManager;
			this.sessionId = launchManager.getSessionId();
			this.sessionManager = mismatchManager ? new Manager(this.sessionId) : launchManager;
		}
		async bindExtensions() { onBind(this, this.launchManager); }
		dispose() {}
		subscribe() { return () => {}; }
		async prompt() {}
		async abort() {}
		async steer() {}
		async followUp() {}
	}
	// SAFETY: This controlled fixture implements every Pi module member read by createDefaultChildSessionFactory; constructor identity is deliberately preserved for provenance tests.
	return {
		AgentSession: Session,
		ModelRuntime: { create: async () => ({}) },
		SettingsManager: { create: () => ({ getTheme: () => "dark" }) },
		DefaultResourceLoader: Loader,
		resolveCliModel: () => ({}),
		SessionManager: Manager,
		createAgentSession: async (options: { sessionManager: Manager }) => ({ session: new Session(options.sessionManager) }),
	} as PiCodingAgentModule;
}

function consumeCertificate(launch: ChildSessionLaunch) {
	return consumeNativeChildLaunchCertificate(reserveNativeChildLaunchCertificate(launch), launch);
}

function isDeepFrozen(cause: unknown): boolean {
	if (cause === null || Object(cause) !== cause) return true;
	if (!Object.isFrozen(cause)) return false;
	// SAFETY: Equality with Object(cause) above establishes a non-null object before Reflect.ownKeys.
	const frozenObject = cause as object;
	return Reflect.ownKeys(frozenObject).every((key) => isDeepFrozen(Object.getOwnPropertyDescriptor(frozenObject, key)?.value));
}

describe("native child launch identity", () => {
	it("fails closed for outsiders, copied IDs, and throwing context getters", () => {
		const unverified = { verified: false, role: "unverified" };
		assert.deepEqual(resolveNativeChildLaunchIdentity(undefined), unverified);
		assert.deepEqual(resolveNativeChildLaunchIdentity({ getSessionId: () => "child-session-1" }), unverified);
		assert.deepEqual(resolveNativeChildLaunchIdentity({ sessionManager: { getSessionId: () => "child-session-1" } }), unverified);
		assert.deepEqual(resolveNativeChildLaunchIdentity(Object.defineProperty({}, "sessionManager", { get() { throw new Error("stale"); } })), unverified);
		assert.deepEqual(resolveNativeChildLaunchIdentity(() => {}), unverified);
		assert.strictEqual(resolveNativeChildLaunchIdentity({}), resolveNativeChildLaunchIdentity("outsider"));
		assert.equal(Object.isFrozen(resolveNativeChildLaunchIdentity(null)), true);
	});

	it("binds exact factory-owned session objects before extension startup and publishes a deeply frozen snapshot", async () => {
		const built = launch();
		finalizeNativeChildLaunchIdentity(built.session, {
			launchContractDigest: "actual-digest",
			context: "fork",
			thinking: "high",
			delegation: { requestId: "request-1", ownerRunId: "owner-1", nodeId: "node-1" },
		});
		let startupIdentity: ReturnType<typeof resolveNativeChildLaunchIdentity> | undefined;
		let rawSession: object | undefined;
		let manager: object | undefined;
		const factory = createDefaultChildSessionFactory({ loadPiCodingAgent: async () => fakePi((session, sessionManager) => {
			rawSession = session;
			manager = sessionManager;
			startupIdentity = resolveNativeChildLaunchIdentity({ sessionManager });
		}) });
		const child = await factory.create(createReportedChildSessionInput(built));
		const identity = resolveNativeChildLaunchIdentity(child);

		assert.strictEqual(identity, startupIdentity);
		assert.strictEqual(identity, resolveNativeChildLaunchIdentity(rawSession));
		assert.strictEqual(identity, resolveNativeChildLaunchIdentity(manager));
		assert.deepEqual(identity, {
			verified: true,
			role: "native-child",
			agent: "canonical-worker",
			rootSessionId: "parent-session",
			parentSessionId: "parent-session",
			childSessionId: "child-session-1",
			correlation: {
				runId: "run-identity",
				childIndex: 2,
				delegation: { requestId: "request-1", ownerRunId: "owner-1", nodeId: "node-1" },
			},
			contract: {
				launchContractDigest: "actual-digest",
				context: "fork",
				cwd: process.cwd(),
				model: "openai-codex/gpt-5.6-sol:high",
				thinking: "high",
				toolAllowlist: ["read", "grep"],
				toolExclusions: ["bash"],
				mcpTools: [],
				extensionPaths: ["./fixture-extension.ts"],
				ambientExtensions: false,
				inheritProjectContext: true,
				inheritGlobalContext: false,
				inheritSkills: true,
				fast: false,
				resolvedExtensions: built.launchResolvedExtensions,
			},
		});
		assert.equal(isDeepFrozen(identity), true);

		built.config.agent = "mutated";
		built.session.extensionPaths.push("later.ts");
		assert.equal(identity.verified && identity.agent, "canonical-worker");
		assert.deepEqual(identity.verified && identity.contract.extensionPaths, ["./fixture-extension.ts"]);
		await child.dispose();
		assert.equal(resolveNativeChildLaunchIdentity(child).verified, false);
		assert.equal(resolveNativeChildLaunchIdentity(rawSession).verified, false);
		assert.equal(resolveNativeChildLaunchIdentity({ sessionManager: manager }).verified, false);
	});

	it("does not bind when required host lineage is unavailable", async () => {
		const missingLineage = buildInProcessChildLaunch({
			host: "parent", cwd: process.cwd(), sessionEnabled: false,
			inheritProjectContext: false, inheritGlobalContext: false, inheritSkills: false,
			runId: "missing-lineage", childAgentName: "worker", childIndex: 0,
		});
		const factory = createDefaultChildSessionFactory({ loadPiCodingAgent: async () => fakePi() });
		const child = await factory.create(missingLineage.session);
		assert.equal(resolveNativeChildLaunchIdentity(child).verified, false);
		await child.dispose();
	});

	it("does not bind when the SDK session and manager objects disagree", async () => {
		let startupIdentity: ReturnType<typeof resolveNativeChildLaunchIdentity> | undefined;
		const factory = createDefaultChildSessionFactory({ loadPiCodingAgent: async () => fakePi((_session, manager) => {
			startupIdentity = resolveNativeChildLaunchIdentity(manager);
		}, true) });
		const child = await factory.create(launch().session);
		assert.equal(startupIdentity?.verified, false);
		assert.equal(resolveNativeChildLaunchIdentity(child).verified, false);
		await child.dispose();
	});

	it("rejects structural SDK session lookalikes at the native binding boundary", async () => {
		let rawSession: object | undefined;
		let manager: object | undefined;
		const pi = fakePi((session, value) => { rawSession = session; manager = value; });
		Object.assign(pi, { AgentSession: class StructuralLookalike {} });
		const factory = createDefaultChildSessionFactory({ loadPiCodingAgent: async () => pi });
		const child = await factory.create(launch().session);
		assert.equal(resolveNativeChildLaunchIdentity(rawSession).verified, false);
		assert.equal(resolveNativeChildLaunchIdentity(manager).verified, false);
		assert.equal(resolveNativeChildLaunchIdentity(child).verified, false);
		await child.dispose();
	});

	it("revalidates the launch after asynchronous SDK construction", async () => {
		const built = launch();
		let startupIdentity: ReturnType<typeof resolveNativeChildLaunchIdentity> | undefined;
		const pi = fakePi((_session, manager) => { startupIdentity = resolveNativeChildLaunchIdentity(manager); });
		const create = pi.createAgentSession;
		// SAFETY: The wrapper preserves the SDK factory signature and result while injecting one awaited test mutation.
		pi.createAgentSession = (async (options) => {
			const created = create(options);
			await Promise.resolve();
			built.config.agent = "mutated-during-create";
			return created;
		}) as PiCodingAgentModule["createAgentSession"];
		const factory = createDefaultChildSessionFactory({ loadPiCodingAgent: async () => pi });
		const child = await factory.create(built.session);
		assert.equal(startupIdentity?.verified, false);
		assert.equal(resolveNativeChildLaunchIdentity(child).verified, false);
		await child.dispose();
	});

	it("burns the reservation when SDK construction fails", async () => {
		const built = launch();
		const pi = fakePi();
		const create = pi.createAgentSession;
		let fail = true;
		// SAFETY: The wrapper preserves the SDK factory signature and either throws the scripted first failure or returns the real fixture result.
		pi.createAgentSession = (async (options) => {
			if (fail) {
				fail = false;
				throw new Error("SDK construction failed");
			}
			return create(options);
		}) as PiCodingAgentModule["createAgentSession"];
		const factory = createDefaultChildSessionFactory({ loadPiCodingAgent: async () => pi });
		await assert.rejects(factory.create(built.session), /SDK construction failed/);
		const retried = await factory.create(built.session);
		assert.equal(resolveNativeChildLaunchIdentity(retried).verified, false);
		const rebuilt = await factory.create(launch().session);
		assert.equal(resolveNativeChildLaunchIdentity(rebuilt).verified, true);
		await Promise.all([retried.dispose(), rebuilt.dispose()]);
	});

	it("revokes identity when extension binding fails", async () => {
		let rawSession: object | undefined;
		let manager: object | undefined;
		let startupIdentity: ReturnType<typeof resolveNativeChildLaunchIdentity> | undefined;
		const factory = createDefaultChildSessionFactory({ loadPiCodingAgent: async () => fakePi((session, value) => {
			rawSession = session;
			manager = value;
			startupIdentity = resolveNativeChildLaunchIdentity(value);
			throw new Error("bind failed");
		}) });
		await assert.rejects(factory.create(launch().session), /bind failed/);
		assert.equal(startupIdentity?.verified, true);
		assert.equal(resolveNativeChildLaunchIdentity(rawSession).verified, false);
		assert.equal(resolveNativeChildLaunchIdentity(manager).verified, false);
	});

	it("revokes identity when the readonly observer fails", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "launch-identity-observer-"));
		const built = buildInProcessChildLaunch({
			host: "parent", cwd, sessionEnabled: true, sessionFile: join(cwd, "child.jsonl"), model: "baseten/model-a",
			tools: ["read"], requireReadTool: true, allowNestedSubagents: false, waitToolEnabled: false,
			inheritProjectContext: false, inheritGlobalContext: false, inheritSkills: false,
			parentSessionId: "observer-parent", runId: "observer-run", childAgentName: "reader", childIndex: 0,
		});
		const input = createReportedChildSessionInput(built);
		requestReadonlySessionEvidence(input);
		let rawSession: object | undefined;
		let manager: object | undefined;
		let startupIdentity: ReturnType<typeof resolveNativeChildLaunchIdentity> | undefined;
		const pi = fakePi((session, value) => {
			rawSession = session;
			manager = value;
			startupIdentity = resolveNativeChildLaunchIdentity(value);
		});
		Object.assign(pi, { VERSION: "0.85.1" });
		const create = pi.createAgentSession;
		// SAFETY: The wrapper preserves the SDK factory signature and only installs the observer-failure getter on its controlled session.
		pi.createAgentSession = (async (options) => {
			const result = await create(options);
			Object.defineProperty(result.session, "model", { get() { throw new Error("readonly observer failed"); } });
			return result;
		}) as PiCodingAgentModule["createAgentSession"];
		const factory = createDefaultChildSessionFactory({ loadPiCodingAgent: async () => pi });
		try {
			await assert.rejects(factory.create(input), /readonly observer failed/);
			assert.equal(startupIdentity?.verified, true);
			assert.equal(resolveNativeChildLaunchIdentity(rawSession).verified, false);
			assert.equal(resolveNativeChildLaunchIdentity(manager).verified, false);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("attaches foreground and runner attempt context with the actual recomputed digest", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "launch-identity-hosts-"));
		const agent: AgentConfig = {
			name: "canonical-worker", description: "Fixture", source: "project", filePath: join(cwd, "worker.md"),
			systemPrompt: "Inspect only.", inheritProjectContext: false, inheritGlobalContext: false, inheritSkills: false,
			tools: ["read"], allowNestedSubagents: false,
		};
		try {
			let foregroundIdentity: ReturnType<typeof resolveNativeChildLaunchIdentity> | undefined;
			const foregroundFactory = createDefaultChildSessionFactory({ loadPiCodingAgent: async () => fakePi((_session, manager) => {
				foregroundIdentity = resolveNativeChildLaunchIdentity(manager);
			}) });
			const foreground = await runSync(cwd, [agent], agent.name, "Inspect evidence", {
				runId: "foreground-identity", parentSessionId: "foreground-parent", context: "fork",
				childSessionFactory: foregroundFactory, waitToolEnabled: false,
			});
			assert.equal(foregroundIdentity?.verified, true);
			if (foregroundIdentity?.verified) {
				assert.equal(foregroundIdentity.contract.context, "fork");
				assert.equal(foregroundIdentity.contract.launchContractDigest, foreground.launchContractDigest);
			}

			let runnerIdentity: ReturnType<typeof resolveNativeChildLaunchIdentity> | undefined;
			const runnerFactory = createDefaultChildSessionFactory({ loadPiCodingAgent: async () => fakePi((_session, manager) => {
				runnerIdentity = resolveNativeChildLaunchIdentity(manager);
			}) });
			const runner = await runSingleStepInner({
				...agent,
				agent: agent.name,
				task: "Inspect runner evidence",
				context: "fresh",
				parentSessionId: "runner-parent",
				definitionDigest: agentDefinitionDigest(agent),
				modelCandidates: [],
				waitToolEnabled: false,
			}, {
				cwd, id: "runner-identity", flatIndex: 0, flatStepCount: 1,
				previousOutput: "", placeholder: "{previous}", outputFile: join(cwd, "runner-output.log"),
				sessionEnabled: false, childSessions: runnerFactory,
			});
			assert.equal(runnerIdentity?.verified, true);
			if (runnerIdentity?.verified) {
				assert.equal(runnerIdentity.contract.context, "fresh");
				assert.equal(runnerIdentity.contract.launchContractDigest, runner.launchContractDigest);
			}
			await Promise.all([foregroundFactory.dispose(), runnerFactory.dispose()]);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("keeps root lineage across nested launches while changing the direct parent", async () => {
		const parent = launch("root-session");
		const nested = launch("direct-parent", inheritedChildRuntime(parent.config));
		let manager: object | undefined;
		const factory = createDefaultChildSessionFactory({ loadPiCodingAgent: async () => fakePi((_session, value) => { manager = value; }) });
		const child = await factory.create(nested.session);
		const identity = resolveNativeChildLaunchIdentity(manager);
		assert.equal(identity.verified, true);
		if (identity.verified) {
			assert.equal(identity.rootSessionId, "root-session");
			assert.equal(identity.parentSessionId, "direct-parent");
			assert.equal(identity.correlation.delegation, undefined);
		}
		await child.dispose();
	});

	it("revokes after abort and binds a fresh launch without reviving stale objects", async () => {
		const managers: object[] = [];
		const factory = createDefaultChildSessionFactory({ loadPiCodingAgent: async () => fakePi((_session, manager) => managers.push(manager)) });
		const first = await factory.create(launch().session);
		assert.equal(resolveNativeChildLaunchIdentity(managers[0]).verified, true);
		await first.abort();
		assert.equal(resolveNativeChildLaunchIdentity(managers[0]).verified, false);
		const resumed = await factory.create(launch().session);
		assert.equal(resolveNativeChildLaunchIdentity(managers[0]).verified, false);
		assert.equal(resolveNativeChildLaunchIdentity(managers[1]).verified, true);
		await resumed.dispose();
		await first.dispose();
	});

	it("fails closed across malformed private certificate and SDK object combinations", () => {
		const pi = fakePi();
		const nativeManager = (id: string) => Object.assign(Object.create(pi.SessionManager.prototype), { getSessionId: () => id });
		const nativeSession = (manager: FakeSdkManagerReference, id: string) => Object.assign(Object.create(pi.AgentSession.prototype), { sessionManager: manager, sessionId: id });
		const noHooks = launch();
		createNativeChildLaunchCertificate({ ...noHooks, session: { ...noHooks.session, hooks: [] } });
		assert.equal(finalizeNativeChildLaunchIdentity({ ...noHooks.session, hooks: [] }, {}), false);
		const wrongRuntime = launch();
		assert.equal(finalizeNativeChildLaunchIdentity({ ...wrongRuntime.session, runtime: { ...wrongRuntime.config } }, {}), false);
		const extraHook = launch();
		assert.equal(finalizeNativeChildLaunchIdentity({ ...extraHook.session, hooks: [...extraHook.session.hooks, extraHook.session.hooks[0]!] }, {}), false);
		const renamedHook = launch();
		assert.equal(finalizeNativeChildLaunchIdentity({ ...renamedHook.session, hooks: renamedHook.session.hooks.map((hook) => ({ ...hook, name: `changed:${hook.name}` })) }, {}), false);
		const poisonedHooks = launch();
		const poisoned = { ...poisonedHooks.session };
		Object.defineProperty(poisoned, "hooks", { get() { throw new Error("poisoned hooks"); } });
		assert.equal(finalizeNativeChildLaunchIdentity(poisoned, {}), false);
		assert.equal(consumeCertificate(poisoned), undefined);
		const poisonedRuntime = launch();
		const runtimeAccessor = { ...poisonedRuntime.session };
		Object.defineProperty(runtimeAccessor, "runtime", { get() { throw new Error("poisoned runtime"); } });
		assert.equal(consumeCertificate(runtimeAccessor), undefined);

		const finalized = launch();
		assert.equal(finalizeNativeChildLaunchIdentity(finalized.session, { launchContractDigest: "" }), false);
		assert.equal(finalizeNativeChildLaunchIdentity(finalized.session, { delegation: { requestId: "", ownerRunId: "owner", nodeId: "node" } }), false);
		assert.equal(finalizeNativeChildLaunchIdentity(finalized.session, { delegation: { requestId: "request", ownerRunId: "", nodeId: "node" } }), false);
		assert.equal(finalizeNativeChildLaunchIdentity(finalized.session, { delegation: { requestId: "request", ownerRunId: "owner", nodeId: "" } }), false);
		assert.equal(finalizeNativeChildLaunchIdentity(finalized.session, { context: "fresh" }), true);
		assert.equal(finalizeNativeChildLaunchIdentity(finalized.session, { context: "fork" }), false);

		const malformedObjects = launch();
		const certificate = consumeCertificate(malformedObjects.session);
		assert.equal(bindNativeChildLaunchIdentity(undefined, {}, {}, pi), undefined);
		assert.equal(bindNativeChildLaunchIdentity(certificate, null, {}, pi), undefined);
		assert.equal(bindNativeChildLaunchIdentity(certificate, {}, null, pi), undefined);
		assert.equal(bindNativeChildLaunchIdentity(certificate, {}, {}, pi), undefined);
		const wrongManager = nativeManager("child");
		assert.equal(bindNativeChildLaunchIdentity(certificate, nativeSession({}, "child"), wrongManager, pi), undefined);
		const noGetterManager = Object.create(pi.SessionManager.prototype);
		assert.equal(bindNativeChildLaunchIdentity(certificate, nativeSession(noGetterManager, "child"), noGetterManager, pi), undefined);
		const mismatchedIdManager = nativeManager("other");
		assert.equal(bindNativeChildLaunchIdentity(certificate, nativeSession(mismatchedIdManager, "child"), mismatchedIdManager, pi), undefined);
		const throwingManager = Object.assign(Object.create(pi.SessionManager.prototype), { getSessionId() { throw new Error("stale manager"); } });
		assert.equal(bindNativeChildLaunchIdentity(certificate, nativeSession(throwingManager, "child"), throwingManager, pi), undefined);

		for (const field of ["agent", "runId", "rootSessionId", "parentSessionId"] as const) {
			const built = launch();
			const owned = consumeCertificate(built.session);
			built.config[field] = "";
			const manager = nativeManager("child");
			assert.equal(bindNativeChildLaunchIdentity(owned, nativeSession(manager, "child"), manager, pi), undefined);
		}
		for (const childIndex of [undefined, -1, 0.5]) {
			const invalidIndex = launch();
			const invalidIndexCertificate = consumeCertificate(invalidIndex.session);
			invalidIndex.config.childIndex = childIndex;
			const manager = nativeManager("child");
			assert.equal(bindNativeChildLaunchIdentity(invalidIndexCertificate, nativeSession(manager, "child"), manager, pi), undefined);
		}
		const emptyChildId = launch();
		const emptyChildCertificate = consumeCertificate(emptyChildId.session);
		const emptyManager = nativeManager("");
		assert.equal(bindNativeChildLaunchIdentity(emptyChildCertificate, nativeSession(emptyManager, ""), emptyManager, pi), undefined);

		const valid = launch();
		const validCertificate = consumeCertificate(valid.session);
		const manager = nativeManager("direct-child");
		const raw = nativeSession(manager, "direct-child");
		const binding = bindNativeChildLaunchIdentity(validCertificate, raw, manager, pi);
		assert.ok(binding);
		// SAFETY: A deliberately minimal object exercises the private exact-object WeakMap binding without invoking ChildSession methods.
		const child = {} as ChildSession;
		binding.bindChild(child);
		binding.bindChild(child);
		assert.equal(resolveNativeChildLaunchIdentity(child).verified, true);
		binding.revoke();
		binding.revoke();
		// SAFETY: Revocation is asserted to reject a new deliberately minimal ChildSession reference before any member can be used.
		binding.bindChild({} as ChildSession);
		assert.equal(resolveNativeChildLaunchIdentity(child).verified, false);
	});

	it("projects already-resolved capability and thinking ceilings", async () => {
		const built = buildInProcessChildLaunch({
			host: "parent", cwd: process.cwd(), sessionEnabled: false, model: "openai-codex/gpt-5.6-sol:high",
			tools: ["read", "write"], inheritProjectContext: false, inheritGlobalContext: false, inheritSkills: false,
			parentSessionId: "parent", runId: "ceiling-run", childAgentName: "canonical-worker", childIndex: 0,
			thinkingCeiling: "high",
			capabilityCeiling: { version: 1, allowedTools: ["read"], allowedAgents: ["canonical-worker"], denyExtensions: true, sources: ["fixture"] },
		});
		const factory = createDefaultChildSessionFactory({ loadPiCodingAgent: async () => fakePi() });
		const child = await factory.create(built.session);
		const identity = resolveNativeChildLaunchIdentity(child);
		assert.equal(identity.verified, true);
		if (identity.verified) {
			assert.deepEqual(identity.contract.capabilityCeiling, built.config.capabilityCeiling);
			assert.equal(identity.contract.thinkingCeiling, "high");
			assert.deepEqual(identity.contract.toolAllowlist, ["read"]);
		}
		await child.dispose();
	});

	it("rejects replayed and modified launch certificates", async () => {
		const factory = createDefaultChildSessionFactory({ loadPiCodingAgent: async () => fakePi() });
		const original = launch();
		const first = await factory.create(original.session);
		assert.equal(resolveNativeChildLaunchIdentity(first).verified, true);
		const replay = await factory.create(original.session);
		assert.equal(resolveNativeChildLaunchIdentity(replay).verified, false);

		const modified = launch();
		const originalModel = modified.session.model;
		modified.session.model = "spoofed/model";
		const changed = await factory.create(modified.session);
		assert.equal(resolveNativeChildLaunchIdentity(changed).verified, false);
		modified.session.model = originalModel;
		const restored = await factory.create(modified.session);
		assert.equal(resolveNativeChildLaunchIdentity(restored).verified, false);
		await Promise.all([first.dispose(), replay.dispose(), changed.dispose(), restored.dispose()]);
	});
});
