import { defineZiloBanner } from './banner.js';
import { defineZiloButton } from './button.js';
import { defineZiloDialog } from './dialog.js';
import { defineZiloProgress } from './progress.js';

export {
  ZiloElement,
  adoptStyles,
  defineOnce,
  type ZiloDialogCloseDetail,
  type ZiloDialogCloseReason,
  type ZiloEvent,
  type ZiloEventDetailMap,
  type ZiloTheme,
} from './base.js';
export {
  ZiloBanner,
  defineZiloBanner,
  type ZiloBannerLive,
  type ZiloBannerVariant,
} from './banner.js';
export {
  ZiloButton,
  defineZiloButton,
  type ZiloButtonSize,
  type ZiloButtonVariant,
} from './button.js';
export { ZiloDialog, defineZiloDialog } from './dialog.js';
export { deepActiveElement, tabbableElements } from './focus.js';
export { ZiloProgress, ZiloSpinner, defineZiloProgress } from './progress.js';
export {
  baseCss,
  darkPalette,
  lightPalette,
  publicColorProperties,
  tokensCss,
  type Palette,
  type PaletteKey,
} from './tokens.js';

/** Registers every Zilo element; safe to call repeatedly. Importing `@zilo/ui` calls it. */
export function defineZiloElements(registry?: CustomElementRegistry): void {
  defineZiloButton(registry);
  defineZiloBanner(registry);
  defineZiloProgress(registry);
  defineZiloDialog(registry);
}

defineZiloElements();
