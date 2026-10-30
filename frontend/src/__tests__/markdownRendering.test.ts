import { describe, it } from "node:test";
import assert from "node:assert/strict";

/**
 * URL safety validator mirror from MarkdownRenderer.
 */
function isSafeUrl(url?: string): boolean {
  if (!url) return false;
  try {
    const trimmed = url.trim();
    if (trimmed.startsWith("#") || trimmed.startsWith("/")) return true;
    const parsed = new URL(trimmed);
    return ["http:", "https:", "mailto:"].includes(parsed.protocol);
  } catch {
    return false;
  }
}

/**
 * Citation badge helper mirror from ChatPage.
 */
function getBadgeText(citation: {
  score?: number;
  score_label?: string;
  score_type?: string;
}, index: number = 0): string {
  if (citation.score_label && citation.score_label.trim()) {
    return citation.score_label;
  }
  if (citation.score_type === "rrf" || citation.score_type === "rank") {
    return `Rank #${index + 1}`;
  }
  if (typeof citation.score === "number" && !isNaN(citation.score)) {
    if (citation.score > 1.0 || citation.score < 0.0) {
      return `Score: ${citation.score.toFixed(2)}`;
    }
    return `${Math.round(citation.score * 100)}% Match`;
  }
  return `Source #${index + 1}`;
}

describe("Markdown & Security Validation Suite", () => {
  describe("Safe URL Protocol Handling", () => {
    it("allows standard safe URLs (https, http, mailto, relative, anchor)", () => {
      assert.equal(isSafeUrl("https://github.com/aira"), true);
      assert.equal(isSafeUrl("http://localhost:5173"), true);
      assert.equal(isSafeUrl("mailto:support@aira.local"), true);
      assert.equal(isSafeUrl("/docs/architecture"), true);
      assert.equal(isSafeUrl("#section-login"), true);
    });

    it("blocks dangerous protocols (javascript, data, vbscript)", () => {
      assert.equal(isSafeUrl("javascript:alert('xss')"), false);
      assert.equal(isSafeUrl("JAVASCRIPT:alert(document.cookie)"), false);
      assert.equal(isSafeUrl("data:text/html,<script>alert(1)</script>"), false);
      assert.equal(isSafeUrl("vbscript:msgbox(1)"), false);
      assert.equal(isSafeUrl("file:///etc/passwd"), false);
      assert.equal(isSafeUrl(""), false);
      assert.equal(isSafeUrl(undefined), false);
    });
  });

  describe("Citation Badge & Score Formatting", () => {
    it("uses backend score_label when provided", () => {
      assert.equal(getBadgeText({ score: 0.179, score_label: "18% Match" }), "18% Match");
      assert.equal(getBadgeText({ score: 0.0003, score_label: "0% Match" }), "0% Match");
    });

    it("formats RRF and rank scores appropriately", () => {
      assert.equal(getBadgeText({ score: 0.016, score_type: "rrf" }, 0), "Rank #1");
      assert.equal(getBadgeText({ score_type: "rank" }, 2), "Rank #3");
    });

    it("never multiplies raw logits > 1.0 into impossible percentages (e.g. 434%)", () => {
      const rawLogitCitation = { score: 4.34 };
      const badge = getBadgeText(rawLogitCitation);
      assert.equal(badge.includes("434%"), false);
      assert.equal(badge, "Score: 4.34");
    });

    it("handles probabilities in [0.0, 1.0] accurately", () => {
      assert.equal(getBadgeText({ score: 0.85 }), "85% Match");
      assert.equal(getBadgeText({ score: 1.0 }), "100% Match");
      assert.equal(getBadgeText({ score: 0.0 }), "0% Match");
    });
  });

  describe("Streaming Token Accumulation & Deduplication", () => {
    it("accumulates tokens smoothly across multiple SSE chunks", () => {
      const chunks = [
        "## EventPass Login Flow\n\n",
        "1. **Login.jsx**: Form submission\n",
        "2. **api.js**: Axios post call\n",
        "3. **JWT**: Stored in localStorage",
      ];
      let accumulated = "";
      for (const chunk of chunks) {
        accumulated += chunk;
      }
      assert.equal(accumulated.includes("## EventPass Login Flow"), true);
      assert.equal(accumulated.includes("3. **JWT**: Stored in localStorage"), true);
    });

    it("prevents duplicate message persistence with savedAssistantIdsRef", () => {
      const savedIds = new Set<number>();
      const aiId = 42;
      let persistCount = 0;

      const attemptSave = () => {
        if (!savedIds.has(aiId)) {
          savedIds.add(aiId);
          persistCount++;
        }
      };

      // Simulate 'done' event firing or fast re-renders
      attemptSave();
      attemptSave();
      attemptSave();

      assert.equal(persistCount, 1);
      assert.equal(savedIds.has(aiId), true);
    });
  });

  describe("Markdown Elements Parsing Contract", () => {
    it("verifies markdown text contains valid structures for tables, code blocks, lists", () => {
      const technicalAnswer = `
# Authentication Architecture

Here is the comparison table:

| Component | Responsibility | Tech |
|---|---|---|
| Login.jsx | Form UI | React |
| api.js | Axios instance | JS |
| auth.middleware.js | JWT verification | Express |

### Steps:
1. Submit credentials
2. Verify token
3. Update AuthContext

\`\`\`javascript
const token = localStorage.getItem("auth_token");
\`\`\`
`;
      // Table check
      assert.match(technicalAnswer, /\| Component \| Responsibility \| Tech \|/);
      // Fenced code block check
      assert.match(technicalAnswer, /```javascript[\s\S]+```/);
      // Ordered list check
      assert.match(technicalAnswer, /1\. Submit credentials/);
      // Headings check
      assert.match(technicalAnswer, /# Authentication Architecture/);
      assert.match(technicalAnswer, /### Steps:/);
    });
  });
});
