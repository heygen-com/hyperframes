// Run under Bun by urlDownloader.runtimes.test.ts: every name resolves to a private address.
import dns from "node:dns";

let lookups = 0;
dns.lookup = (_host, _options, callback) => {
  lookups += 1;
  callback(null, [{ address: "10.1.2.3", family: 4 }]);
};

const { fetchPublicHttpsText } = await import("../urlDownloader.ts");
const outcome = await fetchPublicHttpsText("https://assets.example.test/x.html", {
  maxBytes: 1024,
}).then(
  () => "fetched",
  (error) => error?.kind ?? String(error),
);
console.log(JSON.stringify({ outcome, lookups }));
