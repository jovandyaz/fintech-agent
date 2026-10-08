# Labeling the judge's calibration rows

The groundedness judge counts toward the variant decision only after a person agrees with it (specs/03-evals.md §Judge validation). These files hold that check.

| File              | Written by            | Holds                                                                                                                                              |
| ----------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `to-label.jsonl`  | `pnpm eval:judgments` | One row per draft, shuffled, under an opaque id: the first attempt of each case and variant, and about 14 of those drafts with one injected defect |
| `judgments.jsonl` | `pnpm eval:judgments` | The judge's verdict on each row. **Do not open it until you have labeled every row.**                                                              |
| `labels.jsonl`    | you                   | Your verdict on each row                                                                                                                           |
| `key.jsonl`       | `pnpm eval:judgments` | What each opaque id stands for (case, variant, injected defect), read by the scripts. **Do not open it until you have labeled every row.**         |

## How to label

1. Open `to-label.jsonl`. Each line has a `row_id` and a `judge_input`: the draft reply, the policy chunks it cites and the masked tool outputs.
2. Rows do not say which case, variant or kind of draft they are, on purpose. Read the draft against the chunks and the tool outputs only, with the rubric in `../judge/groundedness.md`. A draft passes when every claim is supported; it fails on any unsupported claim, an unsupported promise or a request for an authentication factor.
3. Write one line per row to `labels.jsonl`, the whole object on that one line:

   ```text
   {"row_id":"row-007","human_pass":false,"reason":"promises a refund date pol-04 does not give"}
   ```

   Every label needs a one-line reason. Label every row; a row without a label keeps the judge out of the decision. Some rows are a copy of another row with one change; judge each row on its own, not against its neighbours.

4. Run `pnpm eval:agreement`. It reports TPR (the judge fails a draft you failed) and TNR (the judge passes a draft you passed) with 95% intervals, kappa as a secondary number, and every disagreement.

The judge counts toward the decision only if it failed all 7 known-bad controls, TPR ≥ 0.8 and TNR ≥ 0.9. Changing the rubric after seeing the agreement makes the judge informational for that run.
