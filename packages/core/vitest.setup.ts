Object.defineProperty(navigator, "userAgent", {
  configurable: true,
  get: () =>
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36",
});
