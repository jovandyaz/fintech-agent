# Labeling the judge's calibration rows

The groundedness judge counts toward the variant decision only after a person agrees with it (specs/03-evals.md §Judge validation). These files hold that check.

| File              | Written by            | Holds                                                                                                                                                                                    |
| ----------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `to-label.jsonl`  | `pnpm eval:judgments` | One row per draft, shuffled, under an opaque id: the first attempt of each case and variant, and about 14 of those drafts with one injected defect                                       |
| `judgments.jsonl` | `pnpm eval:judgments` | The judge's verdict on each row. **Do not open it until you have labeled every row.**                                                                                                    |
| `labels.jsonl`    | you                   | Your verdict on each row                                                                                                                                                                 |
| `key.jsonl`       | `pnpm eval:judgments` | What each opaque id stands for (case, variant, injected defect), read by the scripts. **Do not open it until you have labeled every row.**                                               |
| `controls.json`   | `pnpm eval:judgments` | The judge's verdict on each of the 7 known-bad controls and the fingerprint of the rubric it judged under. The judge counts only if it failed all 7 and the rubric has not changed since |

## How to label

1. Open `to-label.jsonl`. Each line has a `row_id` and a `judge_input`: the draft reply, the policy chunks it cites and the masked tool outputs.
2. Rows do not say which case, variant or kind of draft they are, on purpose. Read the draft against the chunks and the tool outputs only, with the rubric in `../judge/groundedness.md`. A draft passes when every claim is supported; it fails on any unsupported claim, an unsupported promise or a request for an authentication factor.
3. Write one line per row to `labels.jsonl`, the whole object on that one line:

   ```text
   {"row_id":"row-007","human_pass":false,"reason":"promises a refund date pol-04 does not give"}
   ```

   Every label needs a one-line reason. Label every row; a row without a label keeps the judge out of the decision. Some rows are a copy of another row with one change; judge each row on its own, not against its neighbours.

4. Run `pnpm eval:agreement`. It reports TPR (the judge fails a draft you failed) and TNR (the judge passes a draft you passed) with 95% intervals, kappa as a secondary number, and every disagreement.

The judge counts toward the decision only if it failed all 7 known-bad controls, TPR ≥ 0.8 and TNR ≥ 0.9. `pnpm eval:report` checks all of this and rewrites the EVALS.md summary with the judge counted or informational. Changing the rubric after seeing the agreement makes the judge informational for that run. `pnpm eval:judgments` refuses to run while `labels.jsonl` exists, because new row ids would label the wrong drafts.

## After a re-judge

When `pnpm eval:rejudge` re-judges the newest run under a corrected judge input (specs/03-evals.md §Judge validation), the rows must be exported again and the existing labels carried over:

1. Move the current calibration files (`to-label.jsonl`, `judgments.jsonl`, `key.jsonl`, `controls.json`, `labels.jsonl`) to a folder outside the repo.
2. Run `pnpm eval:judgments` on the re-judged run (paid: mutation rows and controls are judged again).
3. Run `pnpm eval:carry-labels <that folder>`. A label is carried only when the new row's evidence is identical and filling its placeholders reproduces the old draft exactly; rows with no reply are dropped and the rest are listed to label again.
4. Label the listed rows, then `pnpm eval:agreement` and `pnpm eval:report`. EVALS.md states that the labels were carried over from the first agreement.
