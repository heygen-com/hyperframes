import { generate } from "selfsigned";

export async function createCaptureTlsFixture() {
  const { private: key, cert } = await generate(
    [{ name: "commonName", value: "assets.capture-fixture.com" }],
    { keyType: "ec", algorithm: "sha256" },
  );
  return { key, cert };
}
