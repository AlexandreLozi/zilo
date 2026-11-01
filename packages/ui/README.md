# @zilo/ui

Zilo Web Components. Vanilla custom elements with no runtime dependencies for now.

Lit is not used yet: a single placeholder element does not need it, and staying dependency-free keeps
the licence and bundle footprint at zero. The UI foundation task (T15) decides whether Lit is worth
adding once real components (scan dialog, focus trap, theming) exist.

Importing `@zilo/ui` registers `<zilo-placeholder>`.
