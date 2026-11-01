/**
 * Every catalog state. Pure data, shared by the app (which renders them) and the Playwright suite
 * (which visits each one in both themes). URL: `/?state=<id>&theme=<light|dark>`.
 */
export const catalogThemes = ['light', 'dark'] as const;
export type CatalogTheme = (typeof catalogThemes)[number];

export const catalogStates = [
  { id: 'button-secondary', component: 'Button', title: 'Secondary' },
  { id: 'button-primary', component: 'Button', title: 'Primary' },
  { id: 'button-ghost', component: 'Button', title: 'Ghost' },
  { id: 'button-danger', component: 'Button', title: 'Danger' },
  { id: 'button-small', component: 'Button', title: 'Small' },
  { id: 'button-disabled', component: 'Button', title: 'Disabled' },
  { id: 'button-busy', component: 'Button', title: 'Busy' },
  { id: 'button-icon', component: 'Button', title: 'Icon only' },
  { id: 'button-host-override', component: 'Button', title: 'Host accent override' },
  { id: 'banner-info', component: 'Banner', title: 'Info' },
  { id: 'banner-success', component: 'Banner', title: 'Success' },
  { id: 'banner-warning', component: 'Banner', title: 'Warning' },
  { id: 'banner-danger', component: 'Banner', title: 'Error with actions' },
  { id: 'banner-dismissible', component: 'Banner', title: 'Dismissible' },
  { id: 'progress-determinate', component: 'Progress', title: 'Determinate' },
  { id: 'progress-indeterminate', component: 'Progress', title: 'Indeterminate' },
  { id: 'spinner-default', component: 'Spinner', title: 'Hidden label' },
  { id: 'spinner-visible-label', component: 'Spinner', title: 'Visible label' },
  { id: 'dialog-trigger', component: 'Dialog', title: 'Closed, with trigger' },
  { id: 'dialog-open', component: 'Dialog', title: 'Open' },
  { id: 'dialog-description', component: 'Dialog', title: 'Open, with description' },
  { id: 'dialog-alert', component: 'Dialog', title: 'Confirmation (alertdialog)' },
  { id: 'dialog-scroll', component: 'Dialog', title: 'Long content (scrolls inside)' },
  { id: 'host-modal-radix', component: 'Host modal', title: 'Inside a Radix Dialog (React)' },
] as const;

export type CatalogState = (typeof catalogStates)[number];
export type CatalogStateId = CatalogState['id'];

/** States rendered by React (see `host-modal.tsx`) rather than from static markup. */
export const reactStates: readonly CatalogStateId[] = ['host-modal-radix'];

export function stateUrl(id: CatalogStateId, theme: CatalogTheme): string {
  return `/?state=${id}&theme=${theme}`;
}
