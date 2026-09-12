import assert from "node:assert/strict";
import { setImmediate as waitImmediate } from "node:timers/promises";
import { describe, it } from "node:test";
import { resolveNativeChildLaunchIdentity } from "../../src/api/launch-identity.ts";
import { resolveNativeChildSettlement } from "../../src/api/native-settlement.ts";
import { buildInProcessChildLaunch } from "../../src/runs/shared/child-launch.ts";
import {
	childSessionFactory, childSessionFactoryModule, createDefaultChildSessionFactory, disposeChildSessions,
	setChildSessionFactory, setChildSessionFactoryModule, type ChildSessionFactory, type ChildSessionLaunch, type PiCodingAgentModule,
} from "../../src/runs/shared/child-session.ts";

function deferred() {
	let resolve!: () => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
	return { promise, resolve, reject };
}

function launch(): ChildSessionLaunch {
	return buildInProcessChildLaunch({
		host: "parent", cwd: process.cwd(), sessionEnabled: false,
		inheritProjectContext: false, inheritGlobalContext: false, inheritSkills: false,
		parentSessionId: "settlement-parent", runId: `settlement-${crypto.randomUUID()}`,
		childAgentName: "settlement-worker", childIndex: 0,
	}).session;
}

function fakePi(shutdowns: Array<Promise<void>>, disposed: string[]): PiCodingAgentModule {
	let sequence = 0;
	class Loader { loaded = false; async reload() {} }
	class Manager {
		readonly id = `settlement-child-${++sequence}`;
		getSessionId() { return this.id; }
		getSessionFile() { return undefined; }
		getEntries() { return []; }
		getLeafId() { return null; }
		getHeader() { return { type: "session", version: 3, id: this.id, cwd: process.cwd(), timestamp: new Date().toISOString() }; }
		static inMemory() { return new Manager(); }
	}
	class Session {
		readonly sessionId: string;
		readonly sessionManager: Manager;
		readonly messages: never[] = [];
		readonly model = undefined;
		readonly extensionRunner: { hasHandlers(): true; emit(): Promise<void> };
		constructor(sessionManager: Manager, shutdown: Promise<void>) {
			this.sessionManager = sessionManager;
			this.sessionId = sessionManager.getSessionId();
			this.extensionRunner = { hasHandlers: () => true, emit: () => shutdown };
		}
		async bindExtensions() {}
		dispose() { disposed.push(this.sessionId); }
		subscribe() { return () => {}; }
		async prompt() {}
		async abort() {}
		async steer() {}
		async followUp() {}
	}
	// SAFETY: this purpose-built SDK fixture implements every PiCodingAgentModule member the default child factory exercises.
	return {
		AgentSession: Session,
		ModelRuntime: { create: async () => ({}) },
		SettingsManager: { create: () => ({ getTheme: () => "dark" }) },
		DefaultResourceLoader: Loader,
		resolveCliModel: () => ({}),
		SessionManager: Manager,
		createAgentSession: async ({ sessionManager }: { sessionManager: Manager }) => ({ session: new Session(sessionManager, shutdowns.shift() ?? Promise.resolve()) }),
	} as PiCodingAgentModule;
}

async function observeBackgroundCompletion() {
	await waitImmediate();
	await waitImmediate();
}

describe("native child settlement observation", () => {
	it("preserves the process factory and runner-module controls around settlement-enabled factories", async () => {
		let disposed = 0;
		const scripted = { create: async () => { throw new Error("unused"); }, dispose: async () => { disposed++; } } satisfies ChildSessionFactory;
		setChildSessionFactory(scripted);
		setChildSessionFactoryModule("settlement-factory.ts");
		try {
			assert.equal(childSessionFactory(), scripted);
			assert.equal(childSessionFactoryModule(), "settlement-factory.ts");
			await disposeChildSessions();
			assert.equal(disposed, 1);
		} finally {
			setChildSessionFactory(undefined);
			setChildSessionFactoryModule(undefined);
		}
	});

	it("stays pending after the response timeout and settles only after the genuine handler set and finalizer complete", async () => {
		const gate = deferred();
		const disposed: string[] = [];
		const factory = createDefaultChildSessionFactory({ shutdownTimeoutMs: 5, loadPiCodingAgent: async () => fakePi([gate.promise], disposed) });
		const child = await factory.create(launch());
		const identity = resolveNativeChildLaunchIdentity(child);
		assert.equal(identity.verified, true);
		await child.dispose();
		assert.deepEqual(disposed, [child.sessionId], "factory finalizer must complete despite its response timeout");
		assert.deepEqual(resolveNativeChildSettlement(identity), { status: "pending", childSessionId: child.sessionId });
		gate.resolve();
		await observeBackgroundCompletion();
		assert.deepEqual(resolveNativeChildSettlement(identity), { status: "settled", childSessionId: child.sessionId });
	});

	it("reports handler-set rejection as error rather than successful cleanup", async () => {
		const gate = deferred();
		const factory = createDefaultChildSessionFactory({ shutdownTimeoutMs: 50, loadPiCodingAgent: async () => fakePi([gate.promise], []) });
		const child = await factory.create(launch());
		const identity = resolveNativeChildLaunchIdentity(child);
		gate.reject(new Error("shutdown failed"));
		await child.dispose();
		await observeBackgroundCompletion();
		assert.deepEqual(resolveNativeChildSettlement(identity), { status: "error", childSessionId: child.sessionId });
	});

	it("keeps unknown objects and siblings isolated by exact identity", async () => {
		const firstGate = deferred();
		const secondGate = deferred();
		const pi = fakePi([firstGate.promise, secondGate.promise], []);
		const factory = createDefaultChildSessionFactory({ shutdownTimeoutMs: 5, loadPiCodingAgent: async () => pi });
		const first = await factory.create(launch());
		const second = await factory.create(launch());
		const firstIdentity = resolveNativeChildLaunchIdentity(first);
		const secondIdentity = resolveNativeChildLaunchIdentity(second);
		await Promise.all([first.dispose(), second.dispose()]);
		assert.deepEqual(resolveNativeChildSettlement({ ...firstIdentity }), { status: "unknown" });
		firstGate.resolve();
		await observeBackgroundCompletion();
		assert.equal(resolveNativeChildSettlement(firstIdentity).status, "settled");
		assert.equal(resolveNativeChildSettlement(secondIdentity).status, "pending");
		secondGate.resolve();
		await observeBackgroundCompletion();
		assert.equal(resolveNativeChildSettlement(secondIdentity).status, "settled");
	});
});
