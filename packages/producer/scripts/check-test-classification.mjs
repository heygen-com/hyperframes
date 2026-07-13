import { discoverProducerTests, summarizeTests } from "./test-classification.mjs";

try {
  const tests = discoverProducerTests();
  console.log(JSON.stringify({ event: "producer_tests_classified", ...summarizeTests(tests) }));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
