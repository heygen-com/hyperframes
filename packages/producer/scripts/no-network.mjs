// The unit lane never reaches the network: a live Google Fonts fetch timed a unit test out on CI. A test that needs a
// response stubs fetch itself.
globalThis.fetch = async (input) => {
  const url = typeof input === "string" ? input : (input?.url ?? String(input));
  throw new TypeError(`No network in unit tests: ${url}`);
};
