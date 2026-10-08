import {
  APPROVED_FACTOR_WARNINGS,
  MAX_REPLY_CHARS,
} from '@fintech-agent/contracts/console';
import { useLayoutEffect, useRef } from 'react';

const ENDS_IN_SPACE = /\s$/;
const STARTS_WITH_SPACE = /^\s/;
// At most one space before and one after an inserted sentence.
const SEPARATORS = 2;

// A warning dropped mid-sentence keeps one space on each side, so the
// sentence the validator matches stays whole (02 G5 AUTH_FACTOR_REQUEST).
function insertAt(
  text: string,
  at: number,
  sentence: string,
): { text: string; caret: number } {
  const before = text.slice(0, at);
  const after = text.slice(at);
  const lead = before === '' || ENDS_IN_SPACE.test(before) ? '' : ' ';
  const trail = after === '' || STARTS_WITH_SPACE.test(after) ? '' : ' ';
  const inserted = `${before}${lead}${sentence}`;
  return { text: `${inserted}${trail}${after}`, caret: inserted.length };
}

/**
 * The reply the customer will get, edited as plain text. The only sentences
 * that may name an authentication factor are offered for insertion at the
 * cursor, so the operator never has to type one.
 */
export function ReplyEditor(props: {
  value: string;
  onChange: (value: string) => void;
}) {
  const field = useRef<HTMLTextAreaElement>(null);
  const caretAfterInsert = useRef<number | null>(null);
  // A value set from code puts the caret at the end; it belongs after the
  // sentence just inserted.
  useLayoutEffect(() => {
    const caret = caretAfterInsert.current;
    if (caret === null) return;
    caretAfterInsert.current = null;
    field.current?.focus();
    field.current?.setSelectionRange(caret, caret);
  }, [props.value]);
  const insert = (sentence: string) => {
    const at = field.current?.selectionStart ?? props.value.length;
    const next = insertAt(props.value, at, sentence);
    caretAfterInsert.current = next.caret;
    props.onChange(next.text);
  };
  // maxLength bounds typing only, not a value set from code.
  const fits = (sentence: string) =>
    props.value.length + sentence.length + SEPARATORS <= MAX_REPLY_CHARS;
  return (
    <div className="reply-editor">
      <label>
        Respuesta al cliente
        <textarea
          ref={field}
          rows={8}
          maxLength={MAX_REPLY_CHARS}
          value={props.value}
          onChange={(event) => props.onChange(event.target.value)}
        />
      </label>
      <div className="reply-inserts">
        {APPROVED_FACTOR_WARNINGS.map((sentence) => (
          <button
            key={sentence}
            type="button"
            className="button-quiet"
            disabled={!fits(sentence)}
            onClick={() => insert(sentence)}
          >
            {`Insertar: ${sentence}`}
          </button>
        ))}
      </div>
    </div>
  );
}
