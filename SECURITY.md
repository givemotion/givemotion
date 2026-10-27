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
  can read them while it runs. The preview page exists only while `dev` runs, and it only loads pages from its own
  server.
- **Symbolic links** inside the project folder are followed, also when they point outside it: that is how projects
  share styles, sounds and blocks without copying them. A link that ends at a hidden file, or leads into a folder
  that holds keys (`.ssh`, `.aws`, `.gnupg`, `.git`, `.config` and similar), is refused. A project you did not make
  can still link to other files on your machine, so render it in a container (see above).
- **Media for the soundtrack** (`<audio>`, `<video>`) must be inside the project folder, by the same rules.
- **`<gm-include>`** is expanded on your machine, so it can read files outside the project folder (shared blocks);
  it only reads `.html` and `.svg` files and never hidden files or folders.
- **`bundle`** makes a folder to publish. It copies only the files the page uses that the server would serve: inside
  the project folder and not hidden. It lists the ones it left out.
- **Chrome's sandbox** stays on, except when running as root on Linux (common in Docker) or when
  `GIVEMOTION_NO_SANDBOX` is set. In those cases isolate the process with the container instead.
- **Data and props** (`--data`, `--props`) are inserted into the HTML as escaped text: safe in text and in quoted
  attribute values (`title="{{data.name}}"`, not `title={{data.name}}`), and a value at the start of a `src`/`href` is never a `javascript:` URL. They are not
  safe inside `<script>` or `<style>`: there, read `gm.data` instead. `data-bind` sets text, and `data-bind-*` never
  sets event handlers or script URLs. If you build compositions from user input in a service, still treat that input
  like any HTML you would put on a web page.

givemotion sends no usage data anywhere.
