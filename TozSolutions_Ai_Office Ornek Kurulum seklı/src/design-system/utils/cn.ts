/**
 * Class-name composition.
 *
 * Accepts strings, conditional maps and arrays, and de-duplicates the result.
 * Keeping this in one place is what stops class strings from drifting into
 * inconsistent ad-hoc concatenations across components.
 */

export type ClassValue = string | number | false | null | undefined | ClassMap | readonly ClassValue[];

export interface ClassMap {
  readonly [className: string]: boolean | null | undefined;
}

function collect(value: ClassValue, out: Set<string>): void {
  if (value === null || value === undefined || value === false || value === "") {
    return;
  }
  if (typeof value === "string" || typeof value === "number") {
    for (const token of String(value).split(/\s+/)) {
      if (token !== "") {
        out.add(token);
      }
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value as readonly ClassValue[]) {
      collect(entry, out);
    }
    return;
  }
  for (const [className, enabled] of Object.entries(value as ClassMap)) {
    if (enabled) {
      collect(className, out);
    }
  }
}

/** Joins class names, dropping falsy entries and removing duplicates. */
export function cn(...values: readonly ClassValue[]): string {
  const out = new Set<string>();
  for (const value of values) {
    collect(value, out);
  }
  return [...out].join(" ");
}
