/**
 * Records rendered by the self-hosted demo source page.
 *
 * Public-domain quotations, chosen so the demo page carries no personal,
 * private or licensed content. The same records are rendered under both
 * layouts, which is what makes the layout switch a pure structural change:
 * the data is identical, only the DOM differs.
 */

export interface DemoFixtureQuote {
  quoteText: string;
  author: string;
  tags: string[];
}

export const DEMO_FIXTURE_QUOTES: readonly DemoFixtureQuote[] = [
  {
    quoteText: "The only thing we have to fear is fear itself.",
    author: "Franklin D. Roosevelt",
    tags: ["courage", "politics"],
  },
  {
    quoteText: "In the middle of difficulty lies opportunity.",
    author: "Albert Einstein",
    tags: ["opportunity", "science"],
  },
  {
    quoteText: "That which does not kill us makes us stronger.",
    author: "Friedrich Nietzsche",
    tags: ["philosophy", "resilience"],
  },
  {
    quoteText: "It is not death that a man should fear, but never beginning to live.",
    author: "Marcus Aurelius",
    tags: ["philosophy", "life"],
  },
  {
    quoteText: "The unexamined life is not worth living.",
    author: "Socrates",
    tags: ["philosophy", "wisdom"],
  },
  {
    quoteText: "Whereof one cannot speak, thereof one must be silent.",
    author: "Ludwig Wittgenstein",
    tags: ["language", "philosophy"],
  },
  {
    quoteText: "A room without books is like a body without a soul.",
    author: "Marcus Tullius Cicero",
    tags: ["books", "reading"],
  },
  {
    quoteText: "We are what we repeatedly do; excellence is a habit.",
    author: "Aristotle",
    tags: ["excellence", "habit"],
  },
  {
    quoteText: "Knowing yourself is the beginning of all wisdom.",
    author: "Aristotle",
    tags: ["self-knowledge", "wisdom"],
  },
  {
    quoteText: "The journey of a thousand miles begins with a single step.",
    author: "Laozi",
    tags: ["beginnings", "perseverance"],
  },
];
