# Source Snapshot Validation

The build now validates `data/Everpure.html` before using it as a Notion fallback source.

A local snapshot is only accepted if it parses into at least one weekly record and a latest source date. If it parses into zero usable weeks, the build falls back to existing parsed outputs instead of deploying an empty newsletter.

This prevents blank/stale issue output when a manually saved Notion HTML file is incomplete or not parseable by the current parser.
