# Claude Code notes

Read `AGENTS.md` first. It holds the product rules, stack, repo structure, and working rules. This file only adds what's specific to Claude Code.

- Execute `.claude/plans/2026-10-02-tabled-build-plan.md` with the `superpowers:executing-plans` skill, task by task, in order.
- Use `superpowers:test-driven-development` for `lib/matcher.ts`. It is the one file that must have tests.
- Use `superpowers:verification-before-completion` before saying any task is done. Show the command output.
- Use `superpowers:systematic-debugging` on the first failure. Three failed attempts at the same thing means stop and report.
- For UI work, follow the tokens in `AGENTS.md`. Do not invent new colors, fonts, or radii.
- Deploy with the `vercel:deploy` skill and check the production URL in a browser before reporting.
