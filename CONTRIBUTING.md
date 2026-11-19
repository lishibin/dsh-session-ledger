# Contributing

Thanks for helping improve `dsh-session-ledger`.

Before changing behavior, open an issue or Discussion that describes the
user-visible problem and the proposed compatibility impact. Keep changes
focused on the Harness public seams (`sessionQuery`, `storageDomain`, and
`userQuestions`); do not depend on private files or internal session indexes.

Run the checks locally:

```bash
npm ci
npm test
npm run check
npm run bench:m4
```

Do not commit real session data, secrets, confirmation tokens, generated
benchmark fixtures, or `bench/results` output. New durable fields need a schema
version, a restart test, and an explanation in the design documentation.

Pull requests should include the behavior change, compatibility assumptions,
and the commands used for validation. Security issues should be reported
privately rather than opened as public issues.
