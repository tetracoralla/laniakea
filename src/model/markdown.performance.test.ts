import { expect, it } from "vitest";
import { parseMarkdownDocument } from "./markdown";

// npm test runs this after the functional suite, with one worker. Parallel
// DOM tests otherwise contend for CPU and turn this elapsed-time check into
// a measurement of the runner's unrelated workload. Keep the original bound.
it("parses a 5,000-node outline within 1,500 ms", () => {
  const markdown = [
    "- 大图性能样本",
    ...Array.from({ length: 4_999 }, (_, index) => `  - 节点 ${index + 1}`),
  ].join("\n");
  const startedAt = performance.now();
  const parsed = parseMarkdownDocument(markdown, "性能样本");
  const elapsed = performance.now() - startedAt;
  expect(Object.keys(parsed.document.nodes)).toHaveLength(5_000);
  console.log(`5,000-node outline parse: ${Math.round(elapsed)} ms`);
  expect(elapsed).toBeLessThan(1_500);
});
