Apply this patch to switch the default newsletter presentation font to Familjen Grotesk.

Files included:
- netlify/render_stage2_default_current.js

This patch:
- loads Familjen Grotesk from Google Fonts
- updates the default newsletter HTML presentation to use Familjen Grotesk as the primary font
- leaves the current stage-2 content, layout, and other outputs unchanged
