const svgNs = 'http://www.w3.org/2000/svg';

/** 24 px stroke glyph paths (drawn for Zilo; tokens.md §1). */
export const iconPaths = {
  close: 'M6 6l12 12M18 6L6 18',
  info: 'M12 8h.01M11 12h1v5h1M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z',
  success: 'M8 12.5l2.5 2.5L16 9.5M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z',
  warning:
    'M12 9v4M12 17h.01M10.3 4.2L2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z',
  danger: 'M12 8v5M12 16.5h.01M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z',
} as const;

export type IconName = keyof typeof iconPaths;

/** A decorative icon: `aria-hidden`, not focusable, drawn in `currentColor`. */
export function createIcon(name: IconName, part?: string): SVGSVGElement {
  const svg = document.createElementNS(svgNs, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  if (part !== undefined) svg.setAttribute('part', part);
  const path = document.createElementNS(svgNs, 'path');
  path.setAttribute('d', iconPaths[name]);
  svg.append(path);
  return svg;
}

/** Replaces the icon drawn in `svg`. */
export function setIcon(svg: SVGSVGElement, name: IconName): void {
  svg.querySelector('path')?.setAttribute('d', iconPaths[name]);
}
