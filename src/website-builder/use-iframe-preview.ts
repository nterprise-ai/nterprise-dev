import { useEffect } from "react";
import type { ComponentSelections } from "./types.js";

export interface UseIframePreviewOptions {
	/** Ref to the iframe element */
	iframeRef: React.RefObject<HTMLIFrameElement | null>;
	/** Current component selections to push to the iframe */
	selections: ComponentSelections;
	/** Namespace prefix, e.g. 'ADALATI' or 'AUCTIONOMY' */
	namespace: string;
	/** Called when the iframe reports a component zone was clicked */
	onCycle: (family: string) => void;
	/** Debounce ms before pushing selections (default: 150) */
	debounceMs?: number;
}

export function useIframePreview({
	iframeRef,
	selections,
	namespace,
	onCycle,
	debounceMs = 150,
}: UseIframePreviewOptions): void {
	// Push selections to iframe on change (debounced)
	useEffect(() => {
		const timer = setTimeout(() => {
			iframeRef.current?.contentWindow?.postMessage(
				{ type: `${namespace}_PREVIEW`, config: { componentSelections: selections } },
				"*",
			);
		}, debounceMs);
		return () => clearTimeout(timer);
	}, [iframeRef, selections, namespace, debounceMs]);

	// Listen for COMPONENT_CLICK from iframe
	useEffect(() => {
		function handler(e: MessageEvent) {
			if (e.data?.type !== `${namespace}_COMPONENT_CLICK`) return;
			const family = e.data.family as string;
			if (family) onCycle(family);
		}
		window.addEventListener("message", handler);
		return () => window.removeEventListener("message", handler);
	}, [namespace, onCycle]);
}
