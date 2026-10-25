# Security

## Reporting a problem

Please do not open a public issue for security problems. Use GitHub's private reporting instead:
**Security → Report a vulnerability** on [the repository](https://github.com/leonardogrig/givemotion/security/advisories/new).
You should get an answer within a week. Fixes go into the latest release.

## What givemotion trusts

givemotion runs your composition (HTML, CSS and JavaScript) in headless Chrome, the same way a browser runs a
web page. Keep that in mind when you render compositions or data you did not write:

- **A composition is code.** Rendering one runs its scripts. Render compositions from people you don't trust
  the same way you would open their web page: in a container or a VM, without your secrets in the environment.
- **Network access.** Pages can load fonts, images and scripts from the internet, like any web page. To render
  offline or in a locked-down service, block outbound network access around the render.
- **The local server** (used by `render`, `check`, `dev` and the others) listens on `127.0.0.1` only, answers only
  requests addressed to `localhost`/`127.0.0.1`, sends no cross-origin headers, and never serves hidden files or
  folders (`.env`, `.git`, ...). It serves the files under the project folder, so other programs on your own machine
  can read them while it runs.
- **Chrome's sandbox** stays on, except when running as root on Linux (common in Docker) or when
  `GIVEMOTION_NO_SANDBOX` is set. In those cases isolate the process with the container instead.
- **Data and props** (`--data`, `--props`) are inserted into the HTML as text. If you build compositions from user
  input in a service, treat that input like any HTML you would put on a web page.

givemotion sends no usage data anywhere.
