export const nestedCompositionPathFixture: Record<string, string> = {
  "index.html":
    '<html><body><div data-composition-id="main" data-width="320" data-height="180"><div data-composition-id="scene" data-composition-src="compositions/scene.html"></div></div></body></html>',
  "compositions/scene.html":
    '<html><body><div data-composition-id="scene"><div data-composition-id="card" data-composition-src="compositions/cards/card.html"></div></div></body></html>',
  "compositions/cards/card.html":
    '<html><body><div data-composition-id="card"><p data-proof>Project-root card</p></div></body></html>',
};
