---
name: setup
description: Check that Motion Studio can run on this machine - Node, ffmpeg, a Chromium browser - list optional creative apps, and install anything missing only after the user approves. Use for first-time setup, "is the studio ready", or when a studio command fails because a tool is missing.
---

# Motion Studio setup

1. Run the check. It only looks; it installs nothing.

   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/studio.mjs" doctor
   ```

2. Report plainly: what is ready, what is missing, and which optional apps were found (After Effects, Premiere Pro, Final Cut Pro, DaVinci Resolve, Blender).

3. If `missing` is not empty, show each item with the exact `install` command from the report and ask the user whether to run it. **Install only what they approve, one command at a time.** If a package manager itself is missing (Homebrew on macOS, winget on Windows), say so and give the manual download link instead of installing a package manager for them:
   - ffmpeg: https://ffmpeg.org/download.html
   - Chrome: https://www.google.com/chrome/
   - Node 22+: https://nodejs.org/

4. After any install, run the check again and report the result.

Notes:

- A browser in a non-standard location: set the `CHROME_PATH` environment variable to its executable.
- Brand profiles and the shared component collection live in the folder the report calls `home` (`~/.motion-studio` unless `MOTION_STUDIO_HOME` is set).
- Rendering launches a headless browser. In a sandboxed Claude Code session the render, stills, qc, capture and timeline commands may need to run outside the sandbox; if one fails with "Operation not permitted" or "Chrome exited before starting", tell the user that is the cause.
- Built and verified on macOS. The code is written to run on Windows as well (no shell scripts, paths and browser discovery handled per platform) but has not been run there yet: on Windows, treat the first run as a test and report anything that fails.
