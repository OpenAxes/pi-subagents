import type { AgentSession, ExtensionContext, SessionManager } from "@earendil-works/pi-coding-agent";
import type { ChildSession } from "../runs/shared/child-session.ts";
import { resolveBoundNativeChildLaunchIdentity } from "../runs/shared/launch-identity.ts";
import type { ThinkingLevel } from "../shared/model-info.ts";

export interface NativeChildDelegationCorrelation {
	readonly requestId: string;
	readonly ownerRunId: string;
	readonly nodeId: string;
}

export interface NativeChildResolvedExtensions {
	readonly version: 1;
	readonly source: "launch-resolved";
	readonly disableAmbientExtensions: boolean;
	readonly runtime: readonly string[];
	readonly configured: readonly string[];
	readonly effective: readonly string[];
	readonly omitted: Readonly<{
		runtime: number;
		configured: number;
		effective: number;
	}>;
}

export interface NativeChildCapabilityCeiling {
	readonly version: 1;
	readonly allowedTools?: readonly string[];
	readonly allowedAgents?: readonly string[];
	readonly denyExtensions: boolean;
	readonly sources: readonly string[];
}

/** Bounded runtime projection of the effective native launch; prompts, callbacks, environment, auth, and approval state are intentionally absent. */
export interface NativeChildEffectiveLaunchContract {
	readonly launchContractDigest?: string;
	readonly context?: "fresh" | "fork";
	readonly cwd: string;
	readonly model?: string;
	readonly thinking?: string;
	readonly toolAllowlist?: readonly string[];
	readonly toolExclusions: readonly string[];
	readonly mcpTools: readonly string[];
	readonly extensionPaths: readonly string[];
	readonly ambientExtensions: boolean;
	readonly inheritProjectContext: boolean;
	readonly inheritGlobalContext: boolean;
	readonly inheritSkills: boolean;
	readonly fast: boolean;
	readonly resolvedExtensions: NativeChildResolvedExtensions;
	readonly capabilityCeiling?: NativeChildCapabilityCeiling;
	readonly thinkingCeiling?: ThinkingLevel;
}

export interface VerifiedNativeChildLaunchIdentity {
	readonly verified: true;
	readonly role: "native-child";
	readonly agent: string;
	/** Root of the host-recorded native-child lineage; not a human/root authority attestation. */
	readonly rootSessionId: string;
	readonly parentSessionId: string;
	readonly childSessionId: string;
	readonly correlation: Readonly<{
		runId: string;
		childIndex: number;
		delegation?: NativeChildDelegationCorrelation;
	}>;
	readonly contract: NativeChildEffectiveLaunchContract;
}

export interface UnverifiedLaunchIdentity {
	readonly verified: false;
	readonly role: "unverified";
}

export type NativeChildLaunchIdentityResult = VerifiedNativeChildLaunchIdentity | UnverifiedLaunchIdentity;
export type NativeChildLaunchIdentitySubject = AgentSession | ChildSession | SessionManager | ExtensionContext | null | undefined;

const UNVERIFIED: UnverifiedLaunchIdentity = Object.freeze({ verified: false, role: "unverified" });

/** Resolve only exact live objects bound by pi-subagents' native child factory. Unknown, stale, external, fake, or malformed subjects fail closed. */
export function resolveNativeChildLaunchIdentity(subject: NativeChildLaunchIdentitySubject): NativeChildLaunchIdentityResult {
	return resolveBoundNativeChildLaunchIdentity(subject) ?? UNVERIFIED;
}
