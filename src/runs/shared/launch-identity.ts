import { createHash } from "node:crypto";
import type { AgentSession, SessionManager } from "@earendil-works/pi-coding-agent";
import type {
	NativeChildDelegationCorrelation,
	NativeChildEffectiveLaunchContract,
	NativeChildLaunchIdentitySubject,
	NativeChildResolvedExtensions,
	VerifiedNativeChildLaunchIdentity,
} from "../../api/launch-identity.ts";
import type { NativeChildSettlementObservation } from "../../api/native-settlement.ts";
import type { LaunchResolvedChildExtensions } from "../../shared/types.ts";
import type { PiLaunchToolPlan } from "./child-tool-plan.ts";
import type { ChildRuntimeConfig } from "./child-runtime-config.ts";
import type { ChildSession, ChildSessionLaunch, PiCodingAgentModule } from "./child-session.ts";

export interface NativeChildLaunchFinalization {
	launchContractDigest?: string;
	context?: "fresh" | "fork";
	thinking?: string;
	delegation?: NativeChildDelegationCorrelation;
}

interface LaunchCertificate {
	runtime: ChildRuntimeConfig;
	factories: Array<ChildSessionLaunch["hooks"][number]["factory"]>;
	hookNames: string[];
	expected: string;
	contract: NativeChildEffectiveLaunchContract;
	finalization?: NativeChildLaunchFinalization;
	reserved: boolean;
}

export interface NativeChildLaunchReservation {
	readonly kind: "native-child-launch-reservation";
}

interface NativeBinding {
	identity: VerifiedNativeChildLaunchIdentity;
	session: AgentSession;
	manager: SessionManager;
	child?: ChildSession;
	revoked: boolean;
}

const certificates = new WeakMap<ChildSessionLaunch["hooks"][number]["factory"], LaunchCertificate>();
const reservations = new WeakMap<NativeChildLaunchReservation, LaunchCertificate>();

interface NativeBindingRegistry {
	sessions: WeakMap<object, NativeBinding>;
	managers: WeakMap<object, NativeBinding>;
	children: WeakMap<object, NativeBinding>;
}

declare global {
	// Shared by the host module and separately loaded ambient extension module instances.
	var __PI_SUBAGENTS_NATIVE_CHILD_LAUNCH_IDENTITY_REGISTRY__: NativeBindingRegistry | undefined;
}

/** Pi may load an ambient TypeScript extension through a separate module loader; share only exact-object binding maps. */
function bindingRegistry(): NativeBindingRegistry {
	globalThis.__PI_SUBAGENTS_NATIVE_CHILD_LAUNCH_IDENTITY_REGISTRY__ ??= {
		sessions: new WeakMap(),
		managers: new WeakMap(),
		children: new WeakMap(),
	};
	return globalThis.__PI_SUBAGENTS_NATIVE_CHILD_LAUNCH_IDENTITY_REGISTRY__;
}

const { sessions, managers, children } = bindingRegistry();
const UNKNOWN_SETTLEMENT: NativeChildSettlementObservation = Object.freeze({ status: "unknown" });
interface NativeSettlementRecord {
	childSessionId: string;
	handlers: "pending" | "settled" | "error";
	finalizer: "pending" | "settled" | "error";
	observation: NativeChildSettlementObservation;
}
const settlements = new WeakMap<object, NativeSettlementRecord>();

function refreshSettlement(record: NativeSettlementRecord): void {
	const status = record.handlers === "error" || record.finalizer === "error"
		? "error"
		: record.handlers === "settled" && record.finalizer === "settled" ? "settled" : "pending";
	record.observation = Object.freeze({ status, childSessionId: record.childSessionId });
}

/** Package-private implementation behind the exact-object public read API. */
export function resolveBoundNativeChildSettlement(subject: NativeChildLaunchIdentitySubject): NativeChildSettlementObservation {
	if (!subject) return UNKNOWN_SETTLEMENT;
	return settlements.get(subject)?.observation ?? UNKNOWN_SETTLEMENT;
}

function frozenStrings(values: readonly string[]): readonly string[] {
	return Object.freeze([...values]);
}

function frozenResolvedExtensions(value: LaunchResolvedChildExtensions | NativeChildResolvedExtensions): NativeChildResolvedExtensions {
	return Object.freeze({
		version: 1,
		source: "launch-resolved",
		disableAmbientExtensions: value.disableAmbientExtensions,
		runtime: frozenStrings(value.runtime),
		configured: frozenStrings(value.configured),
		effective: frozenStrings(value.effective),
		omitted: Object.freeze({
			runtime: value.omitted.runtime,
			configured: value.omitted.configured,
			effective: value.omitted.effective,
		}),
	});
}

function frozenContract(value: NativeChildEffectiveLaunchContract): NativeChildEffectiveLaunchContract {
	const contract = {
		cwd: value.cwd,
		toolExclusions: frozenStrings(value.toolExclusions),
		mcpTools: frozenStrings(value.mcpTools),
		extensionPaths: frozenStrings(value.extensionPaths),
		ambientExtensions: value.ambientExtensions,
		inheritProjectContext: value.inheritProjectContext,
		inheritGlobalContext: value.inheritGlobalContext,
		inheritSkills: value.inheritSkills,
		fast: value.fast,
		resolvedExtensions: frozenResolvedExtensions(value.resolvedExtensions),
	};
	if (value.launchContractDigest !== undefined) Object.assign(contract, { launchContractDigest: value.launchContractDigest });
	if (value.context !== undefined) Object.assign(contract, { context: value.context });
	if (value.model !== undefined) Object.assign(contract, { model: value.model });
	if (value.thinking !== undefined) Object.assign(contract, { thinking: value.thinking });
	if (value.toolAllowlist !== undefined) Object.assign(contract, { toolAllowlist: frozenStrings(value.toolAllowlist) });
	if (value.capabilityCeiling !== undefined) {
		const capabilityCeiling = {
			version: 1 as const,
			denyExtensions: value.capabilityCeiling.denyExtensions,
			sources: frozenStrings(value.capabilityCeiling.sources),
		};
		if (value.capabilityCeiling.allowedTools !== undefined) Object.assign(capabilityCeiling, { allowedTools: frozenStrings(value.capabilityCeiling.allowedTools) });
		if (value.capabilityCeiling.allowedAgents !== undefined) Object.assign(capabilityCeiling, { allowedAgents: frozenStrings(value.capabilityCeiling.allowedAgents) });
		Object.assign(contract, { capabilityCeiling: Object.freeze(capabilityCeiling) });
	}
	if (value.thinkingCeiling !== undefined) Object.assign(contract, { thinkingCeiling: value.thinkingCeiling });
	return Object.freeze(contract);
}

function frozenFinalization(value: NativeChildLaunchFinalization): NativeChildLaunchFinalization {
	const finalization = {};
	if (value.launchContractDigest !== undefined) Object.assign(finalization, { launchContractDigest: value.launchContractDigest });
	if (value.context !== undefined) Object.assign(finalization, { context: value.context });
	if (value.thinking !== undefined) Object.assign(finalization, { thinking: value.thinking });
	if (value.delegation !== undefined) Object.assign(finalization, {
		delegation: Object.freeze({
			requestId: value.delegation.requestId,
			ownerRunId: value.delegation.ownerRunId,
			nodeId: value.delegation.nodeId,
		}),
	});
	return Object.freeze(finalization);
}

type CertifiedLaunch = Pick<ChildSessionLaunch, "cwd" | "storage" | "model" | "tools" | "excludeTools" | "extensionPaths" | "ambientExtensions" | "hooks" | "noSkills" | "noContextFiles" | "systemPrompt" | "appendSystemPrompt" | "processEnv" | "runtime">;

function launchFingerprint(launch: CertifiedLaunch): string {
	const serialized = JSON.stringify({
		cwd: launch.cwd,
		storage: launch.storage,
		model: launch.model,
		tools: launch.tools,
		excludeTools: launch.excludeTools,
		extensionPaths: launch.extensionPaths,
		ambientExtensions: launch.ambientExtensions,
		noSkills: launch.noSkills,
		noContextFiles: launch.noContextFiles,
		systemPrompt: launch.systemPrompt,
		appendSystemPrompt: launch.appendSystemPrompt,
		processEnv: launch.processEnv,
		hookNames: launch.hooks.map((hook) => hook.name),
		config: launch.runtime,
	});
	return createHash("sha256").update(serialized).digest("hex");
}

function certificateMatches(launch: CertifiedLaunch, certificate: LaunchCertificate): boolean {
	try {
		if (certificate.runtime !== launch.runtime || certificate.factories.length !== launch.hooks.length) return false;
		if (!certificate.factories.every((factory, index) => factory === launch.hooks[index]?.factory && certificate.hookNames[index] === launch.hooks[index]?.name)) return false;
		return certificate.expected === launchFingerprint(launch);
	} catch {
		return false;
	}
}

function certificateFor(launch: CertifiedLaunch): LaunchCertificate | undefined {
	try {
		const first = launch.hooks[0]?.factory;
		if (!first) return undefined;
		const certificate = certificates.get(first);
		return certificate && certificateMatches(launch, certificate) ? certificate : undefined;
	} catch {
		return undefined;
	}
}

/** Create launch-owned one-use proof from the common builder's exact hook/config objects. */
export function createNativeChildLaunchCertificate(input: {
	session: Omit<ChildSessionLaunch, "onExtensionError">;
	toolPlan: PiLaunchToolPlan;
	launchResolvedExtensions: LaunchResolvedChildExtensions;
}): void {
	const first = input.session.hooks[0]?.factory;
	if (!first) return;
	const contract = {
		cwd: input.session.cwd,
		toolExclusions: [...input.toolPlan.excludeTools],
		mcpTools: [...input.toolPlan.effectiveMcpTools],
		extensionPaths: [...input.session.extensionPaths],
		ambientExtensions: input.session.ambientExtensions,
		inheritProjectContext: input.session.runtime.inheritProjectContext === true,
		inheritGlobalContext: input.session.runtime.inheritGlobalContext === true,
		inheritSkills: input.session.runtime.inheritSkills === true,
		fast: input.session.runtime.fast,
		resolvedExtensions: input.launchResolvedExtensions,
	};
	if (input.session.model !== undefined) Object.assign(contract, { model: input.session.model });
	if (input.toolPlan.explicitToolAllowlist) Object.assign(contract, { toolAllowlist: [...input.toolPlan.effectiveToolAllowlist] });
	if (input.session.runtime.capabilityCeiling !== undefined) Object.assign(contract, { capabilityCeiling: input.session.runtime.capabilityCeiling });
	if (input.session.runtime.thinkingCeiling !== undefined) Object.assign(contract, { thinkingCeiling: input.session.runtime.thinkingCeiling });
	certificates.set(first, {
		runtime: input.session.runtime,
		factories: input.session.hooks.map((hook) => hook.factory),
		hookNames: input.session.hooks.map((hook) => hook.name),
		expected: launchFingerprint(input.session),
		contract: frozenContract(contract),
		reserved: false,
	});
}

/** Add attempt-specific facts after execution recomputes them, without exposing a registration API. */
export function finalizeNativeChildLaunchIdentity(launch: ChildSessionLaunch | Omit<ChildSessionLaunch, "onExtensionError">, finalization: NativeChildLaunchFinalization): boolean {
	const certificate = certificateFor(launch);
	if (!certificate || certificate.reserved || certificate.finalization) return false;
	if (finalization.launchContractDigest !== undefined && !nonEmpty(finalization.launchContractDigest)) return false;
	if (finalization.delegation && (!nonEmpty(finalization.delegation.requestId) || !nonEmpty(finalization.delegation.ownerRunId) || !nonEmpty(finalization.delegation.nodeId))) return false;
	certificate.finalization = frozenFinalization(finalization);
	return true;
}

/** Reserve and burn the builder-owned certificate before any asynchronous SDK startup. */
export function reserveNativeChildLaunchCertificate(launch: ChildSessionLaunch): NativeChildLaunchReservation | undefined {
	try {
		const first = launch.hooks[0]?.factory;
		if (!first) return undefined;
		const certificate = certificates.get(first);
		if (!certificate || certificate.reserved) return undefined;
		certificate.reserved = true;
		certificates.delete(first);
		const reservation = Object.freeze({ kind: "native-child-launch-reservation" as const });
		reservations.set(reservation, certificate);
		return reservation;
	} catch {
		return undefined;
	}
}

/** Consume the stable reservation after SDK construction and revalidate the complete launch before binding. */
export function consumeNativeChildLaunchCertificate(reservation: NativeChildLaunchReservation | undefined, launch: ChildSessionLaunch): LaunchCertificate | undefined {
	if (!reservation) return undefined;
	const certificate = reservations.get(reservation);
	if (!certificate) return undefined;
	reservations.delete(reservation);
	return certificateMatches(launch, certificate) ? certificate : undefined;
}

function nonEmpty(value: string | undefined): value is string {
	return value !== undefined && value.trim().length > 0;
}

/** Verify and bind actual instances from the loaded SDK before extension startup. */
export function bindNativeChildLaunchIdentity(
	certificate: LaunchCertificate | undefined,
	session: AgentSession,
	manager: SessionManager,
	pi: Pick<PiCodingAgentModule, "AgentSession" | "SessionManager">,
): { bindChild(child: ChildSession): void; observeShutdownHandlers(completion: Promise<void>): void; completeFinalizer(): void; failFinalizer(): void; revoke(): void } | undefined {
	if (!certificate) return undefined;
	try {
		if (!(session instanceof pi.AgentSession) || !(manager instanceof pi.SessionManager)) return undefined;
		const runtime = certificate.runtime;
		const childSessionId = session.sessionId;
		if (session.sessionManager !== manager || childSessionId !== manager.getSessionId()) return undefined;
		if (!nonEmpty(runtime.agent) || !nonEmpty(runtime.runId) || !nonEmpty(runtime.rootSessionId) || !nonEmpty(runtime.parentSessionId) || !nonEmpty(childSessionId)) return undefined;
		if (!Number.isInteger(runtime.childIndex) || runtime.childIndex === undefined || runtime.childIndex < 0) return undefined;
		const finalization = certificate.finalization;
		const contract = { ...certificate.contract };
		if (finalization?.launchContractDigest !== undefined) Object.assign(contract, { launchContractDigest: finalization.launchContractDigest });
		if (finalization?.context !== undefined) Object.assign(contract, { context: finalization.context });
		if (finalization?.thinking !== undefined) Object.assign(contract, { thinking: finalization.thinking });
		const correlation = { runId: runtime.runId, childIndex: runtime.childIndex };
		if (finalization?.delegation !== undefined) Object.assign(correlation, { delegation: finalization.delegation });
		const identity: VerifiedNativeChildLaunchIdentity = Object.freeze({
			verified: true,
			role: "native-child",
			agent: runtime.agent,
			rootSessionId: runtime.rootSessionId,
			parentSessionId: runtime.parentSessionId,
			childSessionId,
			correlation: Object.freeze(correlation),
			contract: frozenContract(contract),
		});
		const binding: NativeBinding = { identity, session, manager, revoked: false };
		const settlement: NativeSettlementRecord = {
			childSessionId, handlers: "pending", finalizer: "pending",
			observation: Object.freeze({ status: "pending", childSessionId }),
		};
		settlements.set(identity, settlement);
		sessions.set(session, binding);
		managers.set(manager, binding);
		return {
			bindChild(child) {
				if (binding.revoked || binding.child) return;
				binding.child = child;
				children.set(child, binding);
			},
			observeShutdownHandlers(completion) {
				void completion.then(() => {
					settlement.handlers = "settled";
					refreshSettlement(settlement);
				}, () => {
					settlement.handlers = "error";
					refreshSettlement(settlement);
				});
			},
			completeFinalizer() {
				settlement.finalizer = "settled";
				refreshSettlement(settlement);
			},
			failFinalizer() {
				settlement.finalizer = "error";
				refreshSettlement(settlement);
			},
			revoke() {
				if (binding.revoked) return;
				binding.revoked = true;
				sessions.delete(binding.session);
				managers.delete(binding.manager);
				if (binding.child) children.delete(binding.child);
			},
		};
	} catch {
		return undefined;
	}
}

/** Package-private resolver used by the public fail-closed API. */
export function resolveBoundNativeChildLaunchIdentity(subject: NativeChildLaunchIdentitySubject): VerifiedNativeChildLaunchIdentity | undefined {
	if (subject === null || subject === undefined) return undefined;
	try {
		const direct = sessions.get(subject) ?? managers.get(subject) ?? children.get(subject);
		if (direct && !direct.revoked) return direct.identity;
		// SAFETY: Exact-object lookups failed; this read only supports an SDK ExtensionContext and the surrounding catch rejects malformed JavaScript callers.
		const manager = (subject as { readonly sessionManager?: SessionManager }).sessionManager;
		if (manager === undefined) return undefined;
		const contextual = managers.get(manager);
		return contextual && !contextual.revoked ? contextual.identity : undefined;
	} catch {
		return undefined;
	}
}
