export const PROGRAMMABLE_REGISTRY_REPOSITORY = "0xprogrammable/programmable-registry";
export const PROGRAMMABLE_REGISTRY_DEFAULT_BRANCH = "main";
export const PROGRAMMABLE_REGISTRY_INTAKE_DIRECTORY = "submissions";
export const PROGRAMMABLE_REGISTRY_INTAKE_STATES = Object.freeze([
  "prelaunch",
  "open",
  "paused-new",
  "paused-all"
]);

const intakeStates = new Set(PROGRAMMABLE_REGISTRY_INTAKE_STATES);

export function isProgrammableRegistryActiveIntake(value) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && value.baseBranch === PROGRAMMABLE_REGISTRY_DEFAULT_BRANCH
    && value.directory === PROGRAMMABLE_REGISTRY_INTAKE_DIRECTORY
    && value.repository === PROGRAMMABLE_REGISTRY_REPOSITORY
    && intakeStates.has(value.state);
}
