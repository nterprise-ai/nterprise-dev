/** Generic ComponentSelections — maps family id → variant id */
export type ComponentSelections = Record<string, string>;

/** Describes a component family (e.g. "hero") with its available variants */
export interface ComponentFamily<T extends string = string> {
	id: string;
	displayName: string;
	instances: readonly T[];
	labels: Record<T, string>;
	defaultInstance: T;
}

/** Helper to infer keys from a FAMILIES map */
export type FamilyKey<T extends Record<string, ComponentFamily>> = keyof T & string;

/** PostMessage types — namespaced to avoid cross-app collisions */
export interface PreviewConfigMessage {
	type: `${string}_PREVIEW`;
	config: { componentSelections: ComponentSelections };
}

export interface ComponentClickMessage {
	type: `${string}_COMPONENT_CLICK`;
	family: string;
}

export type PreviewBridgeMessage = PreviewConfigMessage | ComponentClickMessage;
