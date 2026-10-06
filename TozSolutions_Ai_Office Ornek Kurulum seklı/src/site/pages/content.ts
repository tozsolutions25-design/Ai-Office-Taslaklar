/**
 * Inner-page content.
 *
 * The rule that governs this file: every string here is a statement the
 * repository can support. The page copy is derived from the real data already in
 * `content.ts` — capabilities, architecture layers, process steps, reliability
 * principles — all of which describe shipped code.
 *
 * What is deliberately ABSENT, because the repository does not contain it:
 *
 *   - No customer names, logos, testimonials, ratings or review counts.
 *   - No pricing, no response-time promises, no uptime figures.
 *   - No address, phone number, opening hours, team size, awards or
 *     certifications.
 *   - No email address or sales channel that does not exist in the repository.
 *
 * A contact page that invents an inbox is worse than one that says plainly how
 * the project is reached, because a visitor who mails a fabricated address waits
 * forever for a reply that was never possible.
 */

/** A question-and-answer pair, for the machine-readable FAQ on the About page. */
export interface FaqEntry {
  readonly question: string;
  readonly answer: string;
}

/**
 * About-page narrative.
 *
 * `principles` is the reliability data itself rather than a restatement, so the
 * page and the homepage cannot drift apart.
 */
export const ABOUT = {
  eyebrow: "About",
  title: "An orchestration system built to be inspected",
  summary:
    "TOZ AI Office coordinates agents, models and providers behind a single control " +
    "plane. Every architectural claim this site makes is enforced in code and covered " +
    "by an automated test.",
  paragraphs: [
    "The system exists because coordinating agents is mostly a problem of authority. " +
      "Several components are each capable of deciding what should run, and a " +
      "deployment in which two of them disagree is a deployment nobody can reason " +
      "about. So this project is organised around a single answer to one question: " +
      "which component is allowed to decide what happens next?",
    "The answer is the orchestrator. It owns the sequence from request to result. " +
      "Routing, verification, memory access and authorization each have their own " +
      "authority, and none of them can advance a task, choose a different plan, or " +
      "override a refusal. That constraint is enforced by the shape of the " +
      "interfaces, not by convention or documentation.",
    "What follows on this site is therefore a description of shipped behaviour " +
      "rather than a pitch. Where a guarantee is bounded, the bound is stated.",
  ],
  /** Answers, all sourced from the architecture rather than invented. */
  faq: [
    {
      question: "What decides which agent runs a task?",
      answer:
        "The orchestrator, through a specialist pool. Selection is a deterministic " +
        "capability match, and the decision is recorded so it can be explained after " +
        "the fact rather than reconstructed.",
    },
    {
      question: "Who chooses the model and provider?",
      answer:
        "Routing does, through a fixed policy that filters candidates by capability, " +
        "context and health before any ordering is applied. An authorization layer may " +
        "remove candidates before that filter runs, but it cannot choose one.",
    },
    {
      question: "What happens when a step fails?",
      answer:
        "Failures are classified before anything is retried. Permanent classes — a " +
        "bad request, a rejected credential, a missing model — are never retried, so no " +
        "configuration can turn a failure into an unbounded loop.",
    },
    {
      question: "Can a task be marked successful without being verified?",
      answer:
        "No. A result that no verifier checked is reported as needing review, and that " +
        "state is explicitly not a pass. Verification is a separate authority that " +
        "records what it checked.",
    },
    {
      question: "Is any of this running in production?",
      answer:
        "No. This is a library and a reference architecture. There is no server, no " +
        "database, and no provider client in the repository. The site's job is to " +
        "describe the design accurately, including its limits.",
    },
  ] as readonly FaqEntry[],
} as const;

/**
 * Contact.
 *
 * There is no published inbox in this repository, so none is invented. The
 * contact page is therefore a real instruction — how to reach the project — plus
 * a named alternative for the two things visitors actually want.
 */
export const CONTACT = {
  eyebrow: "Contact",
  title: "Contact",
  summary:
    "This project has no published sales channel. Below is how to reach it, and " +
    "where to look first depending on what you need.",
  /**
   * Deliberately not a mailto: link. A fabricated address is a promise the
   * project cannot keep, and it is not something a build can verify.
   */
  channels: [
    {
      id: "repository",
      heading: "The repository is the primary channel",
      body:
        "Questions about the architecture, the guarantees and the limitations are " +
        "best answered by the code and its documentation. The architecture document " +
        "states the non-goals as precisely as the goals, and it is the shortest route " +
        "to an accurate picture of what the system does.",
      route: "/about",
      linkLabel: "Read what the system does",
    },
    {
      id: "capabilities",
      heading: "Evaluating a specific requirement",
      body:
        "Each capability has its own page describing how it behaves, which decision " +
        "authority owns it, and what it explicitly does not do. If you are assessing " +
        "fit, the capability pages answer more precisely than a contact form would.",
      route: "/capabilities",
      linkLabel: "Browse the capabilities",
    },
  ] as const,
  /**
   * Stated plainly on the page rather than left for a reader to infer. A contact
   * page that admits its own limits is more useful than one that pretends.
   */
  unavailable: [
    "No sales or support inbox is published for this project.",
    "No phone number, address or opening hours exist to publish.",
    "No response-time commitment is made, because none is operated.",
  ] as readonly string[],
} as const;

/**
 * Projects and blog.
 *
 * Both pages exist as routes with correct metadata but hold no entries, because
 * the repository contains no case studies and no articles. Publishing invented
 * ones — with invented metrics, clients or dates — would be fabricating business
 * facts, which the brief forbids and which a visitor could not distinguish from
 * real ones.
 *
 * Both are `noindex` and are excluded from the sitemap, so an empty page cannot
 * be indexed as though it were thin content. See PROJECT_STATE.md K-09 and K-10.
 */
export const EMPTY_SURFACES = {
  projects: {
    eyebrow: "Projects",
    title: "Projects",
    summary: "No case studies are published yet.",
    heading: "Nothing to show here yet",
    body:
      "This project has not published reference deployments. When it does, each entry " +
      "will name the requirement, the architecture used to meet it, and the limits that " +
      "still applied. Publishing an entry before it exists would mean inventing a client, " +
      "a metric or an outcome.",
    route: "/capabilities",
    linkLabel: "Read the capability pages instead",
  },
  blog: {
    eyebrow: "Blog",
    title: "Blog",
    summary: "No articles are published yet.",
    heading: "No articles yet",
    body:
      "Writing is not the constraint; publishing something unreviewed would be. When " +
      "articles appear they will cover the design decisions and the limits documented " +
      "in the architecture record, not announcements.",
    route: "/about",
    linkLabel: "Read the architecture summary",
  },
} as const;
