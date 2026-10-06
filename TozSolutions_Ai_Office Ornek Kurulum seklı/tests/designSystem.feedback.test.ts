import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ALERT_TONES,
  alert,
  errorMessage,
  infoMessage,
  notice,
  successMessage,
  warningMessage,
} from "../src/design-system/primitives/feedback.js";
import {
  HEALTH_LABELS,
  badge,
  emptyState,
  healthIndicator,
  loadingState,
  metric,
  progress,
  skeleton,
  skeletonGroup,
  spinner,
  statusDot,
  timestamp,
} from "../src/design-system/primitives/status.js";
import { confirmDialog, dialog, openDialogEnhancer, popover, popoverTrigger, tooltip } from "../src/design-system/primitives/overlay.js";
import { toHtmlString } from "../src/design-system/utils/html.js";

const out = (value: { toString(): string }): string => toHtmlString(value as never);

describe("alerts", () => {
  it("supports every tone", () => {
    for (const tone of ALERT_TONES) {
      assert.ok(out(alert({ tone, children: "Message" })).includes(`data-tone="${tone}"`));
    }
  });

  it("does not announce a static message on load", () => {
    // A live region that is already populated when the page loads is read out
    // unexpectedly, which is noise.
    const rendered = out(alert({ tone: "info", children: "Hi" }));
    assert.equal(rendered.includes("role="), false);
    assert.equal(rendered.includes("aria-live"), false);
  });

  it("announces a live error assertively", () => {
    const rendered = out(alert({ tone: "error", children: "Failed", live: true }));
    assert.ok(rendered.includes('role="alert"'));
    assert.ok(rendered.includes('aria-live="assertive"'));
  });

  it("announces a live non-error politely", () => {
    for (const tone of ["info", "success", "warning"] as const) {
      const rendered = out(alert({ tone, children: "x", live: true }));
      assert.ok(rendered.includes('role="status"'), `${tone} should use role=status`);
      assert.ok(rendered.includes('aria-live="polite"'));
    }
  });

  it("renders a title distinctly from the body", () => {
    const rendered = out(alert({ tone: "info", title: "Heads up", children: "Details" }));
    assert.ok(rendered.includes("toz-alert__title"));
    assert.ok(rendered.includes("Heads up"));
    assert.ok(rendered.includes("Details"));
  });

  it("hides the decorative icon from assistive technology", () => {
    assert.ok(out(alert({ tone: "info", children: "x" })).includes('aria-hidden="true"'));
  });

  it("can omit the icon", () => {
    assert.equal(out(alert({ tone: "info", children: "x", hideIcon: true })).includes("toz-alert__icon"), false);
  });

  it("renders an action slot", () => {
    const rendered = out(alert({ tone: "error", children: "x", action: "<button>Retry</button>" }));
    assert.ok(rendered.includes("Retry"));
  });

  it("provides the four convenience helpers with the right tone and title", () => {
    assert.ok(out(successMessage("saved")).includes('data-tone="success"'));
    assert.ok(out(successMessage("saved")).includes("Success"));
    assert.ok(out(errorMessage("failed")).includes('data-tone="error"'));
    assert.ok(out(errorMessage("failed")).includes("Something went wrong"));
    assert.ok(out(warningMessage("careful")).includes('data-tone="warning"'));
    assert.ok(out(warningMessage("careful")).includes("Warning"));
    // `infoMessage` deliberately has no title, so the body is the whole message.
    const info = out(infoMessage("fyi"));
    assert.ok(info.includes('data-tone="info"'));
    assert.ok(info.includes("fyi"));
    assert.equal(info.includes("toz-alert__title"), false, "an info message should not force a title");
  });

  it("makes the convenience helpers live", () => {
    assert.ok(out(successMessage("ok")).includes('aria-live="polite"'));
    assert.ok(out(errorMessage("bad")).includes('aria-live="assertive"'));
  });

  it("renders a notice with an optional label", () => {
    const rendered = out(notice({ label: "New", children: "feature" }));
    assert.ok(rendered.includes("New"));
    assert.ok(rendered.includes("feature"));
  });
});

describe("status components", () => {
  it("renders a status dot", () => {
    assert.ok(out(statusDot({ tone: "success", label: "ok" })).includes('data-tone="success"'));
  });

  it("gives a labelled dot an accessible role and name", () => {
    const rendered = out(statusDot({ tone: "error", label: "Failed" }));
    assert.ok(rendered.includes('role="img"'));
    assert.ok(rendered.includes('aria-label="Failed"'));
  });

  it("renders a badge in each tone", () => {
    for (const tone of ["neutral", "info", "success", "warning", "error", "processing"] as const) {
      assert.ok(out(badge({ tone, children: "t" })).includes(`data-tone="${tone}"`));
    }
  });

  it("adds a live region for a processing badge", () => {
    const rendered = out(badge({ children: "Running", tone: "processing", live: true }));
    assert.ok(rendered.includes('role="status"'));
    assert.ok(rendered.includes('aria-live="polite"'));
  });

  it("leaves a static badge out of the accessibility tree as a live region", () => {
    assert.equal(out(badge({ children: "Ready" })).includes("aria-live"), false);
  });

  it("labels every health state in words, not only colour", () => {
    for (const [state, label] of Object.entries(HEALTH_LABELS)) {
      const rendered = out(healthIndicator({ state: state as keyof typeof HEALTH_LABELS }));
      assert.ok(rendered.includes(label), `${state} must state its condition as text`);
    }
  });

  it("accepts a health detail", () => {
    assert.ok(out(healthIndicator({ state: "healthy", detail: "120 ms" })).includes("120 ms"));
  });
});

describe("progress and loading", () => {
  it("exposes an accessible progressbar with a label", () => {
    const rendered = out(progress({ value: 40, label: "Queue depth" }));
    assert.ok(rendered.includes('role="progressbar"'));
    assert.ok(rendered.includes('aria-label="Queue depth"'));
    assert.ok(rendered.includes('aria-valuenow="40"'));
    assert.ok(rendered.includes('aria-valuetext="Queue depth: 40%"'));
  });

  it("renders an indeterminate bar without a misleading value", () => {
    const rendered = out(progress({ label: "Working" }));
    assert.ok(rendered.includes('data-indeterminate="true"'));
    assert.equal(rendered.includes("aria-valuenow"), false, "an unknown progress must not claim a value");
    assert.ok(rendered.includes('aria-valuetext="Working: in progress"'));
  });

  it("clamps out-of-range values instead of rendering a broken bar", () => {
    assert.ok(out(progress({ value: 150, label: "x" })).includes('style="inline-size: 100%"'));
    assert.ok(out(progress({ value: -5, label: "x" })).includes('style="inline-size: 0%"'));
  });

  it("gives a spinner an accessible label", () => {
    const rendered = out(spinner({ label: "Loading agents" }));
    assert.ok(rendered.includes('role="status"'));
    assert.ok(rendered.includes("Loading agents"));
  });

  it("hides skeleton placeholders from assistive technology", () => {
    // One status message per group, not one per placeholder.
    const rendered = out(skeleton({ label: "Loading" }));
    assert.ok(rendered.includes('aria-hidden="true"'));
  });

  it("wraps a skeleton group in a single labelled status", () => {
    const rendered = out(skeletonGroup({ label: "Loading results", lines: 3 }));
    assert.ok(rendered.includes('role="status"'));
    assert.ok(rendered.includes('aria-label="Loading results"'));
    assert.equal(rendered.match(/toz-skeleton/g)?.length, 3);
  });

  it("explains an empty state and offers an action", () => {
    const rendered = out(
      emptyState({ title: "No agents yet", description: "Create one to get started.", action: "<button>Create</button>" }),
    );
    assert.ok(rendered.includes("No agents yet"));
    assert.ok(rendered.includes("Create one to get started."));
    assert.ok(rendered.includes("Create"));
  });

  it("announces a loading state", () => {
    assert.ok(out(loadingState({ label: "Loading" })).includes('role="status"'));
  });
});

describe("metric and timestamp", () => {
  it("renders a label and a pre-formatted value", () => {
    const rendered = out(metric({ label: "Providers", value: "3 active" }));
    assert.ok(rendered.includes("Providers"));
    assert.ok(rendered.includes("3 active"));
  });

  it("marks the direction of a delta without relying on colour alone", () => {
    for (const direction of ["up", "down", "flat"] as const) {
      assert.ok(out(metric({ label: "L", value: "1", delta: "+2", deltaDirection: direction })).includes(`data-direction="${direction}"`));
    }
  });

  it("renders a machine-readable timestamp", () => {
    const rendered = out(timestamp({ text: "2 minutes ago", iso: "2026-01-01T00:00:00.000Z" }));
    assert.ok(rendered.includes("<time"));
    assert.ok(rendered.includes('datetime="2026-01-01T00:00:00.000Z"'));
    assert.ok(rendered.includes("2 minutes ago"));
  });
});

describe("dialog accessibility", () => {
  it("renders a native dialog element", () => {
    assert.match(out(dialog({ id: "d", title: "Confirm", children: "body" })), /^<dialog/);
  });

  it("labels the dialog by its heading", () => {
    const rendered = out(dialog({ id: "d", title: "Delete agent", children: "b" }));
    assert.ok(rendered.includes('aria-labelledby="d-title"'));
    assert.ok(rendered.includes('id="d-title"'));
  });

  it("gives the close control an accessible name", () => {
    const rendered = out(dialog({ id: "d", title: "T", children: "b" }));
    assert.ok(rendered.includes("Close dialog"));
    assert.ok(rendered.includes('data-dialog-close="d"'));
  });

  it("can omit the close control", () => {
    assert.equal(out(dialog({ id: "d", title: "T", children: "b", closable: false })).includes("Close dialog"), false);
  });

  it("renders a footer for actions", () => {
    assert.ok(out(dialog({ id: "d", title: "T", children: "b", footer: "<button>OK</button>" })).includes("toz-dialog__footer"));
  });

  it("does not autofocus the confirm action in a confirmation dialog", () => {
    // A stray Enter must not perform a destructive action.
    const rendered = out(confirmDialog({ id: "c", title: "Delete?", children: "b", confirmLabel: "Delete" }));
    assert.equal(rendered.includes("autofocus"), false);
  });

  it("marks a destructive confirm action", () => {
    const rendered = out(
      confirmDialog({ id: "c", title: "Delete?", children: "b", confirmLabel: "Delete", destructive: true }),
    );
    assert.ok(rendered.includes('data-variant="destructive"'));
  });

  it("uses a non-destructive confirm variant by default", () => {
    const rendered = out(confirmDialog({ id: "c", title: "Save?", children: "b", confirmLabel: "Save" }));
    assert.ok(rendered.includes('data-variant="primary"'));
  });

  it("emits a dialog enhancer that uses the platform API", () => {
    const script = openDialogEnhancer();
    assert.ok(script.includes("showModal"), "the enhancer must use the native dialog API");
    assert.ok(script.includes("data-dialog-open"));
    assert.ok(script.includes("data-dialog-close"));
  });

  it("emits a small enhancer with no external dependency", () => {
    const script = openDialogEnhancer();
    assert.equal(script.includes("import "), false);
    assert.equal(script.includes("require("), false);
    assert.ok(script.length < 2000, "the enhancer should stay minimal");
  });
});

describe("popover and tooltip", () => {
  it("renders a native popover", () => {
    const rendered = out(popover({ id: "p", children: "Details" }));
    assert.ok(rendered.includes('popover="auto"'));
    assert.ok(rendered.includes('role="dialog"'));
  });

  it("supports a manually placed popover", () => {
    assert.ok(out(popover({ id: "p", children: "x", placement: "manual" })).includes('popover="manual"'));
  });

  it("wires a trigger to its popover with popovertarget, no script", () => {
    const rendered = out(popoverTrigger({ targetId: "p", children: "Open" }));
    assert.ok(rendered.includes('popovertarget="p"'));
    assert.equal(rendered.includes("onclick"), false, "no inline handler is needed");
  });

  it("renders a CSS-only tooltip", () => {
    const rendered = out(tooltip({ children: "<button>Info</button>", content: "Explains the control" }));
    assert.ok(rendered.includes('role="tooltip"'));
    assert.ok(rendered.includes("toz-tooltip"));
  });

  it("hides tooltip text from assistive technology, since the label carries the meaning", () => {
    const rendered = out(tooltip({ children: "<button>Info</button>", content: "Explains" }));
    assert.ok(rendered.includes('aria-hidden="true"'));
  });
});
