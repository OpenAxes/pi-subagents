import type { NativeChildLaunchIdentitySubject } from "./launch-identity.ts";
import { resolveBoundNativeChildSettlement } from "../runs/shared/launch-identity.ts";

export type NativeChildSettlementObservation =
	| Readonly<{ status: "unknown" }>
	| Readonly<{ status: "pending"; childSessionId: string }>
	| Readonly<{ status: "settled"; childSessionId: string }>
	| Readonly<{ status: "error"; childSessionId: string }>;

/** Read only the actual factory-owned shutdown/finalizer settlement for one exact identity snapshot. */
export function resolveNativeChildSettlement(subject: NativeChildLaunchIdentitySubject): NativeChildSettlementObservation {
	return resolveBoundNativeChildSettlement(subject);
}
