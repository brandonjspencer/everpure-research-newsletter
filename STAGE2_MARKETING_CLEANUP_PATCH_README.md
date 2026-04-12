# Everpure stage-2 marketing cleanup patch

This patch replaces the current-cycle marketing writer with a cleaner artifact-focused renderer.

It fixes three live issues:
- renders the marketing HTML as proper HTML instead of markdown-like preformatted content
- removes the public editorial recommendations block
- fixes the JSON `defaults` object so it matches `marketing / detailed`

It also keeps the marketing artifact focused on cadence, throughput, active workstreams, repeated threads, and comparison work in flight.
