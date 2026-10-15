# Working on this repository

Notes for Claude. The rules for everyone working on this code are in
`CONTRIBUTING.md`: how to write the code and the interface text, what must
not break, and what a pull request needs. Follow them. How the code fits
together is in `docs/architecture.md`. Read both before changing code.

What follows is only how Claude works with the owner.

## Pull requests

- **Check earlier pull requests first.** Before starting work for a new pull
  request, and before pushing to an existing branch, look at the state of
  every earlier pull request.
  - If one has been merged, start a new branch from the latest `main`. Never
    push to a branch whose pull request is already merged.
  - If one is still open, ask the owner whether to add to it or open a
    separate pull request.
- **The owner approves and merges.** Open pull requests; never merge them.
- **Plan first when asked.** When the owner asks to plan or discuss a change,
  agree on it before building.
- **Run every check** in CONTRIBUTING.md's "Pull requests" section before
  opening or updating one, and say in the description what changed and how
  it was tested, with before/after screenshots for visual changes.
