# Playbook: taking an AI agent into operations

For team leads who are not AI experts, using this project as the example.

## 1. What to reuse as is, and what to adapt

**As is:** the read-only connection to the systems, tied to the case's customer; the masking of personal data; the approval step; the separate service that carries out only what was approved, once; the program that runs the test cases.

**Adapt:** the queries to your systems; the closed list of actions (here: open a dispute, resend the transfer receipt (the CEP), escalate to fraud); the policies; the test cases, attack cases included; and the agent's job description, in one paragraph. For example:

> Reads the customer's account and our policies, classifies the case, drafts a reply and suggests at most one action from the list. It does not move money, sends nothing to the customer and never asks for a PIN, CVV or password. Every case goes to a person, who approves or rejects the action and signs off on the reply. If the data does not back what it proposes, it hands the case over with no action and says why; it never guesses.

## 2. Non-negotiable rules

- The agent only reads.
- Approval lives in the code, not in the instructions: even if someone tricks the agent, it cannot skip it.
- Personal data is masked everywhere.
- The test cases, attack cases included, run before every change.
- A spending cap per attempt and a maximum number of attempts per case (here, USD 0.5 per attempt and 3 attempts, plus 3 reruns a person asks for).
- The customer can always reach a person.
- If an agent ever gets a tool that writes, it carries a money limit enforced in code.

## 3. How to know it is ready for production

- It withstood every attack case in three out of three attempts (here, the system stopped 30 of 30 attempts).
- The automatic grader agrees with a person on what is wrong and on what is fine (here it does not yet: checked against 52 replies a person graded, it caught every bad one but also marked too many good ones as bad, so nobody relies on it).
- Cost and time per case within budget.
- Alerts wired up, each with an owner.
- Tested against real cases closed recently.
- Rollout: shadow (nobody uses what it proposes) → copilot (a person approves everything; this project) → then automatic sending only of low-risk replies that carry no action, reviewing a 10–20% sample. Actions are never automated.
- The measure is whether the customer writes again within 7 days: an approval is not a resolution.

## Who owns it

- A named person and a weekly review.
- The off switch, tested: without the agent, cases are worked by hand.
- Every new operator first reviews the practice cases with planted mistakes.

## If the agent misbehaves

1. Turn it off.
2. Review the actions carried out in that period.
3. Turn the case into a test case.
4. Turn it back on only when it passes every attack case.

Technical detail: [DESIGN.md](DESIGN.md).
