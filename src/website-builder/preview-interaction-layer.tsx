"use client";

import { useEffect } from "react";

export interface PreviewInteractionLayerProps {
	/** Namespace prefix, e.g. 'ADALATI' or 'AUCTIONOMY' */
	namespace: string;
	/** Accent colour for the hover ring (default: 'rgba(99, 102, 241, 0.6)') */
	ringColor?: string;
	/** Badge background colour (default: 'rgba(99, 102, 241, 0.9)') */
	badgeColor?: string;
}

/**
 * Drop this component anywhere in the website app when `?__preview=1` is active.
 * It injects CSS for hover zones and dispatches postMessage clicks back to the
 * dashboard iframe parent.
 */
export function PreviewInteractionLayer({
	namespace,
	ringColor = "rgba(99, 102, 241, 0.6)",
	badgeColor = "rgba(99, 102, 241, 0.9)",
}: PreviewInteractionLayerProps): null {
	useEffect(() => {
		const styleId = `__preview-interaction-layer-${namespace}`;

		const style = document.createElement("style");
		style.id = styleId;
		style.textContent = `
      [data-preview-zone] {
        position: relative;
        cursor: pointer !important;
      }
      [data-preview-zone]::after {
        content: attr(data-preview-label);
        position: absolute;
        top: 8px;
        left: 8px;
        background: ${badgeColor};
        color: #fff;
        font-size: 11px;
        font-weight: 600;
        font-family: ui-sans-serif, system-ui, sans-serif;
        padding: 3px 8px;
        border-radius: 4px;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.15s;
        z-index: 9999;
        white-space: nowrap;
      }
      [data-preview-zone]:hover::after {
        opacity: 1;
      }
      [data-preview-zone]::before {
        content: '';
        position: absolute;
        inset: 0;
        pointer-events: none;
        border: 2px dashed transparent;
        transition: border-color 0.15s;
        z-index: 9998;
      }
      [data-preview-zone]:hover::before {
        border-color: ${ringColor};
      }
    `;
		document.head.appendChild(style);

		function handleClick(e: MouseEvent) {
			const target = e.target as Element;
			const zone = target.closest("[data-preview-zone]");
			if (!zone) return;
			const family = zone.getAttribute("data-preview-zone");
			if (!family) return;
			window.parent.postMessage({ type: `${namespace}_COMPONENT_CLICK`, family }, "*");
		}

		document.addEventListener("click", handleClick, true);

		return () => {
			document.removeEventListener("click", handleClick, true);
			document.getElementById(styleId)?.remove();
		};
	}, [namespace, ringColor, badgeColor]);

	return null;
}
