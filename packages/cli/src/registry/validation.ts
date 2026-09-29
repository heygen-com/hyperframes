import { Ajv2020 } from "ajv/dist/2020.js";
import registrySchema from "@hyperframes/core/schemas/registry.json";
import itemSchema from "@hyperframes/core/schemas/registry-item.json";
import type { RegistryManifest, RegistryItem, ItemType } from "@hyperframes/core";

const ajv = new Ajv2020({ strict: false, validateFormats: false });
const manifestShape = ajv.compile<RegistryManifest>(registrySchema);
const itemShape = ajv.compile<RegistryItem>(itemSchema);

export function validRegistryName(name: string): boolean {
  return name.length <= 128 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(name);
}

export function validRegistryManifest(value: unknown): value is RegistryManifest {
  return (
    manifestShape(value) &&
    value.items.length <= 10_000 &&
    value.items.every((item) => validRegistryName(item.name))
  );
}

export function validRegistryItem(
  value: unknown,
  name: string,
  type: ItemType,
): value is RegistryItem {
  return (
    itemShape(value) &&
    value.name === name &&
    value.type === type &&
    validRegistryName(value.name) &&
    value.files.length <= 1_000
  );
}
