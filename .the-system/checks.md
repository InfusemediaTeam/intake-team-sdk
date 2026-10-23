# S.Y.S.T.E.M checks on a pull request

Two checks, and they answer different questions. Wiring the wrong one into a
ruleset, or fixing the wrong findings, both start with confusing them.

| Check | Question | Red when |
| --- | --- | --- |
| `quality-gate / Code quality, dependencies and secrets` | did the scan run and reach the-system? | a scanner could not run, or no bundle was produced |
| `S.Y.S.T.E.M / open the scan report` | did **this change** make things worse? | it adds a committed credential, a critical security or dependency finding, or a high security finding |

**Findings this change did not add are not yours to fix.** The second check is
about the delta against the branch you land on. The repository's existing debt
is somebody else's ticket, and "fixing" it here buries your change in noise.

## Waiting for the answer

The gate finishing is not the answer. the-system posts the verdict a few minutes
later, so wait for that context by name rather than for the run:

```bash
gh pr checks <pr> --json name,state,description,link
```

- our context absent while `quality-gate / Code quality, dependencies and secrets` is still running: wait.
- absent more than ten minutes after the gate concluded: **it is not coming.**
  The gate failed before it could deliver the bundle. Read the gate's own run
  summary — it names a missing variable or an unreadable history. Do not keep
  waiting for a check that has nobody to post it.

## Reading it

The line ends with the branch it measured against. The posted form is
`<what it found> — vs <base>`, where `<base>` is this repository's own default
branch, or whichever branch the pull request lands on. The em dash is the character to match on; the branch name
after it is not a constant, and an example that named one would be wrong in
most repositories. If it names a branch yours does not land on, the pull request
was not open when the scan ran and the base was assumed. That one corrects
itself within twenty minutes, or on your next push. Do not act on that verdict
before it does.

`error` is not a crash. It is "concluded, and not a pass": either a scanner
could not run, so the scan cannot be read as clean, or the base branch has no
finished scan to compare against yet (`not_comparable`).

`not_comparable` clears when the base branch gets its first scan. A push to
your own branch does not change it. If the base is the default branch, you can
scan it once now with the workflow file that calls the gate:

```bash
gh workflow run <gate workflow file> --ref <default-branch>
```

A manual run on any other branch is refused. If the pull request lands on
another branch, land the change instead.

## Getting the detail

The report link is for a person and needs a browser session. What a machine can
read is the bundle the run uploaded:

```bash
gh run download <run-id> -n the-system-scan
```

- `report-artifact.json` — retrieval, structured report status, scanner
  coverage, missing scanners, and the Markdown filename
- `report.md` — a terminal report: every finding with its rule id, file and
  line, grouped by file, blockers first
- `report.partial.md` — a bounded-timeout snapshot, explicitly not terminal
- `gitleaks.json` — secrets, with file and line
- `trivy.json` — dependencies, with package, CVE and fixed version
- `manifest.json` — each scanner's status, and its error text when it failed
- `delivery.json` — the report's id and address

Sonar's raw output is not in the bundle — it carries only the analysis id, and
the analysis project is deleted once the-system has read it. Read
`report-artifact.json` first. Act on `report.md` only when retrieval is
`succeeded`. A `report.partial.md` copy is useful evidence, but it is not a
clean or terminal result. If retrieval is `failed`, no Markdown filename is
published; the report link in the run summary still works for a person.

The bundle holds the whole repository, not your delta. Read the one-line verdict
first to know how many findings are actually yours, then find those in the
bundle - never fix everything it lists.

## Never

Do not add scanners, severity thresholds, or any step that parses a report to
CI, and do not make either check required. Severity, grouping and the verdict
belong to the-system; a second opinion in a workflow file is one to keep in sync
for ever.
