export type MfaAssuranceState = {
  currentLevel: "aal1" | "aal2" | null;
  nextLevel?: "aal1" | "aal2" | null;
  enrolled: boolean;
  enforcementEnabled: boolean;
};

/**
 * Progressive rollout: do not lock an existing administrator before their
 * first enrollment. A verified factor or the explicit global gate makes AAL2
 * mandatory for sensitive operations.
 */
export function needsAdminAal2(state: MfaAssuranceState): boolean {
  return (
    state.currentLevel !== "aal2" &&
    (state.enrolled || state.nextLevel === "aal2" || state.enforcementEnabled)
  );
}
