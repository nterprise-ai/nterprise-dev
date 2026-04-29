/**
 * OKLCH Color Engine for Per-Tenant Theming
 *
 * Converts hex colors to OKLCH format for CSS variables
 * and generates derived colors for the full shadcn theme palette.
 *
 * OKLCH is a perceptually uniform color space that provides:
 * - Better color interpolation than HSL
 * - More predictable lightness adjustments
 * - Wider gamut support for modern displays
 */

import { oklch, parse, rgb } from "culori";
import type { ComponentSelections } from "../website-builder/types.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ThemePreset = "nova" | "vega" | "maia" | "lyra" | "mira";

export interface PresetPalette {
	primary: string;
	secondary: string;
	accent: string;
	background: string;
	neutral: string;
}

export interface PresetStyles {
	/** Border radius value */
	radius: string;
	/** Spacing multiplier (1 = default) */
	spacingScale: number;
	/** Font weight for headings */
	fontWeight: "normal" | "medium" | "semibold";
	/** Border style description */
	borderStyle: "sharp" | "rounded" | "soft";
	/** CSS class name for the preset */
	className: string;
	/** Default color palette for this preset */
	palette: PresetPalette;
	/** Default component layout selections for this preset */
	componentSelections: ComponentSelections;
}

export interface TenantThemeConfig {
	preset: ThemePreset;
	primaryColor: string; // hex
	secondaryColor?: string; // hex
	accentColor?: string; // hex
}

// ─── Preset Definitions ───────────────────────────────────────────────────────

/**
 * ShadCN Style Presets
 *
 * Defines the visual characteristics for each preset:
 * - Vega: Classic shadcn/ui look
 * - Nova: Compact with reduced padding/margins
 * - Maia: Soft and rounded with generous spacing
 * - Lyra: Boxy and sharp, pairs well with mono fonts
 * - Mira: Dense and efficient for data-heavy interfaces
 */
export const presetStyles: Record<ThemePreset, PresetStyles> = {
	vega: {
		radius: "0.625rem",
		spacingScale: 1,
		fontWeight: "medium",
		borderStyle: "rounded",
		className: "preset-vega",
		palette: {
			primary: "#2563eb",
			secondary: "#1d4ed8",
			accent: "#f59e0b",
			background: "#ffffff",
			neutral: "#6b7280",
		},
		componentSelections: { hero: "hero-1", auctionCard: "auction-card-1" },
	},
	nova: {
		radius: "0.5rem",
		spacingScale: 0.875,
		fontWeight: "medium",
		borderStyle: "rounded",
		className: "preset-nova",
		palette: {
			primary: "#1e3a5f",
			secondary: "#16213e",
			accent: "#e94560",
			background: "#f8fafc",
			neutral: "#64748b",
		},
		componentSelections: { hero: "hero-2", auctionCard: "auction-card-1" },
	},
	maia: {
		radius: "1rem",
		spacingScale: 1.125,
		fontWeight: "normal",
		borderStyle: "soft",
		className: "preset-maia",
		palette: {
			primary: "#7c3aed",
			secondary: "#6d28d9",
			accent: "#ec4899",
			background: "#fdfcff",
			neutral: "#8b5cf6",
		},
		componentSelections: { hero: "hero-1", auctionCard: "auction-card-1" },
	},
	lyra: {
		radius: "0",
		spacingScale: 1,
		fontWeight: "semibold",
		borderStyle: "sharp",
		className: "preset-lyra",
		palette: {
			primary: "#1a1a1a",
			secondary: "#2d2d2d",
			accent: "#dc2626",
			background: "#f9f9f9",
			neutral: "#4b4b4b",
		},
		componentSelections: { hero: "hero-3", auctionCard: "auction-card-2" },
	},
	mira: {
		radius: "0.25rem",
		spacingScale: 0.75,
		fontWeight: "medium",
		borderStyle: "rounded",
		className: "preset-mira",
		palette: {
			primary: "#0f172a",
			secondary: "#1e293b",
			accent: "#0ea5e9",
			background: "#f0f4f8",
			neutral: "#475569",
		},
		componentSelections: { hero: "hero-2", auctionCard: "auction-card-2" },
	},
};

// ─── Color Constants ──────────────────────────────────────────────────────────

/** Light foreground color (cream/almost white) - matches globals.css */
const LIGHT_FOREGROUND = "oklch(0.965 0.006 84.6)";
/** Dark foreground color (stone-800) - matches globals.css */
const DARK_FOREGROUND = "oklch(0.308 0.010 73.5)";

/** Default light mode color values */
const defaultColors = {
	background: "oklch(0.982 0.003 84.6)", // Ivory #faf9f7
	foreground: "oklch(0.308 0.010 73.5)", // Stone-800 #332f2a
	card: "oklch(1.000 0 0)", // White #ffffff
	cardForeground: "oklch(0.308 0.010 73.5)", // Stone-800
	popover: "oklch(1.000 0 0)", // White
	popoverForeground: "oklch(0.308 0.010 73.5)", // Stone-800
	muted: "oklch(0.965 0.006 84.6)", // Cream #f5f3ef
	mutedForeground: "oklch(0.569 0.020 81.3)", // Stone-500 #7d766a
	border: "oklch(0.861 0.011 89.7)", // Stone-200 #d4d1c9
	input: "oklch(0.861 0.011 89.7)", // Stone-200
	destructive: "oklch(0.458 0.155 18.0)", // Burgundy #9B2335
	destructiveForeground: "oklch(1.000 0 0)", // White
};

/** Dark mode default colors */
const darkDefaultColors = {
	background: "oklch(0.219 0.007 78.2)", // Stone-900 #1c1a17
	foreground: "oklch(0.965 0.006 84.6)", // Cream #f5f3ef
	card: "oklch(0.308 0.010 73.5)", // Stone-800 #332f2a
	cardForeground: "oklch(0.965 0.006 84.6)", // Cream
	popover: "oklch(0.308 0.010 73.5)", // Stone-800
	popoverForeground: "oklch(0.965 0.006 84.6)", // Cream
	muted: "oklch(0.393 0.015 79.7)", // Stone-700 #4a453d
	mutedForeground: "oklch(0.767 0.018 88.0)", // Stone-300 #b8b3a7
	border: "oklch(0.481 0.017 80.6)", // Stone-600 #635d53
	input: "oklch(0.481 0.017 80.6)", // Stone-600
	destructive: "oklch(0.514 0.170 18.1)", // Burgundy-light #B42D40
	destructiveForeground: "oklch(1.000 0 0)", // White
};

// ─── Color Utilities ──────────────────────────────────────────────────────────

/**
 * Calculate relative luminance per WCAG 2.1 specification.
 * https://www.w3.org/WAI/GL/wiki/Relative_luminance
 */
export function getRelativeLuminance(hex: string): number {
	try {
		const color = parse(hex);
		if (!color) return 0;

		const rgbColor = rgb(color);
		if (!rgbColor) return 0;

		const r = rgbColor.r ?? 0;
		const g = rgbColor.g ?? 0;
		const b = rgbColor.b ?? 0;

		const toLinear = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

		const rLinear = toLinear(r);
		const gLinear = toLinear(g);
		const bLinear = toLinear(b);

		return 0.2126 * rLinear + 0.7152 * gLinear + 0.0722 * bLinear;
	} catch {
		return 0;
	}
}

/**
 * Convert hex color to OKLCH CSS format.
 * Returns format: oklch(L C H) where L=0-1, C=0-0.4, H=0-360
 */
export function hexToOklch(hex: string): string {
	try {
		const color = parse(hex);
		if (!color) return hex;

		const oklchColor = oklch(color);
		if (!oklchColor) return hex;

		const l = (oklchColor.l ?? 0).toFixed(3);
		const c = (oklchColor.c ?? 0).toFixed(3);
		const h = oklchColor.h ? oklchColor.h.toFixed(1) : "0";

		return `oklch(${l} ${c} ${h})`;
	} catch {
		return hex;
	}
}

/**
 * Adjust lightness of a color expressed as hex.
 * In OKLCH, lightness (L) ranges from 0 to 1.
 */
export function adjustLightness(hex: string, amount: number): string {
	try {
		const color = parse(hex);
		if (!color) return hexToOklch(hex);

		const oklchColor = oklch(color);
		if (!oklchColor) return hexToOklch(hex);

		oklchColor.l = Math.max(0, Math.min(1, (oklchColor.l ?? 0.5) + amount));

		const l = oklchColor.l.toFixed(3);
		const c = (oklchColor.c ?? 0).toFixed(3);
		const h = oklchColor.h ? oklchColor.h.toFixed(1) : "0";

		return `oklch(${l} ${c} ${h})`;
	} catch {
		return hexToOklch(hex);
	}
}

/**
 * Determine optimal foreground color for text on a given background.
 * Uses WCAG relative luminance to ensure proper contrast.
 */
function getForegroundColor(hex: string): string {
	const luminance = getRelativeLuminance(hex);
	return luminance > 0.179 ? DARK_FOREGROUND : LIGHT_FOREGROUND;
}

// ─── Theme Variable Generators ────────────────────────────────────────────────

/**
 * Generate CSS variables for a tenant theme (light mode).
 * All colors are output in OKLCH format.
 */
export function generateThemeVariables(config: TenantThemeConfig): Record<string, string> {
	const { preset, primaryColor, secondaryColor, accentColor } = config;
	const styles = presetStyles[preset];

	const primary = hexToOklch(primaryColor);
	const primaryForeground = getForegroundColor(primaryColor);

	const secondary = secondaryColor
		? hexToOklch(secondaryColor)
		: adjustLightness(primaryColor, 0.3);
	const secondaryForeground = secondaryColor ? getForegroundColor(secondaryColor) : DARK_FOREGROUND;

	const accent = accentColor ? hexToOklch(accentColor) : adjustLightness(primaryColor, 0.35);
	const accentForeground = accentColor ? getForegroundColor(accentColor) : DARK_FOREGROUND;

	return {
		"--radius": styles.radius,
		"--primary": primary,
		"--primary-foreground": primaryForeground,
		"--secondary": secondary,
		"--secondary-foreground": secondaryForeground,
		"--accent": accent,
		"--accent-foreground": accentForeground,
		"--ring": primary,
		"--background": defaultColors.background,
		"--foreground": defaultColors.foreground,
		"--card": defaultColors.card,
		"--card-foreground": defaultColors.cardForeground,
		"--popover": defaultColors.popover,
		"--popover-foreground": defaultColors.popoverForeground,
		"--muted": defaultColors.muted,
		"--muted-foreground": defaultColors.mutedForeground,
		"--border": defaultColors.border,
		"--input": defaultColors.input,
		"--destructive": defaultColors.destructive,
		"--destructive-foreground": defaultColors.destructiveForeground,
	};
}

/**
 * Generate dark mode CSS variables for a tenant theme.
 * All colors are output in OKLCH format.
 */
export function generateDarkThemeVariables(config: TenantThemeConfig): Record<string, string> {
	const { preset, primaryColor, secondaryColor, accentColor } = config;
	const styles = presetStyles[preset];

	const primary = hexToOklch(primaryColor);
	const primaryForeground = getForegroundColor(primaryColor);

	const secondary = secondaryColor
		? hexToOklch(secondaryColor)
		: adjustLightness(primaryColor, -0.2);
	const secondaryForeground = secondaryColor
		? getForegroundColor(secondaryColor)
		: LIGHT_FOREGROUND;

	const accent = accentColor ? hexToOklch(accentColor) : adjustLightness(primaryColor, -0.15);
	const accentForeground = accentColor ? getForegroundColor(accentColor) : LIGHT_FOREGROUND;

	return {
		"--radius": styles.radius,
		"--primary": primary,
		"--primary-foreground": primaryForeground,
		"--secondary": secondary,
		"--secondary-foreground": secondaryForeground,
		"--accent": accent,
		"--accent-foreground": accentForeground,
		"--ring": primary,
		"--background": darkDefaultColors.background,
		"--foreground": darkDefaultColors.foreground,
		"--card": darkDefaultColors.card,
		"--card-foreground": darkDefaultColors.cardForeground,
		"--popover": darkDefaultColors.popover,
		"--popover-foreground": darkDefaultColors.popoverForeground,
		"--muted": darkDefaultColors.muted,
		"--muted-foreground": darkDefaultColors.mutedForeground,
		"--border": darkDefaultColors.border,
		"--input": darkDefaultColors.input,
		"--destructive": darkDefaultColors.destructive,
		"--destructive-foreground": darkDefaultColors.destructiveForeground,
	};
}
