import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  checkbox,
  choice,
  describedBy,
  field,
  fieldset,
  form,
  input,
  radio,
  select,
  switchControl,
  textarea,
} from "../src/design-system/primitives/form.js";
import { toHtmlString } from "../src/design-system/utils/html.js";

const out = (value: ReturnType<typeof field>): string => toHtmlString(value);

describe("form field accessibility", () => {
  it("associates the label with the control by id", () => {
    const rendered = out(
      field({ id: "agent-name", label: "Agent name", children: input({ id: "agent-name" }) }),
    );
    assert.ok(rendered.includes('for="agent-name"'), "the label must reference the control");
    assert.ok(rendered.includes('id="agent-name"'), "the control must carry the id the label targets");
  });

  it("renders the label text", () => {
    const rendered = out(field({ id: "x", label: "Name", children: input({ id: "x" }) }));
    assert.ok(rendered.includes("Name"));
  });

  it("wires help text to the control through describedBy", () => {
    assert.equal(describedBy({ id: "x", hasDescription: true }), "x-description");
  });

  it("wires the error message to the control through describedBy", () => {
    assert.equal(describedBy({ id: "x", hasError: true }), "x-error");
  });

  it("combines both references when both exist", () => {
    assert.equal(describedBy({ id: "x", hasDescription: true, hasError: true }), "x-description x-error");
  });

  it("returns undefined when there is nothing to describe", () => {
    assert.equal(describedBy({ id: "x" }), undefined, "aria-describedby must not point at nothing");
  });

  it("renders description and error with the ids describedBy expects", () => {
    const rendered = out(
      field({
        id: "email",
        label: "Email",
        description: "Work address",
        error: "Enter a valid address",
        children: input({ id: "email", ariaDescribedBy: describedBy({ id: "email", hasDescription: true, hasError: true }) }),
      }),
    );
    assert.ok(rendered.includes('id="email-description"'));
    assert.ok(rendered.includes('id="email-error"'));
    assert.ok(rendered.includes('aria-describedby="email-description email-error"'));
  });
});

describe("form field validation states", () => {
  it("marks the field invalid when an error is present", () => {
    const rendered = out(field({ id: "x", label: "L", error: "Required", children: input({ id: "x" }) }));
    assert.ok(rendered.includes('data-invalid="true"'));
  });

  it("is not marked invalid without an error", () => {
    const rendered = out(field({ id: "x", label: "L", children: input({ id: "x" }) }));
    assert.equal(rendered.includes('data-invalid="true"'), false);
  });

  it("renders the error text visibly, not only in ARIA", () => {
    const rendered = out(field({ id: "x", label: "L", error: "Required", children: input({ id: "x" }) }));
    assert.ok(rendered.includes("Required"));
    assert.ok(rendered.includes("toz-field__message"));
  });

  it("sets aria-invalid on the control itself", () => {
    const rendered = toHtmlString(input({ id: "x", invalid: true }));
    assert.ok(rendered.includes('aria-invalid="true"'));
  });

  it("omits aria-invalid when the control is valid", () => {
    assert.equal(toHtmlString(input({ id: "x" })).includes("aria-invalid"), false);
  });

  it("marks a disabled field", () => {
    const rendered = out(field({ id: "x", label: "L", disabled: true, children: input({ id: "x" }) }));
    assert.ok(rendered.includes('data-disabled="true"'));
    assert.ok(toHtmlString(input({ id: "x", disabled: true })).includes("disabled"));
  });
});

describe("form field required indicator", () => {
  it("uses the native required attribute", () => {
    assert.ok(toHtmlString(input({ id: "x", required: true })).includes("required"));
  });

  it("renders a visual asterisk", () => {
    const rendered = out(field({ id: "x", label: "L", required: true, children: input({ id: "x" }) }));
    assert.ok(rendered.includes("toz-field__required"));
  });

  it("hides the asterisk from assistive technology to avoid a doubled announcement", () => {
    const rendered = out(field({ id: "x", label: "L", required: true, children: input({ id: "x" }) }));
    assert.ok(
      /class="toz-field__required" aria-hidden="true"/.test(rendered),
      "the required state must be announced once, via the native attribute",
    );
  });

  it("omits the asterisk when the field is optional", () => {
    const rendered = out(field({ id: "x", label: "L", children: input({ id: "x" }) }));
    assert.equal(rendered.includes("toz-field__required"), false);
  });
});

describe("text-like controls", () => {
  it("defaults the name to the id so the control posts something", () => {
    assert.ok(toHtmlString(input({ id: "email" })).includes('name="email"'));
  });

  it("supports input types", () => {
    for (const type of ["email", "tel", "url", "password", "search", "number"] as const) {
      assert.ok(toHtmlString(input({ id: "x", type })).includes(`type="${type}"`));
    }
  });

  it("passes through autocomplete and inputmode hints", () => {
    const rendered = toHtmlString(input({ id: "x", autoComplete: "email", inputMode: "email" }));
    assert.ok(rendered.includes('autocomplete="email"'));
    assert.ok(rendered.includes('inputmode="email"'));
  });

  it("supports read-only", () => {
    assert.ok(toHtmlString(input({ id: "x", readOnly: true })).includes("readonly"));
  });

  it("renders a textarea with a default row count", () => {
    assert.ok(toHtmlString(textarea({ id: "x" })).includes('rows="4"'));
  });

  it("escapes textarea content", () => {
    const rendered = toHtmlString(textarea({ id: "x", value: "</textarea><script>" }));
    assert.equal(rendered.includes("<script>"), false);
  });
});

describe("select", () => {
  it("renders each option", () => {
    const rendered = toHtmlString(
      select({
        id: "s",
        options: [
          { value: "a", label: "Alpha" },
          { value: "b", label: "Beta" },
        ],
      }),
    );
    assert.ok(rendered.includes('value="a"'));
    assert.ok(rendered.includes("Alpha"));
    assert.ok(rendered.includes("Beta"));
  });

  it("marks the selected option", () => {
    const rendered = toHtmlString(
      select({ id: "s", value: "b", options: [{ value: "a", label: "A" }, { value: "b", label: "B" }] }),
    );
    assert.ok(/value="b" selected="selected"/.test(rendered));
  });

  it("renders a disabled placeholder when given", () => {
    const rendered = toHtmlString(select({ id: "s", placeholder: "Choose one", options: [{ value: "a", label: "A" }] }));
    assert.ok(rendered.includes("Choose one"));
    assert.ok(rendered.includes("disabled"));
  });

  it("groups related options with optgroup", () => {
    const rendered = toHtmlString(
      select({
        id: "s",
        options: [
          { value: "a", label: "A", group: "Group one" },
          { value: "b", label: "B", group: "Group two" },
        ],
      }),
    );
    assert.ok(rendered.includes('<optgroup label="Group one">'));
    assert.ok(rendered.includes('<optgroup label="Group two">'));
  });

  it("marks an individual option disabled", () => {
    const rendered = toHtmlString(
      select({ id: "s", options: [{ value: "a", label: "A", disabled: true }] }),
    );
    assert.ok(/value="a"[^>]*disabled/.test(rendered));
  });
});

describe("choice controls", () => {
  it("wraps the control in a label for a large hit area", () => {
    const rendered = toHtmlString(checkbox({ id: "c", name: "c", label: "Enable" }));
    assert.ok(rendered.includes('for="c"'));
    assert.ok(rendered.includes('type="checkbox"'));
    assert.ok(rendered.includes("Enable"));
  });

  it("renders radios with a shared name so the group behaves natively", () => {
    const rendered = toHtmlString(radio({ id: "r1", name: "mode", label: "One" }));
    assert.ok(rendered.includes('type="radio"'));
    assert.ok(rendered.includes('name="mode"'));
  });

  it("marks the checked control", () => {
    assert.ok(toHtmlString(checkbox({ id: "c", name: "c", label: "x", checked: true })).includes("checked"));
  });

  it("supports a description under the label", () => {
    const rendered = toHtmlString(checkbox({ id: "c", name: "c", label: "Enable", description: "Turns it on" }));
    assert.ok(rendered.includes("Turns it on"));
  });

  it("marks a disabled choice on both the label and the control", () => {
    const rendered = toHtmlString(choice({ id: "c", type: "checkbox", name: "c", label: "x", disabled: true }));
    assert.ok(rendered.includes('data-disabled="true"'));
    assert.ok(rendered.includes("disabled"));
  });

  it("renders a switch as a checkbox with the switch role", () => {
    const rendered = toHtmlString(switchControl({ id: "s", label: "Auto-route" }));
    // A real checkbox underneath means keyboard, form and :checked all work
    // without JavaScript; the role only changes the announced state.
    assert.ok(rendered.includes('type="checkbox"'));
    assert.ok(rendered.includes('role="switch"'));
    assert.ok(rendered.includes("toz-switch__control"));
  });
});

describe("fieldset and form", () => {
  it("uses fieldset and legend so a group is announced", () => {
    const rendered = toHtmlString(fieldset({ legend: "Provider", children: "options" }));
    assert.match(rendered, /^<fieldset/);
    assert.ok(rendered.includes("<legend"));
    assert.ok(rendered.includes("Provider"));
  });

  it("disables the whole group at once", () => {
    assert.ok(toHtmlString(fieldset({ legend: "P", children: "", disabled: true })).includes("disabled"));
  });

  it("renders a form defaulting to post", () => {
    const rendered = toHtmlString(form({ children: "fields" }));
    assert.match(rendered, /^<form/);
    assert.ok(rendered.includes('method="post"'));
  });

  it("supports opt-out of native validation", () => {
    assert.ok(toHtmlString(form({ children: "", noValidate: true })).includes("novalidate"));
  });
});
