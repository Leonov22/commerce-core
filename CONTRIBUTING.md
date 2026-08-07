# Contributing

Thank you for your interest in contributing. This document describes the
general workflow for contributing to this repository. Stack-specific setup
instructions (build/test/run commands) will be added to
[docs/09-development/](docs/09-development/README.md) once the technology
stack is selected by the Architect.

## Before You Start

- Check open issues to see if your idea or bug has already been reported.
- For significant changes, open an issue first to discuss the approach before investing time in an implementation.
- Read the [Code of Conduct](CODE_OF_CONDUCT.md) — participation in this project requires following it.

## Branching Strategy

- `main` (or `master`) is the stable branch and should always be in a working state.
- Create a feature branch from the default branch for each change: `feature/<short-description>`, `fix/<short-description>`, `docs/<short-description>`.
- Keep branches focused on a single change; avoid bundling unrelated work.

## Commit Messages

Use clear, descriptive commit messages. This project follows the
[Conventional Commits](https://www.conventionalcommits.org/) style:

```
<type>: <short description>

[optional body]
```

Common types: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `style`.

## Pull Requests

1. Ensure your branch is up to date with the target branch before opening a PR.
2. Fill out the [pull request template](.github/PULL_REQUEST_TEMPLATE.md) completely.
3. Link related issues in the PR description.
4. Keep PRs small and reviewable; large PRs take longer to review and are more error-prone.
5. At least one approving review is required before merging.
6. Squash or rebase as directed by the repository's merge policy once one is defined.

## Documentation Changes

Documentation lives under [docs/](docs/README.md), organized by domain. When
your change affects behavior, requirements, or architecture, update the
relevant document in the same PR rather than leaving it for a follow-up.

## Reporting Bugs and Requesting Features

Use the provided issue templates:

- [Bug report](.github/ISSUE_TEMPLATE/bug_report.md)
- [Feature request](.github/ISSUE_TEMPLATE/feature_request.md)

## Security Issues

Do not open a public issue for security vulnerabilities. See
[SECURITY.md](SECURITY.md) for the responsible disclosure process.

## Questions

If anything in this document is unclear, open an issue so it can be clarified
and improved for future contributors.
