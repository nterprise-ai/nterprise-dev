import { useEffect, useState } from "react";
import type { ComponentSelections } from "./types.js";

export interface UseComponentPreviewOptions {
	/** Whether the page is in preview mode (e.g. `?__preview=1`) */
	isPreview: boolean;
	/** Namespace prefix, e.g. 'ADALATI' or 'AUCTIONOMY' */
	namespace: string;
}

export interface UseComponentPreviewResult {
	/** Preview-overridden selections (null if none received yet) */
	previewSelections: ComponentSelections | null;
}

export function useComponentPreview({
	isPreview,
	namespace,
}: UseComponentPreviewOptions): UseComponentPreviewResult {
	const [previewSelections, setPreviewSelections] = useState<ComponentSelections | null>(null);

	useEffect(() => {
		if (!isPreview) return;

		function handler(e: MessageEvent) {
			if (e.data?.type !== `${namespace}_PREVIEW`) return;
			const selections = e.data.config?.componentSelections;
			if (selections) setPreviewSelections(selections);
		}

		window.addEventListener("message", handler);
		return () => window.removeEventListener("message", handler);
	}, [isPreview, namespace]);

	return { previewSelections };
}
