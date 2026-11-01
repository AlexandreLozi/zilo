import '@zilo/ui';
import type {
  ZiloBanner as ZiloBannerElement,
  ZiloBannerLive,
  ZiloBannerVariant,
  ZiloButton as ZiloButtonElement,
  ZiloButtonSize,
  ZiloButtonVariant,
  ZiloDialog as ZiloDialogElement,
  ZiloProgress as ZiloProgressElement,
  ZiloSpinner as ZiloSpinnerElement,
} from '@zilo/ui';
import { createZiloComponent, type ZiloComponentProps } from './create-component.js';

export type {
  ZiloBannerLive,
  ZiloBannerVariant,
  ZiloButtonSize,
  ZiloButtonVariant,
  ZiloDialogCloseDetail,
  ZiloDialogCloseReason,
  ZiloEvent,
  ZiloTheme,
} from '@zilo/ui';
export type {
  ZiloBannerElement,
  ZiloButtonElement,
  ZiloDialogElement,
  ZiloProgressElement,
  ZiloSpinnerElement,
};
export { createZiloComponent, type ZiloComponentProps } from './create-component.js';

const dialogDefaults = {
  open: false as boolean,
  heading: null as string | null,
  description: null as string | null,
  alert: false as boolean,
  hideClose: false as boolean,
  closeLabel: 'Close' as string,
  initialFocus: null as HTMLElement | null,
  returnFocus: null as HTMLElement | null,
};
const dialogEvents = {
  onOpen: 'zilo-open',
  onCancel: 'zilo-cancel',
  onClose: 'zilo-close',
} as const;

/** Props of `<ZiloDialog>`; see `@zilo/ui` for behaviour. Put footer actions in `slot="footer"`. */
export type ZiloDialogProps = ZiloComponentProps<
  ZiloDialogElement,
  typeof dialogDefaults,
  typeof dialogEvents
>;

/**
 * Modal dialog. Controlled through `open`: update your state in `onClose`. Call
 * `event.preventDefault()` in `onCancel` to keep it open (Escape or the close button).
 */
export const ZiloDialog = createZiloComponent<
  ZiloDialogElement,
  typeof dialogDefaults,
  typeof dialogEvents
>('zilo-dialog', 'ZiloDialog', dialogDefaults, dialogEvents);

const buttonDefaults = {
  variant: 'secondary' as ZiloButtonVariant,
  size: 'md' as ZiloButtonSize,
  disabled: false as boolean,
  busy: false as boolean,
  label: null as string | null,
};
const noEvents = {} as const;

/** Props of `<ZiloButton>`. Use the regular `onClick`; it does not fire while `disabled` or `busy`. */
export type ZiloButtonProps = ZiloComponentProps<
  ZiloButtonElement,
  typeof buttonDefaults,
  typeof noEvents
>;

export const ZiloButton = createZiloComponent<
  ZiloButtonElement,
  typeof buttonDefaults,
  typeof noEvents
>('zilo-button', 'ZiloButton', buttonDefaults, noEvents);

const bannerDefaults = {
  variant: 'info' as ZiloBannerVariant,
  live: null as ZiloBannerLive | null,
  dismissible: false as boolean,
  dismissLabel: 'Dismiss' as string,
};
const bannerEvents = { onDismiss: 'zilo-dismiss' } as const;

/** Props of `<ZiloBanner>`. Put a title in `slot="title"` and buttons in `slot="actions"`. */
export type ZiloBannerProps = ZiloComponentProps<
  ZiloBannerElement,
  typeof bannerDefaults,
  typeof bannerEvents
>;

export const ZiloBanner = createZiloComponent<
  ZiloBannerElement,
  typeof bannerDefaults,
  typeof bannerEvents
>('zilo-banner', 'ZiloBanner', bannerDefaults, bannerEvents);

const progressDefaults = {
  value: null as number | null,
  max: 100 as number,
  label: null as string | null,
  valueText: null as string | null,
};

export type ZiloProgressProps = ZiloComponentProps<
  ZiloProgressElement,
  typeof progressDefaults,
  typeof noEvents
>;

/** Progress bar; omit `value` for indeterminate. */
export const ZiloProgress = createZiloComponent<
  ZiloProgressElement,
  typeof progressDefaults,
  typeof noEvents
>('zilo-progress', 'ZiloProgress', progressDefaults, noEvents);

const spinnerDefaults = {
  label: 'Loading' as string,
  visibleLabel: false as boolean,
};

export type ZiloSpinnerProps = ZiloComponentProps<
  ZiloSpinnerElement,
  typeof spinnerDefaults,
  typeof noEvents
>;

export const ZiloSpinner = createZiloComponent<
  ZiloSpinnerElement,
  typeof spinnerDefaults,
  typeof noEvents
>('zilo-spinner', 'ZiloSpinner', spinnerDefaults, noEvents);
