# designer

MCP + CLI that lets your coding agent drive **[claude.ai/design](https://claude.ai/design)** (Claude's wireframe + hi-fi design tool, no API) with full context of your codebase — capabilities, data shape, existing tokens fed into every prompt.

Human describes intent → agent surveys codebase and prompts Claude Design → hands you the URL → iterate → `designer_handoff` fetches the project export zip into your repo (`project/` design files + a regenerated `decision-record.md`).

> **Status:** v0.3.26, early. macOS and Linux.

## Stance

- **Single-vendor, single-purpose.** Only `claude.ai/design`.
- **Real Chrome via CDP.** Sidesteps Cloudflare + Google SSO.
- **Capabilities drive design.** Agent surveys the codebase (entities, operations, states, tokens) and feeds them into every prompt. Intent tells Claude Design *how*; the codebase tells it *what*. See the [designer-loop skill](skills/designer-loop/SKILL.md).
- **URL is the default taste path.** `designer_prompt` returns a live claude.ai/design URL with working tweak sliders and variant switcher.
- **Artifacts land on disk.** Every iteration + handoff saves under `./artifacts/{key}/`.

## Install

### Prerequisites

- [Bun 1.4.0](https://bun.com/docs/installation), plus Google Chrome.
- `agent-browser` 0.35.2 on PATH: `bun add --global --exact agent-browser@0.35.2`.

### Install from this fork

```bash
git clone https://github.com/lubomir-dlhy/designer.git
cd designer
bun ci
bun test
./bin/designer.mjs setup
```

The package name reserved for a future registry release is
`@lubomir-dlhy/designer`. Until it is published, use the source checkout above.

### What `designer setup` does

1. Verify Bun 1.4.0 and synchronize dependencies from `bun.lock`.
2. Check `agent-browser` 0.35.2 on PATH.
3. Ask you to quit normal Chrome, unless `CHROME_BIN` selects a separate Chrome for Testing/Canary executable.
4. Launch debug Chrome (`--remote-debugging-port=9222`, profile at `~/.chrome-designer-profile/`).
5. Poll until you sign in and land on `/design`.
6. Install the `designer-loop` skill at `~/.claude/skills/designer-loop/` (skipped if already present — respects dotfile symlinks).
7. Register the MCP with Claude Code (user scope).

Re-run anytime — idempotent. Verify with `designer doctor`.

### MCP only (skip the CLI)

```bash
claude mcp add --scope user --transport stdio designer \
  -- "$(command -v bun)" "$PWD/bin/designer.mjs" mcp serve
```

Run this from the cloned repository root. It still needs the dedicated debug
Chrome, which `./bin/designer.mjs setup` launches.

### Notes

- **Dedicated profile.** Chrome 136+ blocks `--remote-debugging-port` on the default profile. Login to `~/.chrome-designer-profile/` persists.
- **Auto-launch.** MCP auto-launches debug Chrome on the first tool call if the profile exists.
- **Bot detection.** Real Chrome + user-controlled login — not headless. Cloudflare + Google OAuth see a normal session. First login may trigger a Google new-device prompt.
- **`DESIGNER_CDP=9222`** is the default. Export it only when using a different port or when you want the setting explicit for direct CLI calls.

### Run normal Chrome and Designer together

Chrome 136+ requires automation to use a non-default profile. On macOS, a
second launch of the same system Chrome binary can also forward to the existing
process and lose its CDP flags. Use a separate Chrome for Testing executable so
your everyday Chrome and Designer remain independent:

```bash
mkdir -p "$HOME/.cache/designer-cft"
bunx @puppeteer/browsers@3.2.1 install chrome@152.0.7977.64 \
  --path "$HOME/.cache/designer-cft"

# Use the executable path printed by the install command.
export CHROME_BIN="/absolute/path/to/Google Chrome for Testing"
export DESIGNER_CDP=9333

./bin/designer.mjs setup
```

Setup stores both variables in the Claude Code MCP registration. Thereafter the
MCP can auto-launch Chrome for Testing on port 9333 even while normal Chrome is
running. The testing browser still uses `~/.chrome-designer-profile/`, so its
Claude login persists without exposing the cookies from your everyday profile.

Dependency and browser versions above are intentionally exact. Review upstream
release notes and update the pins in a dedicated PR; do not replace them with
`latest`, caret, tilde, or wildcard ranges.

## CLI

```
designer setup                                       (once per machine)
designer session --action create --name "X" --key x  start a project
designer adopt --key x                                adopt an open /design/p/<uuid> tab into a key
designer prompt "design the …" --key x               prints 'Taste here: <url>'
designer prompt - --key x < follow-up.txt            iterate
designer handoff --key x                             bundle for code implementation
```

> **Entry-layer drift (issue #61).** The 2026-06 redesign made the `/design`
> home composer-driven (no name input / fidelity toggle). `--action create` is
> updated for it: `name` is now the seed intent and the project is created by
> filling the composer and clicking "Start project". `designer adopt` also binds
> an already-open `/design/p/<uuid>` tab to a key if you'd rather create by hand.

Every verb has `--help`. `--key <k>` isolates parallel sessions (state at `~/.designer/sessions.json`). Prompts accept positional, `--prompt-file`, or stdin (`-`).

## MCP

Seven tools, registered at user scope by `designer setup`:

| Tool | Purpose |
|---|---|
| `designer_session` | Enter / inspect / transition. Returns stored state + `currentUrl` + `availableFiles`. |
| `designer_prompt` | Modify the design. Completion is network-first — watches the Connect-RPC turn lifecycle over a second CDP client (`ReleaseTurn` = done), with an HTML byte-settle fallback. Returns `url`, `newFiles`, `activeFile`, `failureMode` (`timeout`/`unstable`/`no_change`/`stalled`/`blocked`), `htmlPath`, `chatReply`. |
| `designer_ask` | Q&A with the assistant, no file changes. |
| `designer_list` | `projects` or `files` (flat-only — see quirks). |
| `designer_snapshot` | Capture current file. Paths + hash by default; `includeHtml: true` inlines. |
| `designer_files_delete` | Delete one file from the open project — clearing superseded variants. **Dry-run by default** (`confirm: true` to act); snapshots the file first and aborts if that fails. Refuses on ambiguous names or a confirm dialog naming a different file; distinguishes refusals (nothing deleted) from post-click uncertainty. |
| `designer_handoff` | Fetch + extract the project export zip → `project/` + `decision-record.md`. Auto-repairs em-dash filename bugs. |

## Why the destructive path looks the way it does

`designer_files_delete` is deliberately more machinery than "click the button":
verify-and-stamp binding, a tab lock, and outcome assertion. Five review rounds
against the live product produced that shape, and the reasoning — including the
approaches that were tried and refuted — is in
[`docs/adr/0001-destructive-ui-automation-safety.md`](docs/adr/0001-destructive-ui-automation-safety.md).
Read it before simplifying any of it, or before adding a sibling verb
(rename / duplicate / project-delete) on the same surface.

## The loop

```
1. Intent       → human describes what they want to feel / change
2. Survey       → agent reads the target repo: entities, operations, states,
                  failure modes, existing tokens — capability facts, verbatim
3. Relay        → designer_prompt = intent + capabilities, minimal faithful prompt
4. Taste        → hand the human the returned URL; they react in their own words
5. Interpret    → next designer_prompt (modify) or designer_ask (clarify)
6. Repeat 3-5   → until human says "that's it"
7. Promote      → designer_handoff — bundle is the decision record
```

Full guidance in [`skills/designer-loop/SKILL.md`](skills/designer-loop/SKILL.md).

## Tasting harness

Fallback when the live URL's IDE chrome eats viewport. Requires a prior handoff.

```bash
designer tasting --key <key>
```

Writes `tasting.html` with variant tabs + 1/2/3 shortcuts + persistent notes, serves it with Bun on loopback only (`127.0.0.1`), and opens the browser. The command prints the server PID; stop it with `kill <serverPid>` when you are finished (or end the corresponding Bun process in Task Manager on Windows).

## Operations

- `designer doctor` — diagnose setup state. Exits 2 on failure.
- `designer health [--json]` — probe every UI anchor designer depends on. Wire into cron to catch claude.ai UI regressions.
- **Daily CI** in `.github/workflows/`: `daily-health.yml` runs the auth-required UI probe on a self-hosted macOS runner once per day; `ci.yml` typechecks + tests + does a Bun Docker clean-room install smoke on every PR; `release-please.yml` opens a release PR on conventional commits, merging it tags + publishes to npm. Selector regressions land as auto-opened PRs under the `selectors-drift` label.

## Known quirks

- **Folder-organized variants.** The live file-list scrape is flat-only; nested files invisible until `designer_handoff`. `designer_prompt` auto-appends *"no subfolders."* Bundle + `designer tasting` are folder-aware.
- **React-controlled inputs.** `agent-browser fill` doesn't fire React's synthetic `input` event; we use the native value-setter + `dispatchEvent` + JS `.click()`.
- **Cross-origin preview.** Since the 2026-06 redesign the design preview renders in a cross-origin out-of-process iframe (`*.claudeusercontent.com`) with no signed token — a plain fetch returns only a ~1KB loader shell. `designer_snapshot` / `designer files` read the real rendered HTML over CDP from inside that iframe, so HTML capture needs CDP up (the default); with `DESIGNER_CDP=''` snapshots fall back to empty rather than the shell.
- **Em-dash handoff filenames.** Claude's handoff pipeline sometimes writes `—` in hrefs but `-` in filenames. `designer_handoff` detects and repairs.
- **UI regressions.** Claude has moved critical buttons mid-development (Export → Share). Run `designer health` periodically.

## Credits

Built on [`agent-browser`](https://github.com/ctate/agent-browser) by [@ctatedev](https://x.com/ctatedev).

## License

[MIT](LICENSE).
